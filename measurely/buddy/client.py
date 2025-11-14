import json, random, os
from pathlib import Path

_PHRASE_FILE = Path(__file__).resolve().parent.parent / "phrases" / "buddy_phrases.json"
_bank = json.load(open(_PHRASE_FILE))

def _pick(tag):          # fallback if bank grows
    return random.choice(_bank.get(tag, [f"Check {tag}"]))

def _warm_phrase(score: float) -> str:
    bucket = "cold" if score < 5 else "cool" if score < 7 else "warm" if score < 9 else "hot"
    return random.choice(_bank[bucket])

def ask_buddy(notes, scores) -> tuple[str, list[str]]:
    tips = []
    if any("Boom ~100 Hz" in n for n in notes):
        tips.append(_pick("boom"))
    if any("Mid forward vs bass" in n for n in notes):
        tips.append(_pick("mid"))
    if any("Top roll-off" in n for n in notes):
        tips.append(_pick("top"))
    if any("RT60" in n for n in notes) and scores.get("reverb", 10) < 8:
        tips.append(_pick("echo"))
    if tips:
        tips.append(_pick("fix"))
    headline = " ".join(tips[:3]) or "All good — nothing scary showed up."
    headline = " ".join(tips[:2]) + " " + _warm_phrase(scores.get("overall", 5))
    return headline, tips

def ask_buddy_full(ana: dict) -> dict[str, str]:
    headline, _ = ask_buddy(ana.get("notes", []), ana.get("scores", {}))
    return {"freq": headline, "treat": "", "action": ""}