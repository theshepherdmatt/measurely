"""
Room acoustics engine for Measurely.
Predicts modal frequencies, SBIR nulls, RT60, room gain,
listening triangle quality, and full room health metrics.

All values are debug-logged and structured for easy injection
into the scoring engine.

Author: Matt + AI
"""

import numpy as np

DEBUG = True

def _log(section, msg):
    if DEBUG:
        print(f"[ACOUSTICS:{section}] {msg}")

C = 343.0  # speed of sound m/s


# ------------------------------------------------------------
# 1. ROOM GEOMETRY + BASIC METRICS
# ------------------------------------------------------------
def compute_room_geometry(room):
    L = float(room.get("length_m", 0))
    W = float(room.get("width_m", 0))
    H = float(room.get("height_m", 0))

    vol = L * W * H
    area = 2 * (L*W + L*H + W*H)

    # Schroeder frequency
    # ~ 2000 * sqrt(RT60 / V)
    rt_guess = 0.4  # fallback in case of nothing else
    f_sch = 2000 * np.sqrt(rt_guess / max(vol, 1e-6))

    # Critical distance (approx)
    # Dc = 0.15 * sqrt(V / T60)
    Dc = 0.15 * np.sqrt(vol / max(rt_guess, 0.1))

    _log("geometry",
         f"L={L}m W={W}m H={H}m vol={vol:.2f}m³ area={area:.2f}m² "
         f"Schroeder~{f_sch:.1f}Hz Dc~{Dc:.2f}m")

    return {
        "L": L,
        "W": W,
        "H": H,
        "volume": vol,
        "surface_area": area,
        "schroeder_hz": f_sch,
        "critical_distance_m": Dc,
    }


# ------------------------------------------------------------
# 2. ROOM MODES — axial only (best predictor)
# ------------------------------------------------------------
def compute_room_modes(room, max_modes=20):
    L = float(room.get("length_m", 0))
    W = float(room.get("width_m", 0))
    H = float(room.get("height_m", 0))

    dims = [("length", L), ("width", W), ("height", H)]
    modes = []

    for label, dim in dims:
        if dim <= 0:
            continue
        for n in range(1, max_modes + 1):
            f = (C / 2) * (n / dim)
            modes.append({"axis": label, "order": n, "freq": f})

    modes_sorted = sorted(modes, key=lambda m: m["freq"])

    _log("modes",
         "Axial modes: " + ", ".join(f"{m['freq']:.1f}Hz" for m in modes_sorted[:10]))

    return modes_sorted


# ------------------------------------------------------------
# 3. SBIR — Speaker Boundary Interference Response
# ------------------------------------------------------------
def compute_sbir(room):
    """
    SBIR null frequencies:
    f = c / (4 * distance)
    using the speaker_front distance (distance from wall)
    """

    d = float(room.get("spk_front_m", 0.2))  # metres from front wall

    if d <= 0:
        return {}

    f_null = C / (4 * d)

    # Higher-order nulls (odd multiples)
    nulls = [f_null * (2*k + 1) for k in range(6)]

    _log("sbir", f"distance={d} m → nulls={', '.join(f'{n:.1f}Hz' for n in nulls)}")

    return {
        "distance_m": d,
        "nulls_hz": nulls
    }


# ------------------------------------------------------------
# 4. REVERB PREDICTION — Sabine (with absorption model)
# ------------------------------------------------------------
def compute_rt60(room):
    """
    Very simplified but practical frequency-averaged RT60 model.
    Uses surface materials + rug + curtains + sofa to adjust absorption.
    """

    L = float(room.get("length_m"))
    W = float(room.get("width_m"))
    H = float(room.get("height_m"))
    V = L * W * H
    S = 2 * (L*W + L*H + W*H)

    if V <= 0 or S <= 0:
        return {"rt60": 0.30, "absorption": 0.2}

    # Base absorption (bare hard room)
    alpha = 0.10

    # Rug → big absorber
    if room.get("opt_area_rug", False):
        alpha += 0.08

    # Curtains
    if room.get("opt_curtains", False):
        alpha += 0.06

    # Sofa
    if room.get("opt_sofa", False):
        alpha += 0.04

    # Wall art
    if room.get("opt_wallart", False):
        alpha += 0.03

    # Barewalls (penalty)
    if room.get("opt_barewalls", False):
        alpha -= 0.03

    # Floor type
    floor = room.get("floor_material", "hard")
    if floor == "carpet":
        alpha += 0.08

    alpha = max(0.02, min(alpha, 0.8))  # clamp

    # Sabine RT60
    rt60 = 0.161 * V / (S * alpha)

    _log("rt60",
         f"V={V:.2f}m³ S={S:.2f}m² α={alpha:.3f} → RT60≈{rt60:.3f}s")

    return {
        "rt60": rt60,
        "absorption": alpha
    }


