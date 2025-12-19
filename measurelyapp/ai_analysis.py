import json
import os
from pathlib import Path
from datetime import datetime
from openai import OpenAI

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path.home() / "measurely" / ".env")


# -------------------------------------------------
# NORMALISE AI-FACING DATA (HIDE TECHNICAL LABELS)
# -------------------------------------------------
def normalise_for_ai(data: dict) -> dict:
    clean = dict(data)

    # --- Rename score concepts to human terms ---
    scores = clean.get("scores", {})
    clean["scores"] = {
        "weight": scores.get("bandwidth"),
        "evenness": scores.get("balance"),
        "control": scores.get("peaks_dips"),
        "flow": scores.get("smoothness"),
        "focus": scores.get("reflections"),
        "confidence": scores.get("signal_integrity"),
        "overall": scores.get("overall"),
    }

    # --- Strip technical room internals ---
    room = clean.get("room_context", {})
    clean["room_context"] = {
        "speaker_distance": room.get("sbir", {}).get("distance_m"),
        "triangle_quality": room.get("triangle", {}).get("penalty"),
        "room_feel": (
            "tight" if room.get("room_factor", 1.0) > 1.0
            else "forgiving" if room.get("room_factor", 1.0) < 0.95
            else "neutral"
        ),
    }

    return clean

# -------------------------------------------------
# CONFIG
# -------------------------------------------------
OPENAI_API_KEY = os.environ.get("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")

BASE_DIR = Path("/home/matt/measurely")

MEASUREMENTS_DIR = BASE_DIR / "measurements"
LATEST_DIR = MEASUREMENTS_DIR / "latest"

ANALYSIS_AI_FILE = LATEST_DIR / "analysis_ai.json"
ROOM_FILE = BASE_DIR / "room.json"
SPEAKERS_FILE = BASE_DIR / "speakers" / "speakers.json"

AI_OUTPUT_FILE = LATEST_DIR / "ai.json"

MODEL = "gpt-4o-mini"
TEMPERATURE = 0.3

# -------------------------------------------------
# LOAD INPUT DATA
# -------------------------------------------------
for path in (ANALYSIS_AI_FILE, ROOM_FILE, SPEAKERS_FILE):
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")

with ANALYSIS_AI_FILE.open("r") as f:
    analysis_ai_data = normalise_for_ai(json.load(f))

with ROOM_FILE.open("r") as f:
    room_data = json.load(f)

with SPEAKERS_FILE.open("r") as f:
    speakers_db = json.load(f)

print(f"Using AI analysis: {ANALYSIS_AI_FILE.name}")
print(f"Using room data: {ROOM_FILE.name}")

# -------------------------------------------------
# RESOLVE SPEAKER & FRIENDLY NAME
# -------------------------------------------------
speaker_key = room_data.get("speaker_key")
speaker = speakers_db.get(speaker_key, {}) if speaker_key else {}

friendly_name = speaker.get("friendly_name") or "your speakers"
brand = speaker.get("brand", "")
notes = speaker.get("notes", [])[:2]

# Decide how confident we are about praising the speakers
is_known_speaker = bool(speaker.get("friendly_name")) and brand.lower() not in ("generic", "")
is_generic_speaker = brand.lower() == "generic" or not speaker_key

# -------------------------------------------------
# BUILD SYSTEM STROKE (PRE-WRITTEN)
# -------------------------------------------------
if not speaker_key:
    system_stroke = (
        "Nothing here points to a problem with the speakers themselves."
    )
elif is_generic_speaker:
    system_stroke = (
        "This is a perfectly sensible setup, and there’s nothing obviously wrong with the speakers themselves."
    )
else:
    system_stroke = (
        f"You’ve got a cracking set of {friendly_name} there — nothing wrong with the kit at all."
    )

# -------------------------------------------------
# OPTIONAL SPEAKER CONTEXT (NON-FLOWERY)
# -------------------------------------------------
speaker_text = f"""
SYSTEM / SPEAKER CONTEXT

Speaker type: {friendly_name}
Known traits:
- {notes[0] if notes else ""}
- {notes[1] if len(notes) > 1 else ""}
""".strip()


# -------------------------------------------------
# BUILD PROMPT
# -------------------------------------------------
prompt = f"""
You are writing a short listening summary for a hi-fi room measurement.

START WITH THIS SENTENCE:
"{system_stroke}"

{speaker_text}

--------------------------------------------------
MEASURED ACOUSTIC ANALYSIS
This describes what it sounds like in this room.
--------------------------------------------------
{json.dumps(analysis_ai_data, indent=2)}

--------------------------------------------------
ROOM SETUP & PHYSICAL CONTEXT
This describes the room size, layout, surfaces, and speaker placement.
--------------------------------------------------
{json.dumps(room_data, indent=2)}

--------------------------------------------------

Write ONE short paragraph (4–6 sentences) that will appear in an
"Overall Score" card.

Tone and voice:
- Write like a knowledgeable mate down the pub
- Relaxed, confident, straight-talking
- Short sentences
- Friendly and encouraging
- No sales talk, no therapy language, no technical fluff
- It’s OK to sound opinionated

Use this structure:
1) System stroke (already provided)
2) What it sounds like right now
3) What’s holding it back, described only by how it sounds, not why
4) One thing I’d fix first

Rules:
- Do not mention numbers or measurements
- Do not mention frequencies or milliseconds
- Do not suggest buying new equipment
- Plain English only
- No hedging or qualifiers
- Use room context only to guide judgement, not explanation
- Do NOT explain why something sounds the way it does
- Never mention the room directly; describe its effect instead


Room options are authoritative:
- If opt_area_rug is true, do NOT recommend adding a rug
- If opt_curtains is true, do NOT recommend adding curtains
- If opt_sofa is true, do NOT recommend adding a sofa
- If opt_barewalls is true, assume bare wall reflections are present

Only recommend ONE improvement that is NOT already present.
If the obvious improvements are already present, recommend refining placement instead.

Do NOT use:
- "the listener"
- "probably"
- "likely"
- "may"
- "could"
- "overall enjoyment"
- "sound environment"
- "wall treatments"
- "acoustic panels"
- vague positives like "better overall"

Always describe a specific audible change
(e.g. tighter bass, clearer vocals, better focus).

This should feel supportive, specific, and human.
""".strip()

# -------------------------------------------------
# REQUEST AI SUMMARY
# -------------------------------------------------
client = OpenAI(api_key=OPENAI_API_KEY)

response = client.chat.completions.create(
    model=MODEL,
    temperature=TEMPERATURE,
    messages=[
        {"role": "system", "content": "You are an audio acoustics assistant."},
        {"role": "user", "content": prompt},
    ],
)

summary_text = response.choices[0].message.content.strip()

# -------------------------------------------------
# SAVE AI OUTPUT
# -------------------------------------------------
ai_payload = {
    "model": MODEL,
    "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    "summary": summary_text,
}

with AI_OUTPUT_FILE.open("w") as f:
    json.dump(ai_payload, f, indent=2)

# -------------------------------------------------
# CONSOLE OUTPUT
# -------------------------------------------------
print("\n--- AI SUMMARY ---\n")
print(summary_text)
print(f"\nSaved to {AI_OUTPUT_FILE}")
