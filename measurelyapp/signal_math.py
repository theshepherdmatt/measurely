"""DSP helpers: bins, modes, RT60, etc."""
import numpy as np

__all__ = [
    "log_bins", "band_mean", "modes", "bandwidth_3db", "smoothness",
    "early_reflections", "rt60_edt",
]

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

def modes(f, m, thresh=4, min_sep=10):
    """Peak/dip finder that works on low-resolution or binned data.
       Adaptive window, safe even when PPO < 20.
    """
    f = np.asarray(f)
    m = np.asarray(m)

    if f.size < 8:
        return []

    # Estimate bins per octave (bpo)
    ratios = f[1:] / f[:-1]
    log_steps = np.log2(ratios)
    median_step = np.median(log_steps)
    if median_step <= 0:
        return []

    bpo = 1.0 / median_step

    # Adaptive smoother:
    # - if bpo is small (<24 PPO), don't blur too much
    # - if bpo is large (raw data), smooth more
    win = max(3, int(round(bpo / 4)))

    base = np.convolve(m, np.ones(win) / win, mode="same")
    delta = m - base

    out = []
    last = -np.inf

    for i, d in enumerate(delta):
        if abs(d) >= thresh and (f[i] - last) >= min_sep:
            out.append({
                "type": "peak" if d > 0 else "dip",
                "freq_hz": float(f[i]),
                "delta_db": float(d)
            })
            last = f[i]

    return out

def apply_mic_calibration(f, m, mic_type="omnitronic_mm2"):
    """
    Applies a compensation curve to flatten the response of value-tier mics.
    For the MM-2, we counteract the roll-off starting at 10kHz.
    """
    f, m = np.asarray(f), np.asarray(m)
    if mic_type == "omnitronic_mm2":
        # Create a compensation mask for frequencies above 10kHz
        comp = np.zeros_like(m)
        mask = (f > 10000) & (f <= 20000)
        
        if np.any(mask):
            # Apply a linear lift: 0dB at 10kHz to +6dB at 18kHz
            # This 'pushes' the 11kHz roll-off back to a realistic range
            comp[mask] = (f[mask] - 10000) / (18000 - 10000) * 6.0
            
        return m + comp
    return m


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

    edt = None
    s   = slope(0, -10)
    if s and s < -1e-6:
        edt = float((-60/s) * (10/60))

    rt60 = method = None
    for (lo, hi, tag) in [(-5, -35, "T30"), (-5, -25, "T20")]:
        s = slope(lo, hi)
        if s and s < -1e-6:
            rt60, method = float(-60/s), tag
            break
    if rt60 and not 0.1 <= rt60 <= 2.5:
        rt60 = method = None
    return {"rt60": rt60, "method": method, "edt": edt}
