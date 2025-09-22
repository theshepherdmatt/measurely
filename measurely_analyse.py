#!/usr/bin/env python3
"""
Measurely – standalone analysis (fast version)
- Compacts response to log-spaced bins (points_per_oct configurable)
- Analyses bandwidth, band balances, peaks/dips, reflections, RT60/EDT
- Writes analysis.json + summary.txt in the session folder
"""

import argparse, os, json, sys
import numpy as np
import soundfile as sf

# ---------------- I/O ----------------
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

def load_response_csv(csv_path):
    # Manual parse (robust/fast)
    freqs, mags = [], []
    with open(csv_path, "r") as f:
        _ = f.readline()  # header
        for line in f:
            s = line.strip()
            if not s: continue
            a, b = s.split(",")
            freqs.append(float(a)); mags.append(float(b))
    freqs = np.asarray(freqs, dtype=np.float64)
    mags  = np.asarray(mags,  dtype=np.float64)
    m = np.isfinite(freqs) & np.isfinite(mags) & (freqs > 0)
    return freqs[m], mags[m]

def load_impulse_wav(wav_path):
    ir, fs = sf.read(wav_path, dtype="float32", always_2d=False)
    if isinstance(ir, np.ndarray) and ir.ndim > 1:
        ir = ir[:, 0]
    ir = np.nan_to_num(ir, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    return ir, int(fs)

# ------------- helpers: compaction / stats -------------
def compact_log_bins(freqs, mags, fmin=20.0, fmax=20000.0, points_per_oct=48):
    """
    Bin onto log-spaced centres. e.g. 48 pts/oct → ~550 bins across 20–20k.
    Returns (fc, mag_mean) for bins that had data.
    """
    freqs = np.asarray(freqs); mags = np.asarray(mags)
    mkeep = (freqs >= max(fmin, 1e-3)) & (freqs <= fmax) & np.isfinite(mags)
    freqs = freqs[mkeep]; mags = mags[mkeep]
    if freqs.size < 8:
        return freqs, mags

    octaves = np.log2(fmax / fmin)
    n_bins = int(np.ceil(points_per_oct * octaves))
    edges = fmin * (2.0 ** (np.arange(n_bins + 1) / points_per_oct))  # log edges
    idx = np.digitize(freqs, edges) - 1
    idx = np.clip(idx, 0, n_bins - 1)

    sums = np.bincount(idx, weights=mags, minlength=n_bins)
    counts = np.bincount(idx, minlength=n_bins)
    with np.errstate(invalid="ignore", divide="ignore"):
        mag_mean = sums / np.maximum(counts, 1)

    fc = np.sqrt(edges[:-1] * edges[1:])  # geometric centres
    used = counts > 0
    return fc[used], mag_mean[used]

def band_mask(freqs, f_lo, f_hi):
    return (freqs >= f_lo) & (freqs < f_hi)

def find_3db_points(freqs, mags):
    """Estimate -3 dB bandwidth relative to midband (500–2k median)."""
    if freqs.size < 8: return None, None
    mid = band_mask(freqs, 500, 2000)
    ref = np.median(mags[mid]) if np.any(mid) else np.median(mags)
    target = ref - 3.0
    low_idx = next((i for i in range(mags.size) if mags[i] >= target), None)
    high_idx = next((i for i in range(mags.size - 1, -1, -1) if mags[i] >= target), None)
    f_lo = float(freqs[low_idx]) if low_idx is not None else None
    f_hi = float(freqs[high_idx]) if high_idx is not None else None
    return f_lo, f_hi

def detect_modes(freqs, mags, threshold_db=6.0, min_sep_hz=15.0):
    """
    Peaks/dips ±threshold vs a heavier-smoothed baseline.
    Baseline: moving average ~1/3 octave in the (already log-binned) domain.
    """
    if freqs.size < 16: return []
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

# ------------- IR analysis -------------
def reflections_from_ir(ir, fs, win_ms=20.0, min_rel_db=-20.0):
    if ir.size == 0: return []
    idx0 = int(np.argmax(np.abs(ir)))
    peak = float(abs(ir[idx0]) + 1e-12)
    thr  = peak * (10.0 ** (min_rel_db/20.0))
    end  = min(ir.size, idx0 + int(fs * (win_ms/1000.0)))

    refs = []
    for i in range(idx0+1, end-1):
        ai = abs(ir[i])
        if ai >= thr and ai > abs(ir[i-1]) and ai >= abs(ir[i+1]):
            t_ms = (i - idx0) * 1000.0 / fs
            if not refs or (t_ms - refs[-1]) >= 0.3:
                refs.append(round(t_ms, 2))
    return refs

def rt60_metrics(ir, fs, max_window_s=1.5):
    """
    Robust small-room decay metrics using Schroeder integration.
    Returns {'rt60_s', 'method', 'edt_s'} with Nones if unreliable.
    """
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
        mask = (edc_db <= db_low) & (edc_db >= db_high)  # e.g. -5..-35 dB
        if np.count_nonzero(mask) < max(10, int(0.1 * fs)):
            return None
        A = np.vstack([t[mask], np.ones(np.count_nonzero(mask))]).T
        slope, _ = np.linalg.lstsq(A, edc_db[mask], rcond=None)[0]
        return slope if slope < -1e-6 else None  # must be decaying

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

# ------------- Main analysis -------------
def analyse(freqs_raw, mags_raw, ir, fs, points_per_oct=48):
    # Compact to log bins for speed & stability
    freqs, mags = compact_log_bins(freqs_raw, mags_raw, fmin=20.0, fmax=20000.0,
                                   points_per_oct=points_per_oct)

    # Band averages on compacted data
    bands = {
        "bass_20_200":   float(np.nanmean(mags[band_mask(freqs, 20, 200)]) if np.any(band_mask(freqs,20,200)) else np.nan),
        "mid_200_2k":    float(np.nanmean(mags[band_mask(freqs, 200, 2000)]) if np.any(band_mask(freqs,200,2000)) else np.nan),
        "treble_2k_10k": float(np.nanmean(mags[band_mask(freqs, 2000, 10000)]) if np.any(band_mask(freqs,2000,10000)) else np.nan),
        "air_10k_20k":   float(np.nanmean(mags[band_mask(freqs, 10000, 20000)]) if np.any(band_mask(freqs,10000,20000)) else np.nan),
    }

    f_lo3, f_hi3 = find_3db_points(freqs, mags)
    modes = detect_modes(freqs, mags, threshold_db=6.0, min_sep_hz=15.0)

    # Smoothness vs coarse baseline (std of residual)
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

# ------------- Summary file -------------
def write_summary(path, analysis):
    lines = []
    lines.append("Measurely Analysis Report")
    lines.append("=========================")
    blo = analysis.get("bandwidth_lo_3db_hz")
    bhi = analysis.get("bandwidth_hi_3db_hz")
    if blo or bhi:
        lines.append(f"Bandwidth (-3 dB): {blo:.0f} Hz – {bhi:.0f} Hz" if (blo and bhi) else
                     f"Bandwidth (-3 dB): {blo or '?'} – {bhi or '?'}")
    bands = analysis["band_levels_db"]
    lines.append(f"Bass(20–200): {bands['bass_20_200']:+.1f} dB  "
                 f"Mid(200–2k): {bands['mid_200_2k']:+.1f} dB  "
                 f"Treble(2–10k): {bands['treble_2k_10k']:+.1f} dB  "
                 f"Air(10–20k): {bands['air_10k_20k']:+.1f} dB")
    if analysis["modes"]:
        lines.append("Modes (±6 dB+):")
        for m in analysis["modes"][:8]:
            lines.append(f"  - {m['type'].upper()} @ {m['freq_hz']:.0f} Hz ({m['delta_db']:+.1f} dB)")
    if analysis["reflections_ms"]:
        lines.append(f"Early reflections: {analysis['reflections_ms']} ms")
    if analysis.get("rt60_s"):
        lines.append(f"RT60 (rough): {analysis['rt60_s']:.2f} s")
    if analysis.get("rt60_method"):
        lines.append(f"RT60 method: {analysis['rt60_method']}")
    if analysis.get("edt_s"):
        lines.append(f"EDT (0→-10 dB): {analysis['edt_s']:.2f} s")
    if analysis.get("notes"):
        lines.append("Advice:")
        for n in analysis["notes"]:
            lines.append(f"  - {n}")
    lines.append(f"Bins analysed: {analysis.get('bins_used')}")
    text = "\n".join(lines)
    with open(os.path.join(path, "summary.txt"), "w") as f:
        f.write(text + "\n")

# ------------- CLI -------------
def main():
    ap = argparse.ArgumentParser(description="Analyse a Measurely session directory")
    ap.add_argument("session_dir", help="Path to folder with response.csv and impulse.wav")
    ap.add_argument("--points-per-oct", type=int, default=48,
                    help="Log bins per octave (analysis speed vs detail)")
    args = ap.parse_args()

    resp_csv, imp_wav, outdir = load_session_paths(args.session_dir)
    freqs, mags = load_response_csv(resp_csv)
    ir, fs = load_impulse_wav(imp_wav)

    result = analyse(freqs, mags, ir, fs, points_per_oct=args.points_per_oct)
    with open(os.path.join(outdir, "analysis.json"), "w") as f:
        json.dump(result, f, indent=2)

    write_summary(outdir, result)
    print("Analysis complete:", outdir)

if __name__ == "__main__":
    main()
