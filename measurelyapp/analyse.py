#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import logging
from pathlib import Path

import numpy as np

from measurelyapp.io import load_session
from measurelyapp.signal_math import (
    log_bins,
    band_mean,
    modes,
    bandwidth_3db,
    smoothness,
    early_reflections,
    apply_mic_calibration,
)
from measurelyapp.score import (
    score_bandwidth,
    score_balance,
    score_modes,
    score_smooth,
    score_ref,
)
from measurelyapp.speaker import load_target_curve
from measurelyapp.writer import _atomic_write, yaml_camilla

from measurelyapp.acoustics import analyse_room

# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("analyse")


# ---------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------
ANALYSIS_STATUS_FILE = "/tmp/measurely_analysis_status.json"
MAX_F_REPORT = 18_000

SWEEP_PEAK_MIN = 1e-4
SWEEP_SNR_MIN_DB = 10.0

# Signal Integrity thresholds
SIGINT_SNR_MIN_DB = 10.0
SIGINT_SNR_GOOD_DB = 25.0
SIGINT_PEAK_SOFT_MIN = 5e-4

SIGINT_HARD_FAIL = 0.0
SIGINT_SOFT_MIN = 5.0
SIGINT_SOFT_CAP = 6.5


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def update_analysis_status(message: str, progress: int, running: bool = True):
    try:
        with open(ANALYSIS_STATUS_FILE, "w") as f:
            json.dump(
                {"running": running, "progress": progress, "message": message},
                f,
            )
    except Exception as e:
        log.error(f"Status write failed: {e}")


def smooth_curve(y: np.ndarray, window: int = 9) -> np.ndarray:
    if window < 3:
        return y
    pad = window // 2
    ypad = np.pad(y, (pad, pad), mode="edge")
    return np.convolve(ypad, np.ones(window) / window, mode="valid")


def assess_sweep_validity(ir: np.ndarray, fs: int) -> tuple[bool, str | None]:
    if ir.size == 0:
        return False, "empty_impulse_response"

    ir_abs = np.abs(ir)
    peak = float(np.max(ir_abs))

    if peak < SWEEP_PEAK_MIN:
        return False, "no_signal_detected"

    tail = ir_abs[int(len(ir_abs) * 0.8):]
    noise = float(np.median(tail)) + 1e-12
    snr = 20.0 * np.log10(peak / noise)

    log.info(f"Sweep SNR: {snr:.1f} dB")

    if snr < SWEEP_SNR_MIN_DB:
        return False, "insufficient_snr"

    return True, None


def compute_signal_integrity(ir: np.ndarray) -> dict:
    if ir.size == 0:
        return {"score": 0.0, "snr_db": None, "peak": 0.0, "noise_floor": None}

    ir_abs = np.abs(ir)
    peak = float(np.max(ir_abs))

    if peak < SWEEP_PEAK_MIN:
        return {"score": 0.0, "snr_db": None, "peak": peak, "noise_floor": None}

    tail = ir_abs[int(len(ir_abs) * 0.8):]
    noise = float(np.median(tail)) + 1e-12
    snr = 20.0 * np.log10(peak / noise)

    if snr <= 0:
        score = 0.0
    else:
        score = 3.0 + (snr - SIGINT_SNR_MIN_DB) * (
            7.0 / (SIGINT_SNR_GOOD_DB - SIGINT_SNR_MIN_DB)
        )
        score = max(0.0, min(10.0, score))

        if peak < SIGINT_PEAK_SOFT_MIN:
            score = min(score, 5.0)

    return {
        "score": round(score, 1),
        "snr_db": round(snr, 1),
        "peak": round(peak, 6),
        "noise_floor": round(noise, 6),
    }


def score_clarity(refs, smoothness_std, has_coffee_table=False):
    score = 10.0

# First reflection penalty
    if refs:
        first = refs[0]
        # Awareness: 0.77ms is typical for a coffee table bounce
        if 0.6 <= first <= 0.9 and has_coffee_table:
            score -= 0.5  # A "realistic" minor penalty instead of -2.0
        elif first < 1.5:
            score -= 2.0
        elif first < 3.0:
            score -= 1.0

    # Reflection density penalty (first 5 ms)
    early = [r for r in refs if r <= 5.0]
    n = len(early)
    if n > 12:
        score -= 3
    elif n > 8:
        score -= 2
    elif n > 4:
        score -= 1

    # Smoothness penalty
    if smoothness_std > 4.0:
        score -= 3
    elif smoothness_std > 3.0:
        score -= 2
    elif smoothness_std > 2.0:
        score -= 1

    return round(max(0.0, min(10.0, score)), 1)