# ------------------------------------------------------------
# 5. LISTENING TRIANGLE GEOMETRY
# ------------------------------------------------------------
def compute_triangle(room):
    spacing = float(room.get("spk_spacing_m", 0.0))
    listener = float(room.get("listener_front_m", 0.0))

    if spacing <= 0 or listener <= 0:
        return {
            "ideal": False,
            "ratio": None,
            "penalty": 0,
        }

    ratio = listener / spacing  # ideal = 1.0

    if 0.9 <= ratio <= 1.1:
        penalty = 0
    elif 0.75 <= ratio <= 1.25:
        penalty = 1
    elif 0.50 <= ratio <= 1.50:
        penalty = 2
    else:
        penalty = 3

    _log("triangle", f"spacing={spacing} listener={listener} ratio={ratio:.2f} penalty={penalty}")

    return {
        "ideal": (penalty == 0),
        "ratio": ratio,
        "penalty": penalty,
    }


# ------------------------------------------------------------
# 6. ROOM GAIN PREDICTION
# ------------------------------------------------------------
def compute_room_gain(room):
    L = float(room.get("length_m"))
    W = float(room.get("width_m"))
    H = float(room.get("height_m"))
    V = L * W * H

    if V <= 0:
        return {"gain_hz": 200, "gain_db": 3}

    # Rough rule of thumb:
    # room gain starts ~ (1 / smallest dimension) * c / 2
    dim_min = min(L, W, H)
    gain_freq = C / (2 * dim_min)
    gain_db = 3 + (20 - dim_min) * 0.1  # crude but sensible

    _log("roomgain", f"gain starts ~{gain_freq:.1f}Hz magnitude ~{gain_db:.1f}dB")

    return {
        "gain_hz": gain_freq,
        "gain_db": gain_db
    }


# ------------------------------------------------------------
# MASTER: FULL ROOM MODEL
# ------------------------------------------------------------
def analyse_room(room_json):
    """
    Returns a full room acoustics model dictionary.
    Includes geometry, modes, SBIR, RT prediction,
    triangle alignment and room-gain — plus scoring factors.
    """

    # --- Core sub-models ---
    geometry = compute_room_geometry(room_json)
    modes_list = compute_room_modes(room_json)
    sbir = compute_sbir(room_json)
    rt = compute_rt60(room_json)
    triangle = compute_triangle(room_json)
    gain = compute_room_gain(room_json)

    # Convenience handles
    geo = geometry
    rt60_predicted = rt["rt60"]
    absorption = rt["absorption"]

    # ============================================================
    # ROOM SCORING FACTORS (the bit you were missing)
    # ============================================================

    # 1) Modal severity (only modes below Schroeder matter)
    sch = geo["schroeder_hz"]
    modal_low = [m for m in modes_list if m["freq"] < sch]
    modal_severity = min(len(modal_low) / 12, 1.0)  # normalised 0–1

    # 2) SBIR severity (front-wall distance only)
    d = sbir["distance_m"]
    if d < 0.35:
        sbir_severity = 0.25
    elif d < 0.50:
        sbir_severity = 0.15
    elif d < 0.70:
        sbir_severity = 0.05
    else:
        sbir_severity = 0.0

    # 3) RT60 expected vs predicted (echo slider)
    slider_rt = 0.15 + (room_json.get("echo_pct", 50) / 100.0) * 0.40
    rt_dev = abs(slider_rt - rt60_predicted) / slider_rt
    rt_severity = min(rt_dev, 1.0)

    # Combine → weighted room severity 0–1
    combined = (
        modal_severity * 0.5 +
        sbir_severity * 0.3 +
        rt_severity * 0.2
    )

    # Convert to multiplier 0.85–1.15
    room_factor = 1.15 - (combined * 0.30)
    room_factor = max(0.85, min(room_factor, 1.15))

    # 4) Stereo triangle alignment
    if triangle["penalty"] == 0:
        stereo_factor = 1.10
    elif triangle["penalty"] == 1:
        stereo_factor = 1.00
    else:
        stereo_factor = 0.90

    # ============================================================
    # FINAL OUTPUT MODEL
    # ============================================================

    return {
        "geometry": geometry,
        "modes": modes_list,
        "sbir": sbir,
        "rt60_predicted": rt60_predicted,
        "absorption": absorption,
        "triangle": triangle,
        "room_gain": gain,

        # NEW:
        "room_factor": room_factor,
        "stereo_factor": stereo_factor,
    }
