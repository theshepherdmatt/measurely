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
    """
    Generate ONLY the overall bucket headline for the dashboard’s 3rd card.
    Do NOT mix boom/mid/top/echo/fix here — those are for the 6 small cards.
    """

    # Determine overall bucket from overall score
    overall = scores.get("overall", 5)
    if overall < 5:
        bucket = "overall_poor"
    elif overall < 7:
        bucket = "overall_fair"
    elif overall < 8:
        bucket = "overall_good"
    else:
        bucket = "overall_excellent"

    # Pull phrases from JSON
    phrases = _bank.get(bucket, [])

    # Safety fallback
    if not phrases:
        headline = "Your room has potential — easy wins ahead."
    else:
        headline = random.choice(phrases)

    # We still return actions (empty list for now)
    return headline, []

def ask_buddy_full(ana: dict) -> dict[str, str]:
    headline, _ = ask_buddy(ana.get("notes", []), ana.get("scores", {}))
    return {"freq": headline, "treat": "", "action": ""}