# ---------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------
def analyse(session_dir: Path, ppo: int = 48, speaker_key: str | None = None):

    freq, mag, ir, fs, label = load_session(session_dir)
    update_analysis_status("Loaded sweep data", 5)

    room_file = Path.home() / "measurely" / "room.json"
    if not room_file.exists():
        raise RuntimeError("room.json missing — room setup must be completed first")

    json.loads(room_file.read_text())
    log.info("Loaded room settings")

    room = json.loads(room_file.read_text())
    has_coffee_table = room.get("settings", {}).get("room", {}).get("opt_coffee_table", False)

    sweep_valid, invalid_reason = assess_sweep_validity(ir, fs)
    signal_integrity = compute_signal_integrity(ir)

    log.info(
        f"Signal Integrity → score={signal_integrity['score']} "
        f"SNR={signal_integrity.get('snr_db')} dB "
        f"peak={signal_integrity['peak']}"
    )

    freq_ui, mag_ui = log_bins(freq, mag, ppo=ppo)
    mag_ui = apply_mic_calibration(freq_ui, mag_ui, mic_type="omnitronic_mm2")
    update_analysis_status("Computing UI frequency bins…", 15)

    ppo_raw = min(ppo, 12)
    freq_raw, mag_raw = log_bins(freq, mag, ppo=ppo_raw)
    update_analysis_status("Processing analysis bins…", 25)
    # Apply calibration to the raw data used for scoring and bandwidth
    mag_raw = apply_mic_calibration(freq_raw, mag_raw, mic_type="omnitronic_mm2")

    lo3, hi3 = bandwidth_3db(freq_raw, mag_raw)
    mode_list = [m for m in modes(freq_raw, mag_raw) if m["freq_hz"] <= 1000]
    sm = smoothness(freq_raw, mag_raw)       
    # Get all reflections
    raw_refs = early_reflections(ir, fs)
    refs = [r for r in raw_refs if r > 0.5] 

    clarity = score_clarity(refs, sm, has_coffee_table=has_coffee_table)

    freqs = np.asarray(freq_ui)
    mags = smooth_curve(np.asarray(mag_ui)[freqs <= MAX_F_REPORT])
    freqs = freqs[freqs <= MAX_F_REPORT]

    _atomic_write(
        session_dir / "report_curve.json",
        json.dumps({"freqs": freqs.tolist(), "mag": mags.tolist()}, indent=2),
    )

    if not sweep_valid:
        export = {
            "label": label,
            "fs": fs,
            "freq": freq_ui.tolist(),
            "mag": mag_ui.tolist(),
            "scores": {
                "bandwidth": np.nan,
                "balance": np.nan,
                "peaks_dips": np.nan,
                "smoothness": np.nan,
                "reflections": np.nan,
                "signal_integrity": signal_integrity["score"],
                "overall": np.nan,
            },
            "analysis_meta": {
                "engine": "measurely-core",
                "version": "1.0",
                "valid_sweep": False,
                "invalid_reason": invalid_reason,
            },
        }

        _atomic_write(session_dir / "analysis.json", json.dumps(export, indent=2))
        _atomic_write(session_dir / "analysis_ai.json", json.dumps(export, indent=2))
        update_analysis_status("Invalid sweep detected", 100, running=False)
        return export

    bands = {
        "bass_20_200": band_mean(freq_raw, mag_raw, 20, 200),
        "mid_200_2k": band_mean(freq_raw, mag_raw, 200, 2000),
        "treble_2k_10k": band_mean(freq_raw, mag_raw, 2000, 10000),
        "air_10k_20k": band_mean(freq_raw, mag_raw, 10000, 20000),
    }
  
    target_curve = load_target_curve(speaker_key)

    scores = {
        "bandwidth": score_bandwidth(lo3, hi3),
        "balance": score_balance(bands, target_curve),
        "peaks_dips": score_modes(mode_list),
        "smoothness": score_smooth(sm),
        "reflections": score_ref(refs),
        "clarity": clarity,
    }

    base_scores = [
        scores["bandwidth"],
        scores["balance"],
        scores["peaks_dips"],
        scores["smoothness"],
        scores["reflections"],
        scores["clarity"],
    ]

    base_overall = np.nanmean(base_scores)

    if signal_integrity["score"] <= SIGINT_HARD_FAIL:
        scores["overall"] = np.nan
    elif signal_integrity["score"] < SIGINT_SOFT_MIN:
        scores["overall"] = round(min(base_overall, SIGINT_SOFT_CAP), 1)
    else:
        scores["overall"] = round(base_overall, 1)

    export = {
        "label": label,
        "fs": fs,
        "freq": freq_ui.tolist(),
        "mag": mag_ui.tolist(),
        "band_levels_db": bands,
        "bandwidth_lo_3db_hz": lo3,
        "bandwidth_hi_3db_hz": hi3,
        "smoothness_std_db": sm,
        "modes": mode_list,
        "reflections_ms": refs,
        "signal_integrity": signal_integrity,
        "scores": scores,
        "speaker_profile": speaker_key,
        "analysis_meta": {
            "engine": "measurely-core",
            "version": "1.0",
            "valid_sweep": True,
            "signal_integrity": {
                "score": signal_integrity["score"],
                "hard_fail": bool(signal_integrity["score"] <= SIGINT_HARD_FAIL),
                "soft_fail": bool(signal_integrity["score"] < SIGINT_SOFT_MIN),

            },
        },
    }


    try:
        acoustics_context = analyse_room(room)
    except Exception as e:
        log.warning(f"Acoustics analysis failed: {e}")
        acoustics_context = None
            
    log.info("Acoustics context attached to analysis_ai.json")

    ai_export = {
        "label": label,
        "scores": scores,
        "band_levels_db": bands,
        "bandwidth_3db_hz": {"low": lo3, "high": hi3},
        "smoothness_std_db": sm,
        "reflections_ms": refs[:5],
        "signal_integrity": signal_integrity,
        "room_context": acoustics_context,
    }

    _atomic_write(session_dir / "analysis.json", json.dumps(export, indent=2))
    _atomic_write(session_dir / "analysis_ai.json", json.dumps(ai_export, indent=2))

    target = os.getenv("MEASURELY_DSP_TARGET", "moode")
    _atomic_write(
        session_dir / "camilladsp.yaml",
        yaml_camilla(export, target=target),
    )

    update_analysis_status("Analysis complete ✔", 100, running=False)
    log.info(f"Analysis complete → {session_dir}")

    return export


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session")
    ap.add_argument("--speaker")
    ap.add_argument("--ppo", type=int, default=48)
    args = ap.parse_args()

    analyse(Path(args.session), ppo=args.ppo, speaker_key=args.speaker)


if __name__ == "__main__":
    main()
