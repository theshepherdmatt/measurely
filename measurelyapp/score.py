"""
AI-optimised scoring helpers for Measurely + full debug logging.
"""

import numpy as np

DEBUG = True  # <---- toggle this any time


__all__ = [
    "score_bandwidth", "score_balance", "score_modes",
    "score_smooth", "score_ref", "score_reverb",
]


# ---------------------------------------------------------
# INTERNAL HELPERS
# ---------------------------------------------------------

def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def _nan_safe(x, fallback=0.0):
    return fallback if x is None or np.isnan(x) else x

def _log(section, msg):
    if DEBUG:
        print(f"[DEBUG:{section}] {msg}")

def linmap(x, x0, x1, y0, y1):
    if x0 == x1:
        return (y0 + y1) / 2
    t = _clamp((x - x0) / (x1 - x0), 0, 1)
    return y0 + t * (y1 - y0)


# =========================================================
#  BANDWIDTH
# =========================================================

def score_bandwidth(lo, hi):
    lo_raw, hi_raw = lo, hi
    lo = _nan_safe(lo, None)
    hi = _nan_safe(hi, None)

    _log("bandwidth", f"Input lo3={lo_raw}, hi3={hi_raw}")

    if lo is None or hi is None:
        _log("bandwidth", "Missing value → returning 5.0")
        return 5.0

    # LOW END SCORING
    if lo < 40:       slo = 10
    elif lo < 60:     slo = 10 - (lo - 40) * 0.08
    elif lo < 80:     slo = 8.4 - (lo - 60) * 0.10
    elif lo < 100:    slo = 6.4 - (lo - 80) * 0.10
    elif lo < 150:    slo = 4.4 - (lo - 100) * 0.03
    else:             slo = 1.0

    # HIGH END SCORING
    if hi > 18000:       shi = 10
    elif hi > 16000:     shi = 8 + (hi - 16000) / 2000 * 2
    elif hi > 14000:     shi = 6 + (hi - 14000) / 2000 * 2
    elif hi > 12000:     shi = 4 + (hi - 12000) / 2000 * 2
    else:                shi = max(1, hi / 12000 * 4)

    score = round((slo + shi) / 2, 1)

    _log("bandwidth", f"low_score={slo:.2f}, high_score={shi:.2f} → final={score}")
    return score


# =========================================================
#  BALANCE
# =========================================================

def score_balance(bands, target=None):
    _log("balance", f"bands={bands}, target={target}")

    def _hz(s: str) -> float:
        return float(s[:-1]) * 1000 if s.endswith("k") else float(s)

    if target:
        corr = {
            k: bands[k] - float(target(np.sqrt(_hz(k.split("_")[1]) *
                                             _hz(k.split("_")[2]))))
            for k in bands
        }
        _log("balance", f"Corrected bands={corr}")
    else:
        corr = bands

    spread = np.nanmax(list(corr.values())) - np.nanmin(list(corr.values()))
    _log("balance", f"spread={spread}")

    if np.isnan(spread):
        _log("balance", "spread is NaN → return 5.0")
        return 5.0
    if spread <= 2:
        _log("balance", "spread <= 2 → return 10.0")
        return 10.0

    score = round(linmap(min(spread, 8), 2, 8, 9, 4), 1)
    _log("balance", f"mapped score={score}")
    return score


# =========================================================
#  MODES (PEAKS & DIPS)
# =========================================================

def score_modes(modes):
    _log("modes", f"input modes={modes}")

    if not modes:
        _log("modes", "No modes detected → 10.0")
        return 10.0

    max_dev = max(abs(m.get("delta_db", 0)) for m in modes)
    _log("modes", f"max deviation={max_dev:.2f} dB")

    # responsive scoring curve
    if   max_dev < 2:  score = 10.0
    elif max_dev < 3:  score = 9.0
    elif max_dev < 4:  score = 8.0
    elif max_dev < 5:  score = 7.0
    elif max_dev < 6:  score = 6.0
    elif max_dev < 7:  score = 5.0
    elif max_dev < 8:  score = 4.0
    elif max_dev < 10: score = 3.0
    elif max_dev < 12: score = 2.0
    else:              score = 1.0

    _log("modes", f"final score={score}")
    return score


# =========================================================
#  SMOOTHNESS
# =========================================================

def score_smooth(std):
    std_raw = std
    std = _nan_safe(std, None)
    _log("smoothness", f"std_raw={std_raw}, safe={std}")

    if std is None:
        _log("smoothness", "std missing → 0")
        return 0

    score = round(linmap(min(std, 8), 0, 8, 10, 0), 1)
    _log("smoothness", f"mapped score={score}")
    return score


# =========================================================
#  REFLECTIONS
# =========================================================

def score_ref(refs):
    _log("reflections", f"refs={refs}")

    if not refs:
        _log("reflections", "No refs → 10.0")
        return 10.0

    early = min(refs)
    _log("reflections", f"first reflection={early} ms")

    if early < 1:
        return 4.0
    if early < 5:
        return 6.5
    return 9.0


# =========================================================
#  REVERB
# =========================================================

def score_reverb(rt60, edt, expected_rt60=None):
    _log("reverb", f"rt60={rt60}, edt={edt}, expected={expected_rt60}")

    rt60 = _nan_safe(rt60, 0.3)
    etd  = _nan_safe(edt,  rt60 * 0.6)

    if expected_rt60 is not None:
        if expected_rt60 <= 0:
            _log("reverb", "expected<=0 → returning 5")
            return 5.0

        deviation = abs(rt60 - expected_rt60) / expected_rt60
        _log("reverb", f"deviation={deviation:.3f}")

        if   deviation < 0.10: score = 10
        elif deviation < 0.20: score = 9
        elif deviation < 0.30: score = 8
        elif deviation < 0.40: score = 7
        elif deviation < 0.50: score = 6
        elif deviation < 0.60: score = 5
        elif deviation < 0.80: score = 4
        elif deviation < 1.20: score = 3
        elif deviation < 1.50: score = 2
        else:                  score = 1

        _log("reverb", f"mapped score={score}")
        return float(score)

    # fallback curve
    diff = abs(rt60 - 0.30)
    _log("reverb", f"fallback diff={diff}")

    if diff < 0.05: return 10
    if diff < 0.10: return 8
    if diff < 0.20: return 6
    if diff < 0.30: return 4
    return 2
