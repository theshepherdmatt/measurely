#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Dave text engine - selects messages and fills placeholders.
"""

import json
from pathlib import Path

PHRASE_FILE = Path(__file__).parent / "phrases" / "dave_phrases.json"
_bank = json.loads(PHRASE_FILE.read_text())

# Map score keys → JSON keys
ACTION_KEYS = {
    "peaks_dips": "peaks_dips_solutions",
    "reflections": "reflections_solutions",
    "bandwidth": "bandwidth_solutions",
    "balance": "balance_solutions",
    "smoothness": "smoothness_solutions",
    "reverb": "reverb_solutions",
}

def _fill(text: str, scores: dict, room: dict | None = None) -> str:
    """Replace placeholders like {{overall_score}} from scores + room data."""
    if not text:
        return text

    # Extract available info
    overall = scores.get("overall", "--")
    rm = room or {}
    mapping = {
        "overall_score": overall,
        "room_width": rm.get("width_m", "--"),
        "room_length": rm.get("length_m", "--"),
        "room_height": rm.get("height_m", "--"),
        "spk_distance": rm.get("listener_front_m", "--"),
        "listener_distance": rm.get("listener_front_m", "--"),
        "toe_in": rm.get("toe_in_deg", "--"),
        "speaker_friendly_name": rm.get("speaker_friendly_name", "your speakers"),
    }

    # Apply replacements
    for k, v in mapping.items():
        text = text.replace(f"{{{{{k}}}}}", str(v))

    return text


def pick_overall(overall_score: float) -> str:
    for rule in _bank.get("overall", []):
        if rule["min"] <= overall_score < rule["max"]:
            return rule["text"]
    return "Good progress — your score is {{overall_score}}."


def pick_actions(scores: dict) -> list:
    """Pick up to 3 solutions by category score severity."""
    results = []
    for key, val in scores.items():
        if key == "overall":
            continue
        if val < 7:
            bucket_key = ACTION_KEYS.get(key)
            if not bucket_key:
                continue
            bucket = _bank.get(bucket_key, {})
            # Pick based on severity bucket
            severity = (
                "excellent" if val >= 8 else
                "good" if val >= 6 else
                "okay" if val >= 4 else
                "needs_work"
            )
            items = bucket.get(severity, [])
            results.extend(items[:1])  # 1 per category to avoid overload

    return results[:3]


def dave_summary(scores: dict, room: dict | None = None):
    """Return headline string + list of actionable tips."""
    overall = scores.get("overall", 5.0)

    headline = pick_overall(overall)
    headline = _fill(headline, scores, room)

    actions = pick_actions(scores)
    actions = [_fill(a, scores, room) for a in actions]

    return headline, actions
