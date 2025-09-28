#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Measurely – standalone analysis (fast + robust I/O)
- Compacts response to log-spaced bins (points_per_oct configurable)
- Analyses bandwidth, band balances, peaks/dips, reflections, RT60/EDT
- Reads meta.json (plus ~/.measurely/config.json fallback) for room context
- Writes analysis.json + summary.txt atomically in the session folder
- (NEW) Builds a 'Simple' payload: overall score, headline, per-section scores/status,
        and the top three suggestions for improving the score
"""

import argparse, os, json, sys, math, tempfile, logging
import numpy as np
import soundfile as sf
from pathlib import Path

# -------------------------------------------------------------------
# Constants & logging
# -------------------------------------------------------------------
C_MPS = 343.0  # speed of sound (m/s)

log = logging.getLogger("measurely.analyse")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

# -------------------------------------------------------------------
# Safe atomic writers (prevents 0-byte files on crash)
# -------------------------------------------------------------------
def _atomic_write_bytes(data: bytes, dest: Path):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=str(dest.parent), delete=False) as tf:
        tf.write(data)
        tf.flush()
        os.fsync(tf.fileno())
        tmp = tf.name
    os.replace(tmp, dest)

def write_text_atomic(text: str, dest: Path):
    payload = text.encode("utf-8")
    _atomic_write_bytes(payload, dest)
    log.info("Wrote %s (%d bytes)", dest, len(payload))

def write_json_atomic(obj, dest: Path):
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    _atomic_write_bytes(payload, dest)
    log.info("Wrote %s (%d bytes)", dest, len(payload))

# -------------------------------------------------------------------
# I/O
# -------------------------------------------------------------------
def load_session_paths(path):
    if os.path.isdir(path):
        resp = os.path.join(path, "response.csv")
        imp  = os.path.join(path, "impulse.wav")
        if not os.path.isfile(resp):
            raise FileNotFoundError(f"Missing response.csv in {path}")
        if not os.path.isfile(imp):
            raise FileNotFoundError(f"Missing impulse.wav in {path}")
        return resp, imp, path
    raise FileNotFoundError(f"{path} is not a directory")

# -------------------------------------------------------------------
# Meta (room)
# -------------------------------------------------------------------
def _to_float(v):
    try:
        return float(v)
    except Exception:
        return None

def load_meta_raw(session_dir):
    """
    Best-effort read of meta.json; if it lacks settings.room,
    also merge ~/.measurely/config.json (written by the app).
    """
    data = {}
    p = os.path.join(session_dir, "meta.json")
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f) or {}
        except Exception as e:
            log.warning("Could not parse %s: %s", p, e)
            data = {}

    # If room settings aren't present in the session, fall back to app config
    try:
        cfg_path = Path.home() / ".measurely" / "config.json"
        if not (isinstance(data, dict) and isinstance(data.get("settings"), dict)
                and isinstance(data["settings"].get("room"), dict)):
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8")) or {}
                if isinstance(cfg.get("room"), dict):
                    data.setdefault("settings", {})
                    data["settings"].setdefault("room", cfg["room"])
    except Exception as e:
        log.debug("No usable ~/.measurely/config.json: %s", e)

    return data

def normalize_room_meta(meta_raw):
    room = {}
    if isinstance(meta_raw, dict):
        if isinstance(meta_raw.get("settings"), dict) and isinstance(meta_raw["settings"].get("room"), dict):
            room = meta_raw["settings"]["room"]
        elif isinstance(meta_raw.get("room"), dict):
            room = meta_raw["room"]

    length_m   = _to_float(room.get("length_m"))
    width_m    = _to_float(room.get("width_m"))
    height_m   = _to_float(room.get("height_m"))
    spk_front_m      = _to_float(room.get("spk_front_m"))
    listener_front_m = _to_float(room.get("listener_front_m"))
    spk_spacing_m    = _to_float(room.get("spk_spacing_m"))
    layout = (room.get("layout") or "stereo")
    layout = layout.strip() if isinstance(layout, str) else "stereo"

    # Derived centimeters
    speaker_to_front_wall_cm = spk_front_m * 100 if spk_front_m is not None else None
    speaker_to_side_wall_cm  = None
    speaker_spacing_cm       = spk_spacing_m * 100 if spk_spacing_m is not None else None
    seating_distance_cm      = None
    listener_to_back_wall_cm = None
    if length_m is not None and listener_front_m is not None:
        d_back_m = max(length_m - listener_front_m, 0.0)
        listener_to_back_wall_cm = d_back_m * 100.0

    return {
        "length_m": length_m, "width_m": width_m, "height_m": height_m,
        "spk_front_m": spk_front_m, "listener_front_m": listener_front_m,
        "spk_spacing_m": spk_spacing_m, "layout": layout,
        "speaker_to_front_wall_cm": speaker_to_front_wall_cm,
        "speaker_to_side_wall_cm": speaker_to_side_wall_cm,
        "speaker_spacing_cm": speaker_spacing_cm,
        "seating_distance_cm": seating_distance_cm,
        "listener_to_back_wall_cm": listener_to_back_wall_cm,
    }

def compute_room_estimates(room):
    def first_mode(dim_m):
        try:
            if dim_m and dim_m > 0:
                return round(C_MPS / (2.0 * dim_m), 1)
        except Exception:
            pass
        return None

    fw_ms = None
    try:
        d = room.get("spk_front_m")
        if d and d > 0:
            fw_ms = round((2.0 * d / C_MPS) * 1000.0, 2)
    except Exception:
        pass

    return {
        "first_axial_modes_hz": {
            "length": first_mode(room.get("length_m")),
            "width":  first_mode(room.get("width_m")),
            "height": first_mode(room.get("height_m")),
        },
        "front_wall_reflection_ms": fw_ms,
    }

# -------------------------------------------------------------------
# Response/IR loaders
# -------------------------------------------------------------------
def load_response_csv(csv_path):
    freqs, mags = [], []
    with open(csv_path, "r", encoding="utf-8") as f:
        _ = f.readline()  # header (optional)
        for line in f:
            s = line.strip()
            if not s:
                continue
            parts = s.split(",")
            if len(parts) < 2:
                continue
            try:
                freqs.append(float(parts[0]))
                mags.append(float(parts[1]))
            except ValueError:
                continue
    freqs = np.asarray(freqs, dtype=np.float64)
    mags  = np.asarray(mags,  dtype=np.float64)
    if freqs.size == 0 or mags.size == 0:
        log.warning("response.csv appears empty or invalid: %s", csv_path)
    m = np.isfinite(freqs) & np.isfinite(mags) & (freqs > 0)
    return freqs[m], mags[m]

def load_impulse_wav(wav_path):
    ir, fs = sf.read(wav_path, dtype="float32", always_2d=False)
    if isinstance(ir, np.ndarray) and ir.ndim > 1:
        ir = ir[:, 0]
    ir = np.nan_to_num(ir, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    return ir, int(fs)

# Optional fallback: derive response from impulse if CSV is empty
def derive_response_from_ir(ir, fs, n_fft=131072):
    if ir is None or ir.size == 0 or fs <= 0:
        return np.array([]), np.array([])
    n = min(len(ir), n_fft)
    w = np.hanning(n)
    y = ir[:n] * w
    H = np.fft.rfft(y, n=n_fft)
    f = np.fft.rfftfreq(n_fft, d=1.0/fs)
    mag = np.abs(H) + 1e-18
    mag_db = 20.0 * np.log10(mag)
    mid = (f >= 500) & (f <= 2000)
    ref = np.median(mag_db[mid]) if np.any(mid) else np.median(mag_db)
    mag_db = mag_db - ref
    return f, mag_db

# -------------------------------------------------------------------
# helpers: compaction / stats
# -------------------------------------------------------------------
def compact_log_bins(freqs, mags, fmin=20.0, fmax=20000.0, points_per_oct=48):
    freqs = np.asarray(freqs); mags = np.asarray(mags)
    mkeep = (freqs >= max(fmin, 1e-3)) & (freqs <= fmax) & np.isfinite(mags)
    freqs = freqs[mkeep]; mags = mags[mkeep]
    if freqs.size < 8:
        return freqs, mags

    octaves = np.log2(fmax / fmin)
    n_bins = int(np.ceil(points_per_oct * octaves))
    edges = fmin * (2.0 ** (np.arange(n_bins + 1) / points_per_oct))
    idx = np.digitize(freqs, edges) - 1
    idx = np.clip(idx, 0, n_bins - 1)

    sums = np.bincount(idx, weights=mags, minlength=n_bins)
    counts = np.bincount(idx, minlength=n_bins)
    with np.errstate(invalid="ignore", divide="ignore"):
        mag_mean = sums / np.maximum(counts, 1)

    fc = np.sqrt(edges[:-1] * edges[1:])
    used = counts > 0
    return fc[used], mag_mean[used]

def band_mask(freqs, f_lo, f_hi):
    return (freqs >= f_lo) & (freqs < f_hi)

def find_3db_points(freqs, mags):
    if freqs.size < 8:
        return None, None
    mid = band_mask(freqs, 500, 2000)
    ref = np.median(mags[mid]) if np.any(mid) else np.median(mags)
    target = ref - 3.0
    low_idx = next((i for i in range(mags.size) if mags[i] >= target), None)
    high_idx = next((i for i in range(mags.size - 1, -1, -1) if mags[i] >= target), None)
    f_lo = float(freqs[low_idx]) if low_idx is not None else None
    f_hi = float(freqs[high_idx]) if high_idx is not None else None
    return f_lo, f_hi

def detect_modes(freqs, mags, threshold_db=6.0, min_sep_hz=15.0):
    if freqs.size < 16:
        return []
    ratios = freqs[1:] / freqs[:-1]
    bpo = float(np.median(1.0 / np.log2(np.maximum(ratios, 1e-12)))) if ratios.size else 48.0
    win_bins = int(max(3, round(bpo / 3)))  # ~1/3 octave
    base = np.convolve(mags, np.ones(win_bins)/win_bins, mode="same")
    delta = mags - base
    modes, last_f = [], -1e9
    for i, d in enumerate(delta):
        if abs(d) >= threshold_db and (freqs[i] - last_f) >= min_sep_hz:
            modes.append({"type": ("peak" if d > 0 else "dip"),
                          "freq_hz": float(freqs[i]),
                          "delta_db": float(d)})
            last_f = freqs[i]
    return modes

# -------------------------------------------------------------------
# IR analysis
# -------------------------------------------------------------------
def reflections_from_ir(ir, fs, win_ms=20.0, min_rel_db=-20.0):
    if ir.size == 0:
        return []
    idx0 = int(np.argmax(np.abs(ir)))
    peak = float(abs(ir[idx0]) + 1e-12)
    thr  = peak * (10.0 ** (min_rel_db/20.0))
    end  = min(ir.size, idx0 + int(fs * (win_ms/1000.0)))

    refs = []
    for i in range(idx0 + 1, end - 1):
        ai = abs(ir[i])
        if ai >= thr and ai > abs(ir[i - 1]) and ai >= abs(ir[i + 1]):
            t_ms = (i - idx0) * 1000.0 / fs
            if not refs or (t_ms - refs[-1]) >= 0.3:
                refs.append(round(t_ms, 2))
    return refs

def rt60_metrics(ir, fs, max_window_s=1.5):
    if ir.size < int(0.1 * fs):
        return {"rt60_s": None, "method": None, "edt_s": None}
    i0 = int(np.argmax(np.abs(ir)))
    end = min(ir.size, i0 + int(max_window_s * fs))
    y = ir[i0:end].astype(np.float64)
    if y.size < int(0.25 * fs):
        return {"rt60_s": None, "method": None, "edt_s": None}
    e = y * y
    edc = np.flip(np.cumsum(np.flip(e)))
    edc /= (edc[0] + 1e-18)
    edc_db = 10.0 * np.log10(np.maximum(edc, 1e-18))
    t = np.arange(edc_db.size) / fs

    def fit_decay(db_low, db_high):
        mask = (edc_db <= db_low) & (edc_db >= db_high)
        if np.count_nonzero(mask) < max(10, int(0.1 * fs)):
            return None
        A = np.vstack([t[mask], np.ones(np.count_nonzero(mask))]).T
        slope, _ = np.linalg.lstsq(A, edc_db[mask], rcond=None)[0]
        return slope if slope < -1e-6 else None

    # EDT (0..-10 dB), scaled to RT60 by *6
    edt = None
    m_edt = (edc_db <= 0.0) & (edc_db >= -10.0)
    if np.count_nonzero(m_edt) >= max(8, int(0.05 * fs)):
        A = np.vstack([t[m_edt], np.ones(np.count_nonzero(m_edt))]).T
        s_edt, _ = np.linalg.lstsq(A, edc_db[m_edt], rcond=None)[0]
        if s_edt < -1e-6:
            edt = float((-60.0 / s_edt) * (10.0 / 60.0))

    s_t30 = fit_decay(-5.0, -35.0)
    s_t20 = fit_decay(-5.0, -25.0)
    rt60 = method = None
    if s_t30 is not None:
        rt60 = float(-60.0 / s_t30); method = "T30 (-5..-35 dB)"
    elif s_t20 is not None:
        rt60 = float(-60.0 / s_t20); method = "T20 (-5..-25 dB)"
    if rt60 is not None and not (0.1 <= rt60 <= 2.5):
        rt60, method = None, None
    return {"rt60_s": rt60, "method": method, "edt_s": edt}

# -------------------------------------------------------------------
# Main analysis
# -------------------------------------------------------------------
def analyse(freqs_raw, mags_raw, ir, fs, points_per_oct=48):
    freqs, mags = compact_log_bins(freqs_raw, mags_raw, fmin=20.0, fmax=20000.0,
                                   points_per_oct=points_per_oct)

    # Handle empty/insufficient response data gracefully
    if freqs.size == 0 or mags.size == 0:
        reflections_ms = reflections_from_ir(ir, fs, win_ms=20.0, min_rel_db=-20.0)
        rt = rt60_metrics(ir, fs, max_window_s=1.5)
        return {
            "bandwidth_lo_3db_hz": None,
            "bandwidth_hi_3db_hz": None,
            "band_levels_db": {
                "bass_20_200":   None,
                "mid_200_2k":    None,
                "treble_2k_10k": None,
                "air_10k_20k":   None,
            },
            "smoothness_std_db": None,
            "modes": [],
            "reflections_ms": reflections_ms,
            "rt60_s": rt["rt60_s"],
            "rt60_method": rt["method"],
            "edt_s": rt["edt_s"],
            "bins_used": 0,
            "notes": ["No frequency response data found (response.csv was empty)."],
        }

    bands = {
        "bass_20_200":   float(np.nanmean(mags[band_mask(freqs, 20, 200)]) if np.any(band_mask(freqs,20,200)) else np.nan),
        "mid_200_2k":    float(np.nanmean(mags[band_mask(freqs, 200, 2000)]) if np.any(band_mask(freqs,200,2000)) else np.nan),
        "treble_2k_10k": float(np.nanmean(mags[band_mask(freqs, 2000, 10000)]) if np.any(band_mask(freqs,2000,10000)) else np.nan),
        "air_10k_20k":   float(np.nanmean(mags[band_mask(freqs, 10000, 20000)]) if np.any(band_mask(freqs,10000,20000)) else np.nan),
    }
    f_lo3, f_hi3 = find_3db_points(freqs, mags)
    modes = detect_modes(freqs, mags, threshold_db=6.0, min_sep_hz=15.0)

    ratios = freqs[1:] / freqs[:-1] if freqs.size > 1 else np.array([1.0])
    bpo = float(np.median(1.0 / np.log2(np.maximum(ratios, 1e-12)))) if freqs.size > 1 else 48.0
    win_bins = int(max(3, round(bpo / 3)))
    base = np.convolve(mags, np.ones(win_bins)/win_bins, mode="same")
    smoothness_db = float(np.nanstd(mags - base))

    reflections_ms = reflections_from_ir(ir, fs, win_ms=20.0, min_rel_db=-20.0)
    rt = rt60_metrics(ir, fs, max_window_s=1.5)

    advice = []
    if any(m["type"] == "peak" and 80 <= m["freq_hz"] <= 120 for m in modes):
        advice.append("Strong ~100 Hz peak detected; try pulling speakers further from the front wall.")
    if np.isfinite(bands["mid_200_2k"]) and np.isfinite(bands["bass_20_200"]):
        if bands["mid_200_2k"] - bands["bass_20_200"] > 5:
            advice.append("Midrange is forward vs bass; check toe-in and nearby reflective surfaces (desk/floor).")
    if np.isfinite(bands["air_10k_20k"]) and np.isfinite(bands["treble_2k_10k"]) and \
       (bands["air_10k_20k"] < bands["treble_2k_10k"] - 6):
        advice.append("High treble rolls off; confirm tweeter height and listening axis.")
    if reflections_ms:
        advice.append(f"Early reflections at {reflections_ms} ms; consider absorption at first side-wall/desk reflection points.")
    if rt["rt60_s"] and rt["rt60_s"] > 0.6:
        advice.append(f"RT60 ≈ {rt['rt60_s']:.2f}s (lively); add absorption to reduce reverberation.")

    return {
        "bandwidth_lo_3db_hz": f_lo3,
        "bandwidth_hi_3db_hz": f_hi3,
        "band_levels_db": bands,
        "smoothness_std_db": smoothness_db,
        "modes": modes,
        "reflections_ms": reflections_ms,
        "rt60_s": rt["rt60_s"],
        "rt60_method": rt["method"],
        "edt_s": rt["edt_s"],
        "bins_used": int(freqs.size),
        "notes": advice,
    }

# -------------------------------------------------------------------
# Context injection
# -------------------------------------------------------------------
def apply_room_context_and_insights(session_dir, result):
    meta_raw = load_meta_raw(session_dir)
    room = normalize_room_meta(meta_raw)
    estimates = compute_room_estimates(room)

    result["context"] = {"room": room}
    result["room_estimates"] = estimates

    notes = list(result.get("notes") or [])
    bands = result.get("band_levels_db") or {}
    bass = bands.get("bass_20_200"); mid = bands.get("mid_200_2k")

    def add_note(s):
        if s not in notes:
            notes.append(s)

    try:
        if (room.get("spk_front_m") is not None
            and room["spk_front_m"] < 0.25
            and bass is not None and mid is not None
            and (bass - mid) >= 3):
            add_note("Speakers are close to the front wall; try pulling them out by 10–20 cm to reduce bass lift.")
    except Exception:
        pass

    try:
        L = room.get("length_m"); W = room.get("width_m")
        if (L and L <= 3.2) or (W and W <= 2.6):
            add_note("Small room: a thick rug and curtains can tame reflections quickly.")
    except Exception:
        pass

    fw_ms = estimates.get("front_wall_reflection_ms")
    early = result.get("reflections_ms") or []
    if fw_ms and any(abs(t - fw_ms) <= max(0.08 * fw_ms, 0.25) for t in early):
        add_note(f"Front-wall bounce predicted ~{fw_ms} ms; your early reflections suggest it’s present—try extra distance or absorption behind speakers.")

    result["notes"] = notes

# -------------------------------------------------------------------
# Summary helpers
# -------------------------------------------------------------------
def _safe(val, fmt="{:.1f}"):
    try:
        if val is None: return "?"
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)): return "?"
        return fmt.format(val)
    except Exception:
        return "?"

def build_plain_summary(analysis, context=None):
    context = context or {}
    room = (context.get("room") or {})

    bands = analysis.get("band_levels_db", {}) or {}
    bass = bands.get("bass_20_200")
    mid  = bands.get("mid_200_2k")
    treb = bands.get("treble_2k_10k")
    air  = bands.get("air_10k_20k")

    smooth = analysis.get("smoothness_std_db")
    rt60   = analysis.get("rt60_s")
    modes  = analysis.get("modes", []) or []
    refs   = analysis.get("reflections_ms", []) or []

    fixes = []
    one_line = "All good. Nothing scary showed up."

    if bass is not None and mid is not None:
        diff_bass = bass - mid
        if diff_bass >= 4:
            one_line = "Bass is a bit too strong compared to voices."
            fixes.append("Pull the speakers 10–20 cm away from the wall.")
        elif diff_bass <= -4:
            one_line = "Voices are stronger than bass."
            fixes.append("Move speakers a little closer to the wall or add a small sub.")

    if air is not None and treb is not None and (air < treb - 6):
        one_line = "Top sparkle is a bit soft."
        fixes.append("Aim tweeters at ear height and check toe-in.")

    if rt60 and rt60 > 0.6:
        one_line = "Room sounds a bit echoey."
        fixes.append("Add a rug, curtains, or soft furnishings.")

    if refs:
        if one_line == "All good. Nothing scary showed up.":
            one_line = "Room reflections are bouncing sound back."
        fixes.append("Place something soft at the first side-wall reflection points.")

    if any(m.get("type") == "peak" and 80 <= m.get("freq_hz", 0) <= 120 for m in modes):
        if one_line == "All good. Nothing scary showed up.":
            one_line = "There’s a boom around 100 Hz."
        fixes.append("Slide speakers or seat a little to reduce the boom.")

    if smooth is not None and smooth > 3.0:
        if one_line == "All good. Nothing scary showed up.":
            one_line = "Response is a bit bumpy."
        fixes.append("Small position tweaks (5–10 cm) can smooth things out.")

    try:
        fw_cm = room.get("speaker_to_front_wall_cm")
        sw_cm = room.get("speaker_to_side_wall_cm")
        bw_cm = room.get("listener_to_back_wall_cm")
        Wm = room.get("width_m") or 0
        Lm = room.get("length_m") or 0

        if fw_cm is not None and fw_cm < 20 and (bass is not None and mid is not None and (bass - mid) >= 3):
            fixes.append("Speakers are very close to the wall; try +10–20 cm distance.")
        if sw_cm is not None and sw_cm < 30 and refs:
            fixes.append("Speakers are close to side walls; add/shift side absorption a little.")
        if bw_cm is not None and bw_cm < 30 and any(m.get("type") == "peak" and 40 <= m.get("freq_hz", 0) <= 80 for m in modes):
            fixes.append("Seat is near back wall; move forward ~10–20 cm to ease bass build-up.")
        if (0 < Wm <= 2.6) or (0 < Lm <= 3.2):
            fixes.append("Small room: thick rug/curtains help a lot.")
    except Exception:
        pass

    uniq = []
    for tip in fixes:
        if tip not in uniq:
            uniq.append(tip)
    return one_line, uniq[:3]

# -------------------------------------------------------------------
# Ratings (/10) + Simple-view helpers
# -------------------------------------------------------------------
def _linmap(x, x0, x1, y0, y1):
    if x0 == x1: return (y0 + y1) / 2
    t = (x - x0) / (x1 - x0)
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return y0 + t * (y1 - y0)

def score_bandwidth(lo_hz, hi_hz):
    s_lo = 0 if lo_hz is None else (
        10 if lo_hz <= 35 else
        _linmap(lo_hz, 35, 60, 10, 6) if lo_hz <= 60 else
        _linmap(lo_hz, 60, 80, 6, 3)  if lo_hz <= 80 else
        _linmap(lo_hz, 80, 100, 3, 0)
    )
    s_hi = 0 if hi_hz is None else (
        10 if hi_hz >= 18000 else
        _linmap(hi_hz, 15000, 18000, 8, 10) if hi_hz >= 15000 else
        _linmap(hi_hz, 12000, 15000, 6, 8)  if hi_hz >= 12000 else
        _linmap(hi_hz, 8000, 12000, 3, 6)   if hi_hz >= 8000  else
        _linmap(hi_hz, 6000, 8000, 0, 3)
    )
    return round((s_lo + s_hi) / 2, 1)

def score_balance(bands):
    vals = [bands.get(k) for k in ("bass_20_200","mid_200_2k","treble_2k_10k","air_10k_20k")]
    vals = [v for v in vals if v is not None and np.isfinite(v)]
    if len(vals) < 2: return 0.0
    spread = float(np.max(vals) - np.min(vals))
    if spread <= 6:    s = _linmap(spread, 0, 6, 10, 7)
    elif spread <= 12: s = _linmap(spread, 6, 12, 7, 3)
    else:              s = _linmap(min(spread, 18), 12, 18, 3, 0)
    return round(s, 1)

def score_modes(modes):
    if not modes: return 10.0
    max_dev = max(abs(m.get("delta_db", 0.0)) for m in modes)
    if max_dev <= 6:    s = _linmap(max_dev, 0, 6, 10, 7)
    elif max_dev <= 9:  s = _linmap(max_dev, 6, 9, 7, 4)
    elif max_dev <= 12: s = _linmap(max_dev, 9, 12, 4, 2)
    else:               s = _linmap(min(max_dev, 15), 12, 15, 2, 0)
    return round(s, 1)

def score_smoothness(std_db):
    if std_db is None or not np.isfinite(std_db): return 0.0
    if std_db <= 2:     s = _linmap(std_db, 0, 2, 10, 8)
    elif std_db <= 4:   s = _linmap(std_db, 2, 4, 8, 5)
    elif std_db <= 6:   s = _linmap(std_db, 4, 6, 5, 2)
    else:               s = _linmap(min(std_db, 8), 6, 8, 2, 0)
    return round(s, 1)

def score_reflections(refs_ms):
    if not refs_ms: return 10.0
    s = 10.0
    if any(t < 1.0 for t in refs_ms):        s -= 3
    if any(1.0 <= t < 5.0 for t in refs_ms): s -= 2
    if len(refs_ms) > 5:                     s -= 2
    if len(refs_ms) > 10:                    s -= 1
    return round(max(0.0, min(10.0, s)), 1)

def score_reverb(rt60, edt):
    metric = rt60 if (rt60 is not None and np.isfinite(rt60)) else (edt*6 if (edt is not None and np.isfinite(edt)) else None)
    if metric is None: return 5.0
    if 0.30 <= metric <= 0.60: return 10.0
    if 0.20 <= metric <= 0.80: return 8.0
    if 0.10 <= metric <= 1.00: return 6.0
    if metric < 0.10:  return round(_linmap(metric, 0.03, 0.10, 0, 4), 1)
    else:              return round(_linmap(min(metric,1.8), 1.0, 1.8, 6, 0), 1)

def compute_scores(analysis):
    blo = analysis.get("bandwidth_lo_3db_hz")
    bhi = analysis.get("bandwidth_hi_3db_hz")
    bands = analysis.get("band_levels_db", {}) or {}
    modes = analysis.get("modes", []) or []
    smooth = analysis.get("smoothness_std_db")
    refs = analysis.get("reflections_ms", []) or []
    rt60 = analysis.get("rt60_s")
    edt  = analysis.get("edt_s")
    scores = {
        "bandwidth":   score_bandwidth(blo, bhi),
        "balance":     score_balance(bands),
        "peaks_dips":  score_modes(modes),
        "smoothness":  score_smoothness(smooth),
        "reflections": score_reflections(refs),
        "reverb":      score_reverb(rt60, edt),
    }
    scores["overall"] = round(np.mean(list(scores.values())), 1)
    return scores

# ---- Simple-view helpers -----------------------------------------------------

def section_status(score: float) -> str:
    """Traffic-light style status for UI."""
    if score is None: return "unknown"
    if score >= 8.0:  return "great"
    if score >= 6.5:  return "good"
    if score >= 5.5:  return "ok"
    if score >= 4.5:  return "needs_work"
    return "poor"

def build_headline(overall: float) -> str:
    if overall is None: return "Room status unavailable."
    if overall >= 9.0:  return "Excellent — leave it be!"
    if overall >= 7.5:  return "Strong result."
    if overall >= 6.0:  return "Decent — a few tweaks will help."
    if overall >= 4.0:  return "Sounds a bit echoey."
    return "Room needs attention."

# Base advice strings (UK spelling)
ADVICE_BASE = {
    "bandwidth":  "Extend bass by moving speakers 10–20 cm closer to the front wall; re-sweep.",
    "balance":    "Toe-in speakers slightly and ensure tweeters are at ear height.",
    "peaks_dips": "Slide speakers or seat ~10–20 cm to shift peaks/dips; re-sweep and pick the best.",
    "smoothness": "Keep placement symmetrical; 5–10 cm angle/width tweaks usually help.",
    "reflections":"Add a rug/curtains and soften first side-wall reflection points.",
    "reverb":     "Add soft furnishings or bookshelves to bring reverberation down (~0.3–0.6 s).",
}

def refine_balance_advice(bands: dict) -> str:
    b = bands.get("bass_20_200"); m = bands.get("mid_200_2k")
    t = bands.get("treble_2k_10k"); a = bands.get("air_10k_20k")
    if b is not None and m is not None and (b - m) >= 3:
        return "Bass is strong; pull speakers 10–20 cm into the room or move the seat forward slightly."
    if b is not None and m is not None and (m - b) >= 3:
        return "Midrange is forward; try a touch less toe-in and ensure no hard desk/floor reflections."
    if a is not None and t is not None and (a < t - 6):
        return "Top end is soft; raise tweeters to ear height and increase toe-in slightly."
    return ADVICE_BASE["balance"]

def refine_peaks_advice(modes: list, room: dict) -> str:
    if any(m.get("type") == "peak" and 80 <= m.get("freq_hz",0) <= 120 for m in modes):
        return "Boom around ~100 Hz; increase speaker–front-wall distance by 10–20 cm."
    if any(m.get("type") == "dip" and 60 <= m.get("freq_hz",0) <= 100 for m in modes):
        return "Bass dip detected; try small seat moves (10–20 cm) and re-sweep."
    return ADVICE_BASE["peaks_dips"]

def refine_reflections_advice(refs: list) -> str:
    if any(t < 2.0 for t in refs):
        return "Strong early reflections; add a rug and side-wall panels at first reflection points."
    return ADVICE_BASE["reflections"]

def refine_reverb_advice(rt60: float) -> str:
    if rt60 is None: return ADVICE_BASE["reverb"]
    if rt60 > 0.8:   return "Reverberation is high; add thicker curtains and more absorption to target ~0.4–0.6 s."
    if rt60 < 0.2:   return "Room is very dry; consider reducing absorption to restore some liveliness."
    return ADVICE_BASE["reverb"]

def build_top_actions(scores: dict, analysis: dict, room: dict, n: int = 3):
    """
    Pick the lowest scoring sections and attach tailored advice.
    """
    order = ["reflections","peaks_dips","balance","bandwidth","smoothness","reverb"]
    # Filter to known sections and sort by score asc, then by our order for stability
    items = [(k, scores.get(k)) for k in order if k in scores and isinstance(scores.get(k),(int,float))]
    items.sort(key=lambda kv: (kv[1], order.index(kv[0])))
    bands = analysis.get("band_levels_db") or {}
    modes = analysis.get("modes") or []
    refs  = analysis.get("reflections_ms") or []
    rt60  = analysis.get("rt60_s")
    actions = []
    for k, sc in items[:n]:
        if k == "balance":
            advice = refine_balance_advice(bands)
        elif k == "peaks_dips":
            advice = refine_peaks_advice(modes, room)
        elif k == "reflections":
            advice = refine_reflections_advice(refs)
        elif k == "reverb":
            advice = refine_reverb_advice(rt60)
        else:
            advice = ADVICE_BASE.get(k, "Looks fine as is.")
        actions.append({"section": k, "score": round(float(sc),1), "advice": advice})
    return actions

def build_simple_view(scores: dict, analysis: dict, room: dict):
    """
    Compact payload for the Simple card in the UI.
    """
    overall = scores.get("overall")
    headline = build_headline(overall)

    sections = {}
    for key, label in (
        ("bandwidth","bandwidth"),
        ("balance","balance"),
        ("peaks_dips","peaks_dips"),
        ("smoothness","smoothness"),
        ("reflections","reflections"),
        ("reverb","reverb"),
    ):
        val = scores.get(key)
        sections[key] = {
            "score": round(float(val),1) if isinstance(val,(int,float)) else None,
            "status": section_status(val)
        }

    top_actions = build_top_actions(scores, analysis, room, n=3)

    simple = {
        "overall": overall,
        "headline": headline,
        "sections": sections,
        "top_actions": top_actions
    }
    return simple

# -------------------------------------------------------------------
# Summary file
# -------------------------------------------------------------------
def write_summary(path, analysis, context=None):
    one_line, fixes = build_plain_summary(analysis, context=context)
    blo = analysis.get("bandwidth_lo_3db_hz")
    bhi = analysis.get("bandwidth_hi_3db_hz")
    bands = analysis.get("band_levels_db", {}) or {}
    bass = bands.get("bass_20_200"); mid  = bands.get("mid_200_2k")
    treb = bands.get("treble_2k_10k"); air  = bands.get("air_10k_20k")
    modes = analysis.get("modes", []) or []
    smooth = analysis.get("smoothness_std_db")
    refs = analysis.get("reflections_ms", []) or []
    rt60 = analysis.get("rt60_s")
    rt_m = analysis.get("rt60_method")
    edt  = analysis.get("edt_s")

    def s(val, f="{:.1f}"):
        try:
            if val is None: return "?"
            if isinstance(val, float) and (math.isnan(val) or math.isinf(val)): return "?"
            return f.format(val)
        except Exception:
            return "?"

    def balance_line():
        parts = []
        parts.append(f"Bass(20–200): {s(bass,'{:+.1f}')} dB"   if bass is not None else "Bass(20–200): ?")
        parts.append(f"Mid(200–2k): {s(mid,'{:+.1f}')} dB"     if mid  is not None else "Mid(200–2k): ?")
        parts.append(f"Treble(2–10k): {s(treb,'{:+.1f}')} dB"  if treb is not None else "Treble(2–10k): ?")
        parts.append(f"Air(10–20k): {s(air,'{:+.1f}')} dB"     if air  is not None else "Air(10–20k): ?")
        return "  " + " ".join(parts)

    def modes_lines():
        if not modes:
            return ["  (none obvious)"]
        out = []
        for m in modes[:8]:
            typ = (m.get("type") or "").upper() or "?"
            f = s(m.get("freq_hz"), "{:.0f}")
            d = s(m.get("delta_db"), "{:+.1f}")
            out.append(f"  - {typ} @ {f} Hz ({d} dB)")
        if len(modes) > 8:
            out.append(f"  …and {len(modes) - 8} more")
        return out

    def reflections_line():
        if not refs:
            return "  (none detected above threshold)"
        return f"  {', '.join(s(t,'{:.2f}') for t in refs)} ms"

    lines = []
    lines.append("Simple result")
    lines.append("-------------")
    lines.append(one_line or "All good. Nothing scary showed up.")
    if fixes:
        lines.append("")
        lines.append("What to do next")
        lines.append("---------------")
        for tip in fixes[:3]:
            lines.append(f"- {tip}")
    lines.append("")

    lines.append("1) Bandwidth")
    lines.append("------------")
    if blo is not None or bhi is not None:
        a = s(blo, "{:.0f}") if blo is not None else "?"
        b = s(bhi, "{:.0f}") if bhi is not None else "?"
        lines.append(f"  -3 dB points: {a} Hz – {b} Hz")
    else:
        lines.append("  (not enough data)")
    lines.append("")

    lines.append("2) Balance (bass / mids / treble / air)")
    lines.append("---------------------------------------")
    lines.append(balance_line())
    lines.append("")

    lines.append("3) Peaks & dips (room modes)")
    lines.append("----------------------------")
    lines.extend(modes_lines())
    lines.append("")

    lines.append("4) Smoothness")
    lines.append("-------------")
    lines.append(f"  Std of residual vs baseline: {s(smooth, '{:.1f}')} dB (lower is smoother)" if smooth is not None else "  (not available)")
    lines.append("")

    lines.append("5) Reflections")
    lines.append("--------------")
    lines.append(reflections_line())
    lines.append("")

    lines.append("6) Reverberation (RT60/EDT)")
    lines.append("----------------------------")
    rt60_txt = f"{s(rt60,'{:.2f}')} s" if rt60 is not None else "?"
    edt_txt  = f"{s(edt,'{:.2f}')} s"  if edt  is not None else "?"
    lines.append(f"  RT60: {rt60_txt}" + (f"  (method: {rt_m})" if rt_m else ""))
    lines.append(f"  EDT : {edt_txt}")
    lines.append("")

    try:
        sc = compute_scores(analysis)
        lines.append("Ratings (/10)")
        lines.append("-------------")
        lines.append(f"  Bandwidth  : {sc['bandwidth']}/10")
        lines.append(f"  Balance    : {sc['balance']}/10")
        lines.append(f"  Peaks/Dips : {sc['peaks_dips']}/10")
        lines.append(f"  Smoothness : {sc['smoothness']}/10")
        lines.append(f"  Reflections: {sc['reflections']}/10")
        lines.append(f"  Reverb     : {sc['reverb']}/10")
        lines.append(f"  Overall    : {sc['overall']}/10")
        lines.append("")
    except Exception as e:
        log.debug("Score block skipped: %s", e)

    lines.append(f"Bins analysed: {analysis.get('bins_used')}")
    text = "\n".join(lines)
    write_text_atomic(text + "\n", Path(path) / "summary.txt")

# -------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Analyse a Measurely session directory")
    ap.add_argument("session_dir", help="Path to folder with response.csv and impulse.wav")
    ap.add_argument("--points-per-oct", type=int, default=48,
                    help="Log bins per octave (analysis speed vs detail)")
    ap.add_argument("--no-ir-fallback", action="store_true",
                    help="Disable deriving a response from impulse.wav if response.csv is empty")
    args = ap.parse_args()

    resp_csv, imp_wav, outdir = load_session_paths(args.session_dir)
    outdir_p = Path(outdir)

    # 1) Load data
    freqs, mags = load_response_csv(resp_csv)
    ir, fs = load_impulse_wav(imp_wav)

    # Optional fallback if CSV is empty/invalid
    if (freqs.size == 0 or mags.size == 0) and not args.no_ir_fallback:
        log.warning("No usable response.csv; deriving response from impulse as fallback.")
        f2, m2 = derive_response_from_ir(ir, fs)
        if f2.size > 0:
            freqs, mags = f2, m2
        else:
            log.warning("Impulse fallback also produced no data; proceeding with IR-only metrics.")

    # 2) Analyse
    result = analyse(freqs, mags, ir, fs, points_per_oct=args.points_per_oct)

    # 3) Context & insights
    apply_room_context_and_insights(outdir, result)

    # 4) Scores
    scores = compute_scores(result)
    result["scores"] = scores

    # 5) Plain English
    one_liner, fixes = build_plain_summary(result, context=result.get("context"))
    result["plain_summary"] = one_liner
    result["simple_fixes"] = fixes

    # 6) Simple UI payload (NEW)
    room_ctx = (result.get("context") or {}).get("room") or {}
    result["simple_view"] = build_simple_view(scores, result, room_ctx)

    # 7) Persist atomically
    try:
        write_json_atomic(result, outdir_p / "analysis.json")
        write_summary(outdir_p, result, context=result.get("context"))
    except Exception as e:
        log.exception("Persist failed: %s", e)
        raise

    print("Analysis complete:", outdir)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log.error("Fatal error: %s", exc)
        sys.exit(1)
