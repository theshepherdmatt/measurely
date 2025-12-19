"""
Room acoustics prediction engine for Measurely.

Purely geometry- and layout-driven.
NO dependence on sweep data, signal strength, or measurements.

Predicts:
- Axial room modes
- SBIR nulls
- Room gain onset
- Stereo triangle quality
- Aggregate room severity factors

Designed to contextualise measurement results, not alter them.

Author: Matt + AI
"""

import numpy as np

DEBUG = True
C = 343.0  # speed of sound (m/s)


# ------------------------------------------------------------
# Logging
# ------------------------------------------------------------
def _log(section, msg):
    if DEBUG:
        print(f"[ACOUSTICS:{section.upper()}] {msg}")


# ------------------------------------------------------------
# 1. ROOM GEOMETRY
# ------------------------------------------------------------
def compute_room_geometry(room):
    L = float(room.get("length_m", 0.0))
    W = float(room.get("width_m", 0.0))
    H = float(room.get("height_m", 0.0))

    vol = L * W * H
    area = 2.0 * (L * W + L * H + W * H)

    # Schroeder frequency estimate (geometry-only placeholder)
    f_sch = 2000.0 / max(np.sqrt(vol), 1e-6)

    _log(
        "geometry",
        f"L={L:.2f}m W={W:.2f}m H={H:.2f}m | "
        f"V={vol:.1f}m³ A={area:.1f}m² | "
        f"Schroeder≈{f_sch:.1f}Hz"
    )

    return {
        "L": L,
        "W": W,
        "H": H,
        "volume": vol,
        "surface_area": area,
        "schroeder_hz": f_sch,
    }


# ------------------------------------------------------------
# 2. AXIAL ROOM MODES
# ------------------------------------------------------------
def compute_room_modes(room, max_modes=15):
    dims = {
        "length": float(room.get("length_m", 0.0)),
        "width":  float(room.get("width_m", 0.0)),
        "height": float(room.get("height_m", 0.0)),
    }

    modes = []

    for axis, dim in dims.items():
        if dim <= 0:
            continue
        for n in range(1, max_modes + 1):
            f = (C / 2.0) * (n / dim)
            modes.append({"axis": axis, "order": n, "freq_hz": f})

    modes.sort(key=lambda m: m["freq_hz"])

    _log(
        "modes",
        "Lowest axial modes: "
        + ", ".join(f"{m['freq_hz']:.1f}Hz({m['axis'][0]})" for m in modes[:8])
    )

    return modes


# ------------------------------------------------------------
# 3. SBIR (Speaker Boundary Interference)
# ------------------------------------------------------------
def compute_sbir(room):
    d = float(room.get("spk_front_m", 0.0))

    if d <= 0:
        _log("sbir", "No speaker-front-wall distance provided")
        return {"distance_m": None, "nulls_hz": []}

    f0 = C / (4.0 * d)
    nulls = [f0 * (2 * k + 1) for k in range(6)]

    _log(
        "sbir",
        f"front-wall distance={d:.2f}m → "
        f"nulls={', '.join(f'{n:.1f}Hz' for n in nulls)}"
    )

    return {
        "distance_m": d,
        "nulls_hz": nulls,
    }


# ------------------------------------------------------------
# 4. STEREO LISTENING TRIANGLE
# ------------------------------------------------------------
def compute_triangle(room):
    spacing = float(room.get("spk_spacing_m", 0.0))
    listener = float(room.get("listener_front_m", 0.0))

    if spacing <= 0 or listener <= 0:
        _log("triangle", "Incomplete triangle geometry")
        return {
            "ideal": False,
            "ratio": None,
            "penalty": 2,
        }

    ratio = listener / spacing

    if 0.9 <= ratio <= 1.1:
        penalty = 0
    elif 0.75 <= ratio <= 1.25:
        penalty = 1
    else:
        penalty = 2

    _log(
        "triangle",
        f"spacing={spacing:.2f}m listener={listener:.2f}m "
        f"ratio={ratio:.2f} penalty={penalty}"
    )

    return {
        "ideal": penalty == 0,
        "ratio": ratio,
        "penalty": penalty,
    }


# ------------------------------------------------------------
# 5. ROOM GAIN ESTIMATE
# ------------------------------------------------------------
def compute_room_gain(room):
    L = float(room.get("length_m", 0.0))
    W = float(room.get("width_m", 0.0))
    H = float(room.get("height_m", 0.0))

    if min(L, W, H) <= 0:
        _log("roomgain", "Invalid dimensions")
        return {"gain_hz": None, "gain_db": None}

    dim_min = min(L, W, H)
    gain_freq = C / (2.0 * dim_min)
    gain_db = 3.0 + max(0.0, 20.0 - dim_min) * 0.1

    _log(
        "roomgain",
        f"gain onset≈{gain_freq:.1f}Hz magnitude≈{gain_db:.1f}dB"
    )

    return {
        "gain_hz": gain_freq,
        "gain_db": gain_db,
    }


# ------------------------------------------------------------
# MASTER: FULL ROOM MODEL
# ------------------------------------------------------------
def analyse_room(room):
    _log("input", f"Room JSON keys={list(room.keys())}")

    geometry = compute_room_geometry(room)
    modes = compute_room_modes(room)
    sbir = compute_sbir(room)
    triangle = compute_triangle(room)
    gain = compute_room_gain(room)

    # --------------------------------------------------------
    # SEVERITY & CONTEXT FACTORS
    # --------------------------------------------------------
    sch = geometry["schroeder_hz"]

    low_modes = [m for m in modes if m["freq_hz"] < sch]
    modal_severity = min(len(low_modes) / 10.0, 1.0)

    d = sbir.get("distance_m")
    if d is None:
        sbir_severity = 0.15
    elif d < 0.35:
        sbir_severity = 0.30
    elif d < 0.55:
        sbir_severity = 0.15
    else:
        sbir_severity = 0.05

    combined = modal_severity * 0.6 + sbir_severity * 0.4

    room_factor = 1.15 - combined * 0.30
    room_factor = max(0.85, min(room_factor, 1.15))

    stereo_factor = 1.10 if triangle["penalty"] == 0 else (
        1.00 if triangle["penalty"] == 1 else 0.90
    )

    _log(
        "severity",
        f"modal={modal_severity:.2f} sbir={sbir_severity:.2f} "
        f"combined={combined:.2f}"
    )

    _log(
        "factors",
        f"room_factor={room_factor:.2f} stereo_factor={stereo_factor:.2f}"
    )

    # --------------------------------------------------------
    # TRIM MODES FOR AI / UI (CRITICAL)
    # --------------------------------------------------------
    MAX_AI_MODES = 8

    trimmed_modes = [
        {
            "axis": m["axis"],
            "freq_hz": round(m["freq_hz"], 1),
        }
        for m in modes
        if m["freq_hz"] < geometry["schroeder_hz"]
    ]

    trimmed_modes = trimmed_modes[:MAX_AI_MODES]

    return {
        "geometry": geometry,
        "modes": trimmed_modes,
        "sbir": sbir,
        "triangle": triangle,
        "room_gain": gain,
        "room_factor": room_factor,
        "stereo_factor": stereo_factor,
    }

