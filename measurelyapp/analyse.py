#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse, json, os, sys, logging
from pathlib import Path
import numpy as np

from measurelyapp.io import load_session
from measurelyapp.signal_math import (
    log_bins, band_mean, modes, bandwidth_3db, smoothness,
    early_reflections, rt60_edt
)
from measurelyapp.score import (
    score_bandwidth, score_balance, score_modes,
    score_smooth, score_ref, score_reverb
)
from measurelyapp.speaker import load_target_curve
from measurelyapp.writer import _atomic_write, write_text_summary, yaml_camilla
from measurelyapp.dave import dave_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("analyse")


def analyse(session_dir: Path, ppo: int = 48, speaker_key: str | None = None):


    from measurelyapp.dave import dave_summary

    # ---------------------------------------------------------
    # LOAD INPUT
    # ---------------------------------------------------------
    freq, mag, ir, fs, label = load_session(session_dir)

    # ---------------------------------------------------------
    # LOAD ROOM SETTINGS (GLOBAL, PERSISTENT)
    # ---------------------------------------------------------

    room_file = Path.home() / "measurely" / "room.json"

    defaults = {
        "speaker_key": None,
        "toe_in_deg": 0,
        "echo_pct": 50,
        "opt_hardfloor": False,
        "opt_barewalls": False,
        "opt_rug": False,
        "opt_curtains": False,
        "opt_sofa": False,
        "opt_wallart": False,
    }

    if room_file.exists():
        room = { **defaults, **json.loads(room_file.read_text()) }
        print("Loaded room settings from room.json")
    else:
        print("WARNING: room.json missing, using defaults")
        room = defaults.copy()



    # ---------------------------------------------------------
    # DSP PIPELINE
    # ---------------------------------------------------------

    # Graph bins — UI consumes this
    freq_ui, mag_ui = log_bins(freq, mag, ppo=ppo)
    print(f"UI: {len(freq_ui)} points ({ppo} PPO)")

    # Raw bins for analysis — capped for correct mode detection
    ppo_raw = min(ppo, 12)
    freq_raw, mag_raw = log_bins(freq, mag, ppo=ppo_raw)
    print(f"Analysis: {len(freq_raw)} points ({ppo_raw} PPO)")

    # ----------- band energy ----------------
    bands = {
        "bass_20_200":   band_mean(freq_raw, mag_raw, 20, 200),
        "mid_200_2k":    band_mean(freq_raw, mag_raw, 200, 2000),
        "treble_2k_10k": band_mean(freq_raw, mag_raw, 2000, 10000),
        "air_10k_20k":   band_mean(freq_raw, mag_raw, 10000, 20000),
    }

    lo3, hi3 = bandwidth_3db(freq_raw, mag_raw)
    mods     = modes(freq_raw, mag_raw)
    mods     = [m for m in mods if m["freq_hz"] <= 1000]
    sm       = smoothness(freq_raw, mag_raw)
    refs     = early_reflections(ir, fs)
    rt       = rt60_edt(ir, fs)

    # Furnishing modifiers
    if refs:
        if room.get("opt_hardfloor"): refs = [r * 1.10 for r in refs]
        if room.get("opt_barewalls"): refs = [r * 1.08 for r in refs]
        if room.get("opt_rug"):       refs = [r * 0.90 for r in refs]
        if room.get("opt_curtains"):  refs = [r * 0.85 for r in refs]
        if room.get("opt_sofa"):      refs = [r * 0.95 for r in refs]

    # Echo slider modifies RT
    if isinstance(rt, dict) and rt.get("rt60"):
        echo_pct = room.get("echo_pct", 50)
        rt_mod = (echo_pct - 50) / 200.0
        rt["rt60"] *= (1 + rt_mod)

    # ---------------------------------------------------------
    # SCORING
    # ---------------------------------------------------------
    target_curve = load_target_curve(speaker_key)

    scores = {
        "bandwidth":   score_bandwidth(lo3, hi3),
        "balance":     score_balance(bands, target_curve),
        "peaks_dips":  score_modes(mods),
        "smoothness":  score_smooth(sm),
        "reflections": score_ref(refs or [5]),
        "reverb": score_reverb(rt.get("rt60") or 0.5, rt.get("edt") or 0.5),
    }

    scores["overall"] = round(np.mean(list(scores.values())), 1)

    # --- scores have just been computed ---
    print("\n=== DAVE DEBUG START ===")
    print("Scores passed into dave_summary:", scores)

    summary, actions = dave_summary(scores)

    print("dave_summary returned:", summary)
    print("dave_actions returned:", actions)
    print("=== DAVE DEBUG END ===\n")


    # Furnishing damping modifies reflections
    damping = 0
    if room.get("opt_rug"):        damping += 0.2
    if room.get("opt_curtains"):   damping += 0.2
    if room.get("opt_sofa"):       damping += 0.1
    if room.get("opt_hardfloor"):  damping -= 0.2
    if room.get("opt_barewalls"):  damping -= 0.2

    scores["reflections"] *= (1 - damping)
    
    # DAVE SUMMARY ENGINE
    summary, actions = dave_summary(scores)

    # ---------------------------------------------------------
    # EXPORT CLEAN JSON
    # ---------------------------------------------------------
    export = {
        "label": label,
        "fs": fs,
        "freq": freq_ui.tolist(),
        "mag": mag_ui.tolist(),

        "bandwidth_lo_3db_hz": lo3,
        "bandwidth_hi_3db_hz": hi3,
        "band_levels_db": bands,
        "smoothness_std_db": sm,
        "modes": mods,
        "reflections_ms": refs,
        "rt60_s": rt["rt60"],
        "edt_s": rt["edt"],

        "scores": scores,
        "speaker_profile": speaker_key,
        "room": room,

        "dave": {
            "summary": summary or "",
            "actions": actions or [],
            "overall_score": scores.get("overall"),
            "speaker_friendly_name": (
                speaker_key.replace("_", " ").title()
                if speaker_key else room.get("speaker_friendly_name", "")
            )
        },
    }

    # ---------------------------------------------------------
    # WRITE FILES
    # ---------------------------------------------------------
    write_text_summary(session_dir, export)

    export_small = export.copy()
    _atomic_write(session_dir / "analysis.json",
                  json.dumps(export_small, indent=2))

    target = os.getenv("MEASURELY_DSP_TARGET", "moode")
    _atomic_write(session_dir / "camilladsp.yaml",
                  yaml_camilla(export_small, target=target))

    meta_file = session_dir / "meta.json"

    # Load old meta so we don’t wipe room settings
    old_meta = {}
    if meta_file.exists():
        try:
            old_meta = json.loads(meta_file.read_text())
        except:
            old_meta = {}

    # Preserve settings.room
    export_small["settings"] = old_meta.get("settings", {})

    _atomic_write(meta_file, json.dumps(export_small, indent=2))


    print("Analysis complete →", session_dir)
    return export


# CLI
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session")
    ap.add_argument("--speaker")
    ap.add_argument("--ppo", type=int, default=48)
    args = ap.parse_args()
    analyse(Path(args.session), ppo=args.ppo, speaker_key=args.speaker)


if __name__ == "__main__":
    main()