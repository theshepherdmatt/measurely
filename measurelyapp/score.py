"""
Scoring helpers for Measurely.

Rules:
- Scorers NEVER invent data
- Missing / invalid inputs return NaN
- Validity decisions belong in analyse.py, not here
"""

import numpy as np

DEBUG = True  # Toggle freely


__all__ = [
    "score_bandwidth",
    "score_balance",
    "score_modes",
    "score_smooth",
    "score_ref",
]


# ---------------------------------------------------------
# INTERNAL HELPERS
# ---------------------------------------------------------

def _log(section: str, msg: str):
    if DEBUG:
        print(f"[DEBUG:{section}] {msg}")


def _is_invalid(x):
    return x is None or (isinstance(x, float) and np.isnan(x))


def linmap(x, x0, x1, y0, y1):
    if x0 == x1:
        return (y0 + y1) / 2
    t = max(0.0, min(1.0, (x - x0) / (x1 - x0)))
    return y0 + t * (y1 - y0)


# =========================================================
#  BANDWIDTH
# =========================================================

def score_bandwidth(lo, hi):
    _log("bandwidth", f"Input lo3={lo}, hi3={hi}")

    if _is_invalid(lo) or _is_invalid(hi):
        _log("bandwidth", "Missing bandwidth limits → NaN")
        return np.nan

    # LOW END
    if lo < 40:       slo = 10
    elif lo < 60:     slo = 10 - (lo - 40) * 0.08
    elif lo < 80:     slo = 8.4 - (lo - 60) * 0.10
    elif lo < 100:    slo = 6.4 - (lo - 80) * 0.10
    elif lo < 150:    slo = 4.4 - (lo - 100) * 0.03
    else:             slo = 1.0

    # HIGH END
    if hi > 18000:       shi = 10
    elif hi > 16000:     shi = 8 + (hi - 16000) / 2000 * 2
    elif hi > 14000:     shi = 6 + (hi - 14000) / 2000 * 2
    elif hi > 12000:     shi = 4 + (hi - 12000) / 2000 * 2
    else:                shi = max(1, hi / 12000 * 4)

    score = round((slo + shi) / 2, 1)
    _log("bandwidth", f"low_score={slo:.2f}, high_score={shi:.2f} → {score}")
    return score


# =========================================================
#  BALANCE
# =========================================================

def score_balance(bands: dict, target=None):
    _log("balance", f"bands={bands}, target={target}")

    if not bands or any(_is_invalid(v) for v in bands.values()):
        _log("balance", "Invalid band data → NaN")
        return np.nan

    if target:
        corrected = {}
        for band, val in bands.items():
            try:
                lo, hi = band.split("_")[1:3]
                lo_hz = float(lo.replace("k", "")) * (1000 if "k" in lo else 1)
                hi_hz = float(hi.replace("k", "")) * (1000 if "k" in hi else 1)
                centre = np.sqrt(lo_hz * hi_hz)
                corrected[band] = val - float(target(centre))
            except Exception:
                return np.nan
        values = corrected.values()
    else:
        values = bands.values()

    spread = np.nanmax(list(values)) - np.nanmin(list(values))
    _log("balance", f"spread={spread}")

    if np.isnan(spread):
        return np.nan
    if spread <= 2:
        return 10.0

    score = round(linmap(min(spread, 8), 2, 8, 9, 4), 1)
    _log("balance", f"mapped score={score}")
    return score


# =========================================================
#  MODES (PEAKS & DIPS)
# =========================================================

def score_modes(modes):
    _log("modes", f"modes={modes}")

    if modes is None:
        return np.nan
    if not modes:
        return 10.0

    try:
        max_dev = max(abs(m.get("delta_db", 0)) for m in modes)
    except Exception:
        return np.nan

    _log("modes", f"max deviation={max_dev:.2f} dB")

    if   max_dev < 2:  return 10.0
    elif max_dev < 3:  return 9.0
    elif max_dev < 4:  return 8.0
    elif max_dev < 5:  return 7.0
    elif max_dev < 6:  return 6.0
    elif max_dev < 7:  return 5.0
    elif max_dev < 8:  return 4.0
    elif max_dev < 10: return 3.0
    elif max_dev < 12: return 2.0
    else:              return 1.0


# =========================================================
#  SMOOTHNESS
# =========================================================

def score_smooth(std):
    _log("smoothness", f"std={std}")

    if _is_invalid(std):
        return np.nan

    score = round(linmap(min(std, 8), 0, 8, 10, 0), 1)
    _log("smoothness", f"mapped score={score}")
    return score


# =========================================================
#  REFLECTIONS
# =========================================================

def score_ref(refs):
    _log("reflections", f"refs={refs}")

    if refs is None or len(refs) == 0:
        return np.nan

    early = min(refs)
    _log("reflections", f"first reflection={early} ms")

    if early < 1:
        return 4.0
    if early < 5:
        return 6.5
    return 9.0
