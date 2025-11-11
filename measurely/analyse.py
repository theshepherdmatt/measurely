#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Measurely – headache-proof analyser
------------------------------------
*  Reads response.csv + impulse.wav  (or left/ / right/ sub-dirs)
*  Compacts to log-spaced bins
*  Scores bandwidth, balance, modes, smoothness, reflections, RT60/EDT
*  NEW:  loads target curve from ~/measurely/speakers/  (speakers.json + per-folder file)
*  Writes  analysis.json  +  summary.txt  +  camilladsp.yaml  atomically
*  Returns  simple  dict for UI:  overall, headline, sections[], top-actions[]
"""

import argparse, json, csv, math, os, tempfile, sys, logging
from pathlib import Path
import numpy as np
from scipy.interpolate import interp1d
import soundfile as sf

# ---------- config / constants ------------------------------------
C_MPS = 343.0
SPEAKER_DIR = Path.home() / "measurely" / "speakers"
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", stream=sys.stdout)
log = logging.getLogger("measurely")

# ---------- safe atomic file write --------------------------------
def _atomic_write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
        tmp = Path(f.name)
    tmp.replace(path)
    log.info("saved  %s  (%d bytes)", path, len(text.encode()))

# ---------- speaker target curve ----------------------------------
def load_target_curve(speaker_key: str):
    if not speaker_key:
        return None
    master = SPEAKER_DIR / "speakers.json"
    if not master.exists():
        return None
    catalogue = json.loads(master.read_text())
    if speaker_key not in catalogue:
        return None
    folder = catalogue[speaker_key]["folder"]
    fname  = catalogue[speaker_key]["target_curve"]
    path   = SPEAKER_DIR / folder / fname
    if not path.exists():
        return None

    freq, targ = [], []
    if path.suffix == ".csv":
        for row in csv.reader(path.read_text().splitlines()):
            if len(row) >= 2:
                freq.append(float(row[0]))
                targ.append(float(row[1]))
    elif path.suffix == ".json":
        data = json.loads(path.read_text())
        for pt in data.get("points", data):
            f = pt.get("frequency_hz") or pt.get("f")
            t = pt.get("target_rel_db") or pt.get("mag")
            if f is not None and t is not None:
                freq.append(float(f))
                targ.append(float(t))
    if len(freq) < 3:
        return None
    return interp1d(freq, targ, bounds_error=False, fill_value=(targ[0], targ[-1]))

# ---------- I/O  helpers -------------------------------------------
def load_response_csv(p: Path):
    freq, mag = [], []
    for row in csv.reader(p.read_text().splitlines()):
        if len(row) >= 2:
            try:
                freq.append(float(row[0]))
                mag.append(float(row[1]))
            except ValueError:
                pass
    freq, mag = np.asarray(freq, dtype=float), np.asarray(mag, dtype=float)
    ok = np.isfinite(freq) & np.isfinite(mag) & (freq > 0)
    return freq[ok], mag[ok]

def load_ir(p: Path):
    ir, fs = sf.read(p, dtype="float32", always_2d=False)
    if ir.ndim > 1:
        ir = ir[:, 0]
    ir = np.nan_to_num(ir, nan=0.0, posinf=0.0, neginf=0.0)
    return ir, fs

def load_session(session_dir: Path):
    """Returns freq, mag, ir, fs, label  (label='root'|'left'|'right'|'merged')"""
    # 1. try root level
    resp = session_dir / "response.csv"
    imp  = session_dir / "impulse.wav"
    if resp.exists() and imp.exists():
        return *load_response_csv(resp), *load_ir(imp), "root"

    # 2. try channel sub-dirs
    chans = {}
    for ch in ("left", "right"):
        r = session_dir / ch / "response.csv"
        i = session_dir / ch / "impulse.wav"
        if r.exists() and i.exists():
            chans[ch] = (r, i)
    if not chans:
        raise FileNotFoundError("No response.csv + impulse.wav found")

    if len(chans) == 1:                       # single channel
        ch, (rr, ii) = next(iter(chans.items()))
        return *load_response_csv(rr), *load_ir(ii), ch

    # both left & right  ->  average response, left IR
    fl, ml = load_response_csv(chans["left"][0])
    fr, mr = load_response_csv(chans["right"][0])
    common = np.intersect1d(np.round(fl, 2), np.round(fr, 2))
    if common.size == 0:                      # grids differ – fallback to left
        return fl, ml, *load_ir(chans["left"][1]), "left"
    idx_l = {f: i for i, f in enumerate(np.round(fl, 2))}
    idx_r = {f: i for i, f in enumerate(np.round(fr, 2))}
    f_out, m_out = [], []
    for f in common:
        f_out.append(fl[idx_l[f]])
        m_out.append((ml[idx_l[f]] + mr[idx_r[f]]) / 2.0)
    return np.array(f_out), np.array(m_out), *load_ir(chans["left"][1]), "merged"

# ---------- signal processing --------------------------------------
def log_bins(f, m, fmin=20, fmax=20e3, ppo=48):
    f, m = np.asarray(f), np.asarray(m)
    mask = (f >= fmin) & (f <= fmax) & np.isfinite(m)
    f, m = f[mask], m[mask]
    if f.size < 8:
        return f, m
    edges = fmin * (2 ** (np.arange(int(np.ceil(np.log2(fmax/fmin) * ppo) + 1)) / ppo))
    idx   = np.digitize(f, edges) - 1
    sums  = np.bincount(idx, weights=m, minlength=len(edges))
    cnts  = np.bincount(idx, minlength=len(edges))
    with np.errstate(invalid="ignore", divide="ignore"):
        m_avg = sums / np.maximum(cnts, 1)
    centres = np.sqrt(edges[:-1] * edges[1:])
    use = cnts[:-1] > 0
    return centres[use], m_avg[:-1][use]

def band_mean(f, m, flo, fhi):
    mask = (f >= flo) & (f < fhi)
    return float(np.nanmean(m[mask])) if mask.any() else np.nan

def modes(f, m, thresh=6, min_sep=15):
    if f.size < 16:
        return []
    bpo   = 1 / np.median(np.log2(f[1:] / f[:-1]))
    win   = max(3, int(round(bpo / 3)))
    base  = np.convolve(m, np.ones(win)/win, mode="same")
    delta = m - base
    out, last = [], -np.inf
    for i, d in enumerate(delta):
        if abs(d) >= thresh and f[i] - last >= min_sep:
            out.append({"type": "peak" if d > 0 else "dip", "freq_hz": float(f[i]), "delta_db": float(d)})
            last = f[i]
    return out

def bandwidth_3db(f, m):
    if f.size < 8:
        return None, None
    ref = np.nanmedian(m[(f >= 500) & (f <= 2000)]) if np.any((f >= 500) & (f <= 2000)) else np.nanmedian(m)
    tgt = ref - 3
    lo  = next((f[i] for i in range(f.size) if m[i] >= tgt), None)
    hi  = next((f[i] for i in range(f.size-1, -1, -1) if m[i] >= tgt), None)
    return lo, hi

def smoothness(f, m):
    bpo = 1 / np.median(np.log2(f[1:] / f[:-1]))
    win = max(3, int(round(bpo / 3)))
    base = np.convolve(m, np.ones(win)/win, mode="same")
    return float(np.nanstd(m - base))

# ---------- IR stuff ------------------------------------------------
def early_reflections(ir, fs, win_ms=20, db_rel=-20):
    if ir.size == 0:
        return []
    idx0 = int(np.argmax(np.abs(ir)))
    peak = float(np.abs(ir[idx0]))
    thr  = peak * 10**(db_rel/20)
    end  = min(ir.size, idx0 + int(fs * win_ms / 1000))
    times = []
    for i in range(idx0+1, end-1):
        a = np.abs(ir[i])
        if a >= thr and a > np.abs(ir[i-1]) and a >= np.abs(ir[i+1]):
            t = (i-idx0)*1000/fs
            if not times or t - times[-1] > 0.3:
                times.append(round(t, 2))
    return times

def rt60_edt(ir, fs, max_win=1.5):
    if ir.size < int(0.1*fs):
        return {"rt60": None, "method": None, "edt": None}
    idx0 = int(np.argmax(np.abs(ir)))
    end  = min(ir.size, idx0 + int(fs*max_win))
    y    = ir[idx0:end].astype(np.float64)
    e    = y*y
    edc  = np.cumsum(e[::-1])[::-1]
    edc  = edc / (edc[0] + 1e-18)
    edb  = 10*np.log10(np.maximum(edc, 1e-18))
    t    = np.arange(edb.size)/fs

    def slope(lo, hi):
        mask = (edb <= lo) & (edb >= hi)
        if mask.sum() < max(10, int(0.1*fs)):
            return None
        A = np.vstack([t[mask], np.ones(mask.sum())]).T
        return np.linalg.lstsq(A, edb[mask], rcond=None)[0][0]

    # EDT  0 → –10 dB  scaled ×6
    edt = None
    s   = slope(0, -10)
    if s and s < -1e-6:
        edt = float((-60/s) * (10/60))

    # RT60  T30  –5 → –35   or  T20  –5 → –25
    rt60 = method = None
    for (lo, hi, tag) in [(-5, -35, "T30"), (-5, -25, "T20")]:
        s = slope(lo, hi)
        if s and s < -1e-6:
            rt60, method = float(-60/s), tag
            break
    if rt60 and not 0.1 <= rt60 <= 2.5:
        rt60 = method = None
    return {"rt60": rt60, "method": method, "edt": edt}

# ---------- scoring helpers ----------------------------------------
def linmap(x, x0, x1, y0, y1):
    if x0 == x1:
        return (y0+y1)/2
    t = (x - x0)/(x1 - x0)
    t = 0 if t < 0 else 1 if t > 1 else t
    return y0 + t*(y1 - y0)

def score_bandwidth(lo, hi):
    slo = 0 if lo is None else (10 if lo <= 35 else linmap(lo, 35, 100, 10, 0))
    shi = 0 if hi is None else (10 if hi >= 18000 else linmap(hi, 6000, 18000, 0, 10))
    return round((slo + shi)/2, 1)

def score_balance(bands, target=None):
    def _hz(s: str) -> float:
        return float(s[:-1]) * 1e3 if s.endswith("k") else float(s)

    if target:
        corr = {k: bands[k] - float(target(np.sqrt(_hz(k.split("_")[1]) *
                                               _hz(k.split("_")[2]))))
                for k in bands}
    else:
        corr = bands
    spread = np.nanmax(list(corr.values())) - np.nanmin(list(corr.values()))
    if np.isnan(spread):
        return 5.0
    if spread <= 2:
        return 10.0
    return round(linmap(min(spread, 8), 2, 8, 9, 4), 1)

def score_modes(modes):
    if not modes:
        return 10.0
    dev = max(abs(m["delta_db"]) for m in modes)
    return round(linmap(min(dev, 15), 0, 15, 10, 0), 1)

def score_smooth(std):
    if std is None or np.isnan(std):
        return 0
    return round(linmap(min(std, 8), 0, 8, 10, 0), 1)

def score_ref(refs):
    if not refs:
        return 10.0
    s = 10
    if any(t < 1 for t in refs):
        s -= 3
    if any(1 <= t < 5 for t in refs):
        s -= 2
    if len(refs) > 5:
        s -= 2
    return round(max(0, s), 1)

def score_reverb(rt60, edt):
    metric = rt60 if rt60 is not None and np.isfinite(rt60) else (edt*6 if edt else None)
    if metric is None:
        return 5.0
    if 0.3 <= metric <= 0.6:
        return 10.0
    if 0.2 <= metric <= 0.8:
        return 8.0
    if metric < 0.2:
        return round(linmap(metric, 0.03, 0.2, 0, 8), 1)
    return round(linmap(min(metric, 1.8), 0.6, 1.8, 10, 0), 1)


# ---------- main analysis ------------------------------------------
def analyse(session_dir: Path, ppo=48, speaker_key=None):
    freq, mag, ir, fs, label = load_session(session_dir)
    freq, mag = log_bins(freq, mag, ppo=ppo)
    bands = {
        "bass_20_200":   band_mean(freq, mag, 20, 200),
        "mid_200_2k":    band_mean(freq, mag, 200, 2000),
        "treble_2k_10k": band_mean(freq, mag, 2000, 10000),
        "air_10k_20k":   band_mean(freq, mag, 10000, 20000),
    }
    lo3, hi3   = bandwidth_3db(freq, mag)
    mods       = modes(freq, mag)
    sm         = smoothness(freq, mag)
    refs       = early_reflections(ir, fs)
    rt         = rt60_edt(ir, fs)

    # ---- advice -----------------------------------------------------
    notes = []
    if any(80 <= m["freq_hz"] <= 120 and m["type"] == "peak" for m in mods):
        notes.append("Boom ~100 Hz – pull speakers 10-20 cm from front wall")
    if bands["mid_200_2k"] - bands["bass_20_200"] > 5:
        notes.append("Mid forward vs bass – check toe-in / desk reflections")
    if bands["air_10k_20k"] < bands["treble_2k_10k"] - 6:
        notes.append("Top roll-off – aim tweeters at ear height")
    if refs:
        notes.append(f"Early reflections {refs} ms – treat side walls")
    if rt["rt60"] and rt["rt60"] > 0.6:
        notes.append(f"RT60 {rt['rt60']:.2f} s lively – add rug/curtains")

    # ---- scores -----------------------------------------------------
    target_curve = load_target_curve(speaker_key)
    scores = {
        "bandwidth":   score_bandwidth(lo3, hi3),
        "balance":     score_balance(bands, target_curve),
        "peaks_dips":  score_modes(mods),
        "smoothness":  score_smooth(sm),
        "reflections": score_ref(refs),
        "reverb":      score_reverb(rt["rt60"], rt["edt"]),
    }
    scores["overall"] = round(np.mean(list(scores.values())), 1)

    return {
        "freq": freq, "mag": mag, "ir": ir, "fs": fs, "label": label,
        "bandwidth_lo_3db_hz": lo3,
        "bandwidth_hi_3db_hz": hi3,
        "band_levels_db": bands,
        "smoothness_std_db": sm,
        "modes": mods,
        "reflections_ms": refs,
        "rt60_s": rt["rt60"],
        "rt60_method": rt["method"],
        "edt_s": rt["edt"],
        "notes": notes,
        "scores": scores,
    }

# ---------- pretty text summary ------------------------------------
def plain_summary(res):
    bands = res["band_levels_db"]
    one, fix = "All good. Nothing scary showed up.", []
    if bands["bass_20_200"] - bands["mid_200_2k"] > 4:
        one, fix = "Bass strong vs mids", ["Pull speakers 10-20 cm from wall"]
    if res["reflections_ms"]:
        one, fix = "Early reflections detected", ["Add rug / side-wall panels"]
    if res["rt60_s"] and res["rt60_s"] > 0.6:
        one = "Room a bit echoey"
    return one, fix[:3]

def write_text_summary(outdir: Path, res):
    one, fix = plain_summary(res)
    lines = ["Simple result", "-------------", one, ""]
    if fix:
        lines += ["What to do next", "---------------"] + [f"- {f}" for f in fix] + [""]
    lines += [f"Bandwidth  : {res['scores']['bandwidth']}/10",
              f"Balance    : {res['scores']['balance']}/10",
              f"Peaks/Dips : {res['scores']['peaks_dips']}/10",
              f"Smoothness : {res['scores']['smoothness']}/10",
              f"Reflections: {res['scores']['reflections']}/10",
              f"Reverb     : {res['scores']['reverb']}/10",
              f"Overall    : {res['scores']['overall']}/10", ""]
    _atomic_write(outdir / "summary.txt", "\n".join(lines))

# ---------- Camilla-DSP YAML ---------------------------------------
def peq_bands(res, max_bands=4):
    bands = []
    for m in sorted(res["modes"], key=lambda x: -abs(x["delta_db"]))[:max_bands*2]:
        f = m["freq_hz"]
        if f < 15 or f > 500:
            continue
        gain = -m["delta_db"]
        gain = max(-6, min(6, gain))
        q = 5 if f < 150 else 3.5
        bands.append({"f": round(f, 1), "q": round(q, 2), "gain": round(gain, 2)})
        if len(bands) >= max_bands:
            break
    return bands or [{"f": 100, "q": 1, "gain": 0}]

def yaml_camilla(res, target="moode", fs=48000):
    bands = peq_bands(res)
    names = ", ".join([f"peq{i+1}" for i in range(len(bands))])
    filt_lines = "\n".join([
        f"  peq{i+1}:\n    type: Biquad\n    parameters:\n"
        f"      type: Peaking\n      freq: {b['f']}\n      Q: {b['q']}\n      gain: {b['gain']}"
        for i, b in enumerate(bands)
    ])
    pre = -4 if target == "moode" else -5
    yaml = f"""title: Measurely auto-peq
devices:
  samplerate: {fs}
  capture:
    type: Stdin
    channels: 2
    format: S24LE
  playback:
    type: Alsa
    channels: 2
    device: hw:0,0
    format: S24LE
filters:
  pre:
    type: Gain
    parameters: {{gain: {pre}}}
{filt_lines}
pipeline:
  - type: Filter
    channels: [0,1]
    names: [pre]
  - type: Filter
    channels: [0]
    names: [{names}]
  - type: Filter
    channels: [1]
    names: [{names}]
"""
    return yaml

# ---------- CLI ----------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Measurely – headache-proof analyser")
    ap.add_argument("session", help="folder with response.csv + impulse.wav  (or left/ right/ sub-dirs)")
    ap.add_argument("--speaker", help="speaker key in ~/measurely/speakers/speakers.json")
    ap.add_argument("--ppo", type=int, default=48, help="points per octave")
    args = ap.parse_args()

    outdir = Path(args.session)
    res = analyse(outdir, ppo=args.ppo, speaker_key=args.speaker)

    # write outputs
    export = {k: v for k, v in res.items() if k not in {"freq", "mag", "ir"}}
    for k in {"bandwidth_lo_3db_hz", "bandwidth_hi_3db_hz", "smoothness_std_db",
            "rt60_s", "edt_s"}:
        if isinstance(export.get(k), np.floating):
            export[k] = float(export[k])
    _atomic_write(outdir / "analysis.json", json.dumps(export, indent=2))
    write_text_summary(outdir, res)
    target = os.getenv("MEASURELY_DSP_TARGET", "moode")
    _atomic_write(outdir / "camilladsp.yaml", yaml_camilla(res, target=target))

    print("Analysis complete →", outdir)

if __name__ == "__main__":
    main()