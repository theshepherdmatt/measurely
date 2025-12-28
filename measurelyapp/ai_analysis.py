#!/usr/bin/env python3

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from openai import OpenAI


def load_meta_for_analysis(analysis_path: Path):
    meta = analysis_path.parent / "meta.json"
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text())
    except Exception:
        return {}


# -------------------------------------------------
# PATHS
# -------------------------------------------------
BASE_DIR = Path("/home/matt/measurely")
MEASUREMENTS_DIR = BASE_DIR / "measurements"
LATEST_DIR = MEASUREMENTS_DIR / "latest"

MEASUREMENTS_DIR.mkdir(parents=True, exist_ok=True)
LATEST_DIR.mkdir(parents=True, exist_ok=True)

ANALYSIS_AI_FILE = LATEST_DIR / "analysis_ai.json"
ROOM_FILE = BASE_DIR / "room.json"
SPEAKERS_FILE = BASE_DIR / "speakers" / "speakers.json"

AI_OVERALL_FILE = LATEST_DIR / "ai.json"
AI_COMPARE_FILE = LATEST_DIR / "ai_compare.json"

# -------------------------------------------------
# ENV + OPENAI
# -------------------------------------------------
load_dotenv(BASE_DIR / ".env")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

MODEL = "gpt-4o-mini"
TEMPERATURE = 0.3

client = OpenAI(api_key=OPENAI_API_KEY)

# -------------------------------------------------
# LOAD REQUIRED FILES
# -------------------------------------------------
for p in (ANALYSIS_AI_FILE, ROOM_FILE, SPEAKERS_FILE):
    if not p.exists():
        raise FileNotFoundError(f"Missing required file: {p}")

analysis_data = json.loads(ANALYSIS_AI_FILE.read_text())
room_data = json.loads(ROOM_FILE.read_text())
speakers_db = json.loads(SPEAKERS_FILE.read_text())

# -------------------------------------------------
# SPEAKER CONTEXT
# -------------------------------------------------
speaker_key = room_data.get("speaker_key")
speaker = speakers_db.get(speaker_key, {}) if speaker_key else {}

friendly_name = speaker.get("friendly_name") or "your speakers"
brand = speaker.get("brand", "")

if speaker_key and brand.lower() not in ("generic", ""):
    system_stroke = f"You’ve got a cracking set of {friendly_name} there — nothing wrong with the kit at all."
else:
    system_stroke = "There’s nothing here that points to a problem with the speakers themselves."

# -------------------------------------------------
# OVERALL SUMMARY
# -------------------------------------------------
overall_prompt = f"""
You are writing a short listening summary for a hi-fi system based on acoustic measurement data.

CONTEXT
- Speaker model: {friendly_name}
- The summary may be regenerated multiple times as the system or room changes

LISTENING DATA
{json.dumps(analysis_data, indent=2)}

ROOM CONTEXT
{json.dumps(room_data, indent=2)}

OPENING GUIDANCE
- Begin with a single observational sentence describing how the system is currently presenting
- Reference the speakers naturally, without praise or fixed phrasing
- Do not reuse phrasing from previous summaries
- The opening should change if the measurements change

CONTENT RULES
- One paragraph only
- No numbers
- No frequencies
- Do NOT mention bass, treble, midrange, highs, or lows
- Do NOT mention treatments or furnishings
- Do NOT explain causes or speculate why something sounds the way it does
- Describe how it sounds, not why

RECOMMENDATION RULE
- Include exactly one suggestion
- The suggestion must relate only to speaker placement or positioning
- Phrase it as a subtle optimisation, not a correction

STYLE
- Neutral, confident, technically literate
- Written for an informed audiophile
- Observational, not promotional
""".strip()

overall_response = client.chat.completions.create(
    model=MODEL,
    temperature=TEMPERATURE,
    messages=[
        {
            "role": "system",
            "content": "You are an experienced hi-fi listener writing concise, measurement-informed summaries."
        },
        {
            "role": "user",
            "content": overall_prompt
        },
    ],
)

overall_summary = overall_response.choices[0].message.content.strip()

AI_OVERALL_FILE.write_text(json.dumps({
    "model": MODEL,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "summary": overall_summary
}, indent=2))

print("\n--- OVERALL SUMMARY ---\n")
print(overall_summary)


# -------------------------------------------------
# SWEEP COMPARISON (REAL SESSIONS + NOTES)
# -------------------------------------------------
sweep_files = sorted(
    MEASUREMENTS_DIR.glob("Sweep*/analysis.json"),
    key=lambda p: p.stat().st_mtime,
    reverse=True
)

if len(sweep_files) >= 2:
    latest_analysis = json.loads(sweep_files[0].read_text())
    previous_analysis = json.loads(sweep_files[1].read_text())

    latest_meta = load_meta_for_analysis(sweep_files[0])
    previous_meta = load_meta_for_analysis(sweep_files[1])

    latest = {
        "analysis": latest_analysis,
        "user_notes": latest_meta.get("notes") or "No user notes recorded for this sweep."
    }

    previous = {
        "analysis": previous_analysis,
        "user_notes": previous_meta.get("notes") or "No user notes recorded for this sweep."
    }

    compare_prompt = f"""
DEBUG — USER NOTES
LATEST: {latest["user_notes"]}
PREVIOUS: {previous["user_notes"]}

You are comparing two listening measurements taken in the same room.

LATEST SWEEP (MEASUREMENT + USER NOTES)
{json.dumps(latest, indent=2)}

PREVIOUS SWEEP (MEASUREMENT + USER NOTES)
{json.dumps(previous, indent=2)}

STRICT RULES:
- Begin with "Compared to the previous sweep," unless no meaningful change is detected, in which case state that explicitly.
- Do not use numbers.
- Do not mention frequencies.
- Do NOT mention bass, treble, midrange, highs, or lows.
- Describe only audible differences between the two sweeps, not overall sound quality.
- Use listening language such as focus, clarity, control, openness, weight, coherence, image stability.
- Keep it to 2–4 sentences maximum.
- Do not explain causes or speculate why changes occurred.
- If the sweeps are effectively the same, say so plainly.
- You may reference system or room changes mentioned in user notes, but only if they align with the measured result.
- Use audiophile language, but keep it plain, technical, and observational.
- Avoid hype, praise, or marketing-style wording.

""".strip()

    compare_response = client.chat.completions.create(
        model=MODEL,
        temperature=TEMPERATURE,
        messages=[
            {"role": "system", "content": "You are an experienced acoustic measurement engineer writing for an informed audiophile."},
            {"role": "user", "content": compare_prompt},
        ],
    )

    compare_summary = compare_response.choices[0].message.content.strip()

    AI_COMPARE_FILE.write_text(json.dumps({
        "model": MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": compare_summary
    }, indent=2))

    print("\n--- SWEEP COMPARISON ---\n")
    print(compare_summary)

print(f"\nSaved overall summary to {AI_OVERALL_FILE}")
