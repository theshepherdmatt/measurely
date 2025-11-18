#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Measurely – headache-proof analyser
------------------------------------
Thin orchestrator:
1. load measurement
2. run dsp pipeline
3. ask buddy module for friendly text
4. write outputs
"""

import argparse, json, os, sys, logging
from pathlib import Path
import numpy as np

# our own tiny SDK
from measurelyapp.io import load_session
from measurelyapp.signal import log_bins, band_mean, modes, bandwidth_3db, smoothness, early_reflections, rt60_edt
from measurelyapp.score import score_bandwidth, score_balance, score_modes, score_smooth, score_ref, score_reverb
from measurelyapp.speaker import load_target_curve
from measurelyapp.writer import _atomic_write, write_text_summary, yaml_camilla
from measurelyapp.buddy import ask_buddy, ask_buddy_full, plain_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", stream=sys.stdout)
log = logging.getLogger("measurely")

def analyse(session_dir: Path, ppo: int = 48, speaker_key: str | None = None):
    freq, mag, ir, fs, label = load_session(session_dir)

    # --- ROOM CONFIG LOADING (MUST BE ABOVE DSP) ---
    room = {}

    latest_meta = Path.home() / "measurely" / "measurements" / "latest" / "meta.json"

    if latest_meta.exists():
        print("\nLoaded room settings from LATEST/meta.json")
        meta = json.loads(latest_meta.read_text())
        room = meta.get("settings", {}).get("room", {})
    else:
        print("\nERROR: latest/meta.json not found. Using empty room settings.")
        room = {}


        print("=== ANALYSE: Loaded session ===")
        print(f"Session folder: {session_dir}")
        print(f"Label: {label}")
        print(f"Impulse length: {len(ir)} samples")
        print(f"Raw response points: {len(freq)}")

    freq, mag = log_bins(freq, mag, ppo=ppo)
    print(f"After log-binning: {len(freq)} points, {ppo} PPO")


    bands = {
        "bass_20_200":   band_mean(freq, mag, 20, 200),
        "mid_200_2k":    band_mean(freq, mag, 200, 2000),
        "treble_2k_10k": band_mean(freq, mag, 2000, 10000),
        "air_10k_20k":   band_mean(freq, mag, 10000, 20000),
    }
    lo3, hi3 = bandwidth_3db(freq, mag)
    mods     = modes(freq, mag)
    sm       = smoothness(freq, mag)
    refs     = early_reflections(ir, fs)
    # --- Room impact: furnishings modify reflection intensity ---
    if refs:
        if room.get("opt_hardfloor"): refs = [r * 1.10 for r in refs]
        if room.get("opt_barewalls"): refs = [r * 1.08 for r in refs]
        if room.get("opt_rug"):       refs = [r * 0.90 for r in refs]
        if room.get("opt_curtains"):  refs = [r * 0.85 for r in refs]
        if room.get("opt_sofa"):      refs = [r * 0.95 for r in refs]

    rt       = rt60_edt(ir, fs)
    # --- Room impact: echo slider adjusts RT60 ---
    if isinstance(rt, dict) and rt.get("rt60"):
        echo_pct = room.get("echo_pct", 50)
        rt_mod = (echo_pct - 50) / 200.0     # -0.25 → +0.25
        rt["rt60"] *= (1 + rt_mod)


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

    target_curve = load_target_curve(speaker_key)
    scores = {
        "bandwidth":   score_bandwidth(lo3, hi3),
        "balance":     score_balance(bands, target_curve),
        "peaks_dips":  score_modes(mods),
        "smoothness":  score_smooth(sm),
        "reflections": score_ref(refs),
        "reverb":      score_reverb(rt["rt60"], rt["edt"]),
    }

    # room damping modifies reflection score
    damping = 0
    if room.get("opt_rug"): damping += 0.2
    if room.get("opt_curtains"): damping += 0.2
    if room.get("opt_sofa"): damping += 0.1
    if room.get("opt_hardfloor"): damping -= 0.2
    if room.get("opt_barewalls"): damping -= 0.2

    scores["reflections"] *= (1 - damping)

    scores["overall"] = round(np.mean(list(scores.values())), 1)

    # friendly text
    buddy_headline, buddy_actions = ask_buddy(notes, scores)
    if not buddy_headline:
        buddy_headline, buddy_actions = plain_summary({
            "band_levels_db": bands,
            "reflections_ms": refs,
            "rt60_s": rt["rt60"],
        })

    # Furnishing-aware buddy text
    room_bits = []
    if room.get("opt_hardfloor"):
        room_bits.append("Your hardwood/laminate floor increases early reflections.")
    if room.get("opt_rug"):
        room_bits.append("Your rug helps reduce first reflections and smooths the mids.")
    if room.get("opt_curtains"):
        room_bits.append("Curtains soften top-end reflections and reduce RT60.")
    if room.get("opt_barewalls"):
        room_bits.append("Bare walls mean sound has less absorption, making the room lively.")
    if room.get("opt_wallart"):
        room_bits.append("Wall art or shelves help scatter reflections slightly.")
    if room.get("opt_sofa"):
        room_bits.append("Your sofa absorbs some midrange energy and controls decay.")
    if room.get("echo_pct", 50) > 60:
        room_bits.append("Your room is on the lively/echoey side — expect more reflections.")
    if room.get("echo_pct", 50) < 40:
        room_bits.append("Your room is on the damped side — reflections will be lower.")

    # ---> merge into notes
    notes.extend(room_bits)

    buddy_full = ask_buddy_full({
        "band_levels_db": bands,
        "modes": mods,
        "reflections_ms": refs,
        "rt60_s": rt["rt60"],
        "scores": scores,
    })


    export = {
        "freq": freq, "mag": mag, "ir": ir, "fs": fs, "label": label,
        "bandwidth_lo_3db_hz": lo3, "bandwidth_hi_3db_hz": hi3,
        "band_levels_db": bands,
        "smoothness_std_db": sm,
        "modes": mods,
        "reflections_ms": refs,
        "rt60_s": rt["rt60"], "rt60_method": rt["method"], "edt_s": rt["edt"],
        "notes": notes,
        "scores": scores,
        "buddy_summary": buddy_headline,
        "buddy_actions": buddy_actions,
        "buddy_freq_blurb":   buddy_full.get("freq", ""),
        "buddy_treat_blurb":  buddy_full.get("treat", ""),
        "buddy_action_blurb": buddy_full.get("action", ""),
    }

    print("\nParsed room settings:")
    print(f"  Room length (m):       {room.get('length_m')}")
    print(f"  Room width (m):        {room.get('width_m')}")
    print(f"  Room height (m):       {room.get('height_m')}")
    print(f"  Listener distance (m): {room.get('listener_front_m')}")
    print(f"  Speaker front dist (m):{room.get('spk_front_m')}")
    print(f"  Speaker spacing (m):   {room.get('spk_spacing_m')}")
    print(f"  Toe-in angle (deg):    {room.get('toe_in_deg')}")
    print(f"  Speaker profile:       {room.get('speaker_key')}")
    print(f"  Echo slider (%):       {room.get('echo_pct')}")
    print(f"  Hard floor:            {room.get('opt_hardfloor')}")
    print(f"  Rug:                   {room.get('opt_rug')}")
    print(f"  Curtains:              {room.get('opt_curtains')}")
    print(f"  Bare walls:            {room.get('opt_barewalls')}")
    print(f"  Wall art:              {room.get('opt_wallart')}")
    print(f"  Sofa:                  {room.get('opt_sofa')}")


    export["room"] = room

    # --- AUTO-SELECT SPEAKER KEY FROM ROOM CONFIG ---
    if not speaker_key:
        speaker_key = room.get("speaker_key")
        print(f"\nAuto-selected speaker key from room config: {speaker_key}")

    # --- SPEAKER PROFILE DEBUG ---
    print("\n--- SPEAKER PROFILE LOADING ---")
    print(f"Requested speaker key: {speaker_key}")

    # Load curve again so we can inspect it
    curve = load_target_curve(speaker_key)

    # Print where the speaker catalogue lives
    from measurelyapp.speaker import SPEAKER_DIR
    print(f"SPEAKER_DIR: {SPEAKER_DIR}")

    # Print speakers.json
    catalogue_path = SPEAKER_DIR / "speakers.json"
    if catalogue_path.exists():
        print(f"Found speakers.json at: {catalogue_path}")
        try:
            catalogue = json.loads(catalogue_path.read_text())
            print("speakers.json contents (beautified):")
            print(json.dumps(catalogue, indent=2))
        except Exception as e:
            print(f"ERROR reading speakers.json: {e}")
    else:
        print("ERROR: speakers.json NOT FOUND")

    # Now print the specific entry used
    if speaker_key and speaker_key in catalogue:
        entry = catalogue[speaker_key]
        print(f"\nSpeaker entry for '{speaker_key}':")
        print(json.dumps(entry, indent=2))

        target_file = SPEAKER_DIR / entry["folder"] / entry["target_curve"]
        print(f"Target curve file resolved to: {target_file}")
    else:
        print(f"No catalogue entry found for speaker key '{speaker_key}'")

    # Print actual curve data (interpolated)
    if curve is None:
        print("Curve load FAILED — no curve available.")
    else:
        print("\nCurve load SUCCESS.")
        try:
            print(f"Curve frequency range: {curve.x[0]} Hz → {curve.x[-1]} Hz")
            print("First 10 frequencies:", np.round(curve.x[:10], 2))
            print("First 10 targets (dB):", np.round(curve.y[:10], 2))
            print("Last 10 frequencies:", np.round(curve.x[-10:], 2))
            print("Last 10 targets (dB):", np.round(curve.y[-10:], 2))
        except Exception as e:
            print(f"ERROR inspecting curve: {e}")

    # Make sure export sees it:
    export["speaker_profile"] = speaker_key


    # --- write files ---
    write_text_summary(session_dir, export)
    target = os.getenv("MEASURELY_DSP_TARGET", "moode")
    # drop huge arrays, cast leftovers
    export_out = {k: v for k, v in export.items() if k not in {"freq", "mag", "ir"}}
    _atomic_write(session_dir / "analysis.json", json.dumps(export_out, indent=2, default=str))
    _atomic_write(session_dir / "camilladsp.yaml", yaml_camilla(export_out, target=target))
    _atomic_write(session_dir / "meta.json",     json.dumps(export_out, indent=2, default=str))   # <--- ADD THIS LINE


    print("Analysis complete →", session_dir)
    return export


# ---------- CLI ----------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="measurely – headache-proof analyser")
    ap.add_argument("session", help="folder with response.csv + impulse.wav  (or left/ right/ sub-dirs)")
    ap.add_argument("--speaker", help="speaker key in ~/measurely/speakers/speakers.json")
    ap.add_argument("--ppo", type=int, default=48, help="points per octave")
    args = ap.parse_args()

    session_dir = Path(args.session)
    analyse(session_dir, ppo=args.ppo, speaker_key=args.speaker)


if __name__ == "__main__":
    main()