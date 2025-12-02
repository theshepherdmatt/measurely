import json, random
from pathlib import Path

_PHRASE_FILE = Path(__file__).resolve().parent.parent / "phrases" / "buddy_phrases.json"
_SPEAKER_FILE = Path(__file__).resolve().parent.parent.parent / "speakers" / "speakers.json"

# Load phrase banks
_bank = json.load(open(_PHRASE_FILE))
# Load speaker database
try:
    _speakers = json.load(open(_SPEAKER_FILE))
except:
    _speakers = {}

def _pick(tag):
    return random.choice(_bank.get(tag, [f"Check {tag}"]))

def _score_bucket(score: float) -> str:
    if score < 5: return "needs_work"
    elif score < 7: return "okay"
    elif score < 8.5: return "good"
    else: return "excellent"

def _get_speaker_info(speaker_key: str) -> dict:
    return _speakers.get(speaker_key, {})

def _fill_tags(text: str, scores: dict, room: dict, analysis: dict, speaker_info: dict) -> str:
    modes = analysis.get("modes", []) or []
    worst = max(modes, key=lambda m: abs(m.get("delta_db", 0))) if modes else None

    def safe_fmt(val, fmt="{:g}"):
        try:
            if val is None: return ""
            if isinstance(val, (int, float)): return fmt.format(val)
            return str(val)
        except:
            return str(val)

    mapping = {
        "overall_score": safe_fmt(scores.get("overall"), "{:.1f}"),
        "bandwidth_score": safe_fmt(scores.get("bandwidth"), "{:.1f}"),
        "peaks_dips_score": safe_fmt(scores.get("peaks_dips"), "{:.1f}"),
        "reflections_score": safe_fmt(scores.get("reflections"), "{:.1f}"),
        "reverb_score": safe_fmt(scores.get("reverb"), "{:.1f}"),
        "smoothness_score": safe_fmt(scores.get("smoothness"), "{:.1f}"),

        "room_width": safe_fmt(room.get("width_m")),
        "room_length": safe_fmt(room.get("length_m")),
        "room_height": safe_fmt(room.get("height_m")),
        "spk_distance": safe_fmt(room.get("spk_front_m"), "{:.2f}"),
        "toe_in": safe_fmt(room.get("toe_in_deg"), "{:.0f}"),
        "listener_distance": safe_fmt(room.get("listener_front_m"), "{:.2f}"),

        "speaker_friendly_name": speaker_info.get("friendly_name") or speaker_info.get("name") or "your speakers",
        "speaker_name": speaker_info.get("friendly_name") or speaker_info.get("name") or "your speakers",

        "speaker_brand": speaker_info.get("brand", ""),
        "speaker_key": analysis.get("speaker_profile", ""),

        "worst_mode_freq": safe_fmt(worst["freq_hz"], "{:.0f}") if worst else "",
        "worst_mode_delta": safe_fmt(worst["delta_db"], "{:+.1f}") if worst else "",

        "rt60": safe_fmt(analysis.get("rt60_s"), "{:.2f}"),
        "edt": safe_fmt(analysis.get("edt_s"), "{:.2f}")
    }

    out = text
    for key, val in mapping.items():
        out = out.replace(f"{{{{{key}}}}}", str(val))

    return out


# ============================================================
# SMART SUGGESTIONS
# ============================================================

def _suggest_acoustic_treatment(room, reflections_score, reverb_score):
    suggestions = []

    has_rug = room.get("opt_area_rug", False) or room.get("opt_rug", False)
    has_curtains = room.get("opt_curtains", False)
    has_hard_floor = room.get("floor_material") == "hard" or room.get("opt_hardfloor", False)
    has_bare_walls = room.get("opt_barewalls", False)

    if reflections_score < 7 and has_hard_floor and not has_rug:
        suggestions.append("Hard floors with no rug = reflections. Chuck a rug down between speakers and seat — instant improvement.")

    if reflections_score < 7 and has_bare_walls and not has_curtains:
        suggestions.append("Bare walls bouncing sound everywhere. Curtains or wall art help massively.")

    if reverb_score < 7 and not has_curtains:
        suggestions.append("Room's a bit lively. Curtains (even thin ones) tame high-frequency echo nicely.")

    if reflections_score < 7 and has_rug:
        suggestions.append("You've got a rug down already — try adding something soft on the side walls at the reflection points.")

    return suggestions

def _suggest_positioning(room, scores):
    suggestions = []
    spk_dist = room.get("spk_front_m")
    toe_in = room.get("toe_in_deg")
    listener = room.get("listener_front_m")
    length = room.get("length_m")

    if scores.get("peaks_dips", 10) < 7 and spk_dist and spk_dist < 0.3:
        new_dist = round(spk_dist + 0.15, 2)
        suggestions.append(f"Speakers only {spk_dist}m from wall — bass is bunching up. Try {new_dist}m.")

    if scores.get("reflections", 10) < 7 and toe_in and toe_in > 12:
        suggestions.append(f"Current {toe_in}° toe-in is sending a lot to the walls. Try {toe_in-3}°.")

    if scores.get("peaks_dips", 10) < 6 and listener and length:
        if abs(listener - (length/2)) < 0.15:
            golden = round(length * 0.38, 2)
            suggestions.append(f"You're at {listener}m in a {length}m room — sitting in a bass null. Move to {golden}m.")

    return suggestions


# ============================================================
# MAIN DAVE ENGINE (FIXED)
# ============================================================

def generate_dave_says(scores, room, analysis):
    overall = scores.get("overall", 5)

    if overall < 5: bucket = "overall_poor"
    elif overall < 7: bucket = "overall_fair"
    elif overall < 8.5: bucket = "overall_good"
    else: bucket = "overall_excellent"

    print("[DAVE DEBUG] BUCKET:", bucket)

    phrases = _bank.get(bucket, [])
    if not phrases:
        phrases = ["Room's adding character — let's tidy it up."]

    raw = random.choice(phrases)

    speaker_key = room.get("speaker_key") or analysis.get("speaker_profile")
    speaker_info = _get_speaker_info(speaker_key) if speaker_key else {}

    headline = _fill_tags(raw, scores, room, analysis, speaker_info)

    actions = []
    actions.extend(_suggest_acoustic_treatment(room, scores.get("reflections", 10), scores.get("reverb", 10)))
    actions.extend(_suggest_positioning(room, scores))

    return headline, actions[:3]


# ============================================================
# PUBLIC API
# ============================================================

def ask_buddy(notes, scores, room={}, analysis=None):
    if analysis is None: analysis = {}
    return generate_dave_says(scores, room, analysis)

def ask_buddy_full(ana):
    room = ana.get("room", {})
    scores = ana.get("scores", {})
    headline, acts = ask_buddy([], scores, room, ana)

    return {
        "freq": headline,
        "treat": "",
        "action": "\n".join(acts) if acts else ""
    }
