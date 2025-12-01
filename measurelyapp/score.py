"""Scoring helpers."""
import numpy as np

__all__ = [
    "score_bandwidth", "score_balance", "score_modes",
    "score_smooth", "score_ref", "score_reverb",
]

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
    dev = max(min(abs(m["delta_db"]), 15) for m in modes)
    return round(linmap(dev, 0, 15, 10, 0), 1)


def score_smooth(std):
    if std is None or np.isnan(std):
        return 0
    return round(linmap(min(std, 8), 0, 8, 10, 0), 1)

def score_ref(refs):
    if not refs:
        return 10.0

    # Use ONLY the *first* strong reflection (the one that matters)
    early = min(refs)

    # If it's extremely early (<1ms) = bad
    if early < 1:
        return 4.0

    # If it's between 1–5ms = okay-ish
    if early < 5:
        return 6.5

    # If it's after 5ms = good
    return 9.0

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
