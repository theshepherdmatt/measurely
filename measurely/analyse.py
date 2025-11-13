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
from measurely.io import load_session
from measurely.signal import log_bins, band_mean, modes, bandwidth_3db, smoothness, early_reflections, rt60_edt
from measurely.score import score_bandwidth, score_balance, score_modes, score_smooth, score_ref, score_reverb
from measurely.speaker import load_target_curve
from measurely.writer import _atomic_write, write_text_summary, yaml_camilla
from measurely.buddy import ask_buddy, ask_buddy_full, plain_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", stream=sys.stdout)
log = logging.getLogger("measurely")

def analyse(session_dir: Path, ppo: int = 48, speaker_key: str | None = None):
    freq, mag, ir, fs, label = load_session(session_dir)
    freq, mag = log_bins(freq, mag, ppo=ppo)

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
    rt       = rt60_edt(ir, fs)

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
    scores["overall"] = round(np.mean(list(scores.values())), 1)

    # friendly text
    buddy_headline, buddy_actions = ask_buddy(notes, scores)
    if not buddy_headline:               # LLM offline
        buddy_headline, buddy_actions = plain_summary({
            "band_levels_db": bands,
            "reflections_ms": refs,
            "rt60_s": rt["rt60"],
        })
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

    # --- write files ---
    write_text_summary(session_dir, export)
    target = os.getenv("MEASURELY_DSP_TARGET", "moode")
    # drop huge arrays, cast leftovers
    export_out = {k: v for k, v in export.items() if k not in {"freq", "mag", "ir"}}
    _atomic_write(session_dir / "analysis.json", json.dumps(export_out, indent=2, default=str))
    _atomic_write(session_dir / "camilladsp.yaml", yaml_camilla(export_out, target=target))

    print("Analysis complete →", session_dir)
    return export


# ---------- CLI ----------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Measurely – headache-proof analyser")
    ap.add_argument("session", help="folder with response.csv + impulse.wav  (or left/ right/ sub-dirs)")
    ap.add_argument("--speaker", help="speaker key in ~/measurely/speakers/speakers.json")
    ap.add_argument("--ppo", type=int, default=48, help="points per octave")
    args = ap.parse_args()

    session_dir = Path(args.session)
    analyse(session_dir, ppo=args.ppo, speaker_key=args.speaker)


if __name__ == "__main__":
    main()