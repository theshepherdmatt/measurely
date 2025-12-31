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

ROOM_CHARACTER_FILE = LATEST_DIR / "room_character.json"

# -------------------------------------------------
# ENV + OPENAI
# -------------------------------------------------
load_dotenv(BASE_DIR / ".env")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

MODEL = "gpt-4o-mini"
TEMPERATURE = 0.5

client = OpenAI(api_key=OPENAI_API_KEY)

previous_summary = ""
if AI_OVERALL_FILE.exists():
    try:
        previous_summary = json.loads(AI_OVERALL_FILE.read_text()).get("summary", "")
    except Exception:
        pass

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
# SPEAKER CONTEXT (REQUIRED)
# -------------------------------------------------
speaker_key = room_data.get("speaker_key")
speaker = speakers_db.get(speaker_key, {}) if speaker_key else {}

friendly_name = speaker.get("friendly_name") or "your speakers"

# -------------------------------------------------
# OVERALL SUMMARY
# -------------------------------------------------
overall_prompt = f"""
You are a knowledgeable, friendly mate who has been round listening to this system.
You like what you hear and you respect the effort that’s gone into it.
You are talking directly to the owner, not writing a review or a report.
You are approving but understated, like someone who doesn’t gush.
You speak plainly, as if stating obvious things rather than reflecting on them.
You are comfortable saying that nothing needs changing right now.

LISTENING CONTEXT
- You have already been listening for a while
- The music is enjoyable
- Nothing you hear is a let-down or disappointment

SYSTEM CONTEXT
- Speaker model: {friendly_name}
- This summary may be regenerated as the system or room changes

LISTENING DATA
{json.dumps(analysis_data, indent=2)}

ROOM CONTEXT
{json.dumps(room_data, indent=2)}

RULES
- Write exactly TWO sentences
- No numbers
- No frequencies
- Do not mention bass, treble, midrange, highs, or lows
- Do not mention treatments or furnishings
- Do not explain causes or speculate
- Describe how it sounds, not why
- If there is a clear and worthwhile nudge, include at most one gentle experiment related to speaker positioning
- If nothing stands out, say so plainly and do not suggest a change
- Do not begin with phrases like "Today’s listening", "This session", or "Overall"
- Do not use the words experience, enjoyable, satisfying, enhance, or further
- Use plain, everyday language; avoid atmospheric or immersive descriptions


ANTI-REVIEW RULE
- Do not write like a product review, magazine article, or formal listening test

NOVELTY RULE
- The opening sentence must clearly relate to this specific listening session
- It must not be reusable unchanged on another day

- Avoid emotional or celebratory adjectives such as delightful, beautiful, inviting, rich, enjoyable


PREVIOUS SUMMARY (DO NOT REUSE PHRASING)
{previous_summary}
""".strip()

overall_response = client.chat.completions.create(
    model=MODEL,
    temperature=TEMPERATURE,
    messages=[
        {
            "role": "system",
            "content": (
                "You are a relaxed, experienced hi-fi listener chatting to the system’s owner "
                "after spending time listening. You are positive by default and never sound critical."
            )
        },
        {
            "role": "user",
            "content": overall_prompt
        },
    ],
)

overall_summary = overall_response.choices[0].message.content.strip()

# -------------------------------------------------
# TONE GUARD (ANTI-GUSH FILTER)
# -------------------------------------------------
BANNED_PHRASES = [
    "lose track of time",
    "fills the room",
    "smooth quality",
    "flowing",
    "beautiful",
    "delightful",
    "inviting",
    "rich",
    "immersive",
    "enhance the",
    "experience"

    # NEW: polite audiophile filler
    "nice openness",
    "details come through",
    "easy to appreciate",
    "blends together",
    "the music",
    "sound coming from"

]

def contains_banned_language(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in BANNED_PHRASES)


if contains_banned_language(overall_summary):
    # Retry once, slightly colder
    retry_response = client.chat.completions.create(
        model=MODEL,
        temperature=0.3,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a plain-speaking, understated hi-fi listener. "
                    "You avoid flowery or atmospheric language."
                )
            },
            {
                "role": "user",
                "content": overall_prompt
            },
        ],
    )
    overall_summary = retry_response.choices[0].message.content.strip()


AI_OVERALL_FILE.write_text(json.dumps({
    "model": MODEL,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "summary": overall_summary
}, indent=2))

print("\n--- OVERALL SUMMARY ---\n")
print(overall_summary)

# -------------------------------------------------
# ROOM CHARACTER (DEEP DIVE)
# -------------------------------------------------

# STEP 1 — INTERNAL ROOM PERSONALITY (ANALYSIS ONLY)

room_personality_prompt = f"""
You are an experienced acoustic consultant analysing a real listening room.
You are speaking to another professional, not the client.

TASK
- Identify the dominant audible character of the room.
- Explain WHY it sounds that way using the measurement data.
- Be confident, factual, and calm.
- This is analysis, not a recommendation.

YOU MAY:
- Use numbers
- Reference timings, geometry, ratios, scores
- Explain cause-and-effect
- Make qualitative judgements

DO NOT:
- Suggest fixes
- Write diplomatically
- Use marketing language

DATA
Measurements:
{json.dumps(analysis_data, indent=2)}

Room:
{json.dumps(room_data, indent=2)}

OUTPUT
Write structured prose, not bullets.
"""

room_personality_response = client.chat.completions.create(
    model=MODEL,
    temperature=0.3,
    messages=[
        {
            "role": "system",
            "content": (
                "You are a senior acoustic consultant analysing a listening room "
                "for another professional."
            )
        },
        {
            "role": "user",
            "content": room_personality_prompt
        },
    ],
)

room_personality_text = room_personality_response.choices[0].message.content.strip()

analysis_for_room_report = {}

for k, v in analysis_data.items():
    if any(x in k.lower() for x in [
        "band",
        "bass",
        "mid",
        "treble",
        "balance"
    ]):
        continue
    analysis_for_room_report[k] = v


room_report_prompt = f"""
You are writing a factual listening-room behaviour report for an informed,
non-academic reader.

CORE PRINCIPLE (NON-NEGOTIABLE)

This report does not evaluate the room.
It does not judge quality, suitability, or performance.
It does not imply improvement, deficiency, or optimisation.

It states observable behaviour only.

This is what the room does.
These are the trade-offs.
Period.

GOAL

Explain clearly and confidently why the room behaves the way it does,
using the measurement data as evidence.

STYLE

- Declarative
- Calm
- Authoritative
- Plain English
- No hedging
- No persuasion
- No review language

YOU SHOULD

- Use numbers where they are meaningful
- Reference timings, levels, ratios, and scores
- Explicitly link measurements to audible behaviour
- Name bass, midrange, treble, and air where relevant
- Refer to physical features (e.g. hard floors, wall proximity)
  only when directly supported by the data

YOU MUST NOT

- Evaluate (good / bad / ideal / adequate / functional)
- Compare to external standards (e.g. “critical listening”)
- Suggest fixes, treatments, or changes
- Apologise, soften, or qualify conclusions
- Write like a magazine review or buying guide

ABSOLUTE LANGUAGE BAN

Do NOT use words or phrases such as:
good, bad, better, worse, ideal, adequate, functional,
lacking, weak, recessed, prominent, refinement,
critical listening, improvement, upgrade.

CRITICAL INTERPRETATION RULES

Band level metrics are RELATIVE ENERGY INDICATORS.
They are NOT psychoacoustic loudness measures.

- band_levels_db differences of a few dB are normal
- Such differences do NOT imply tonal deficiency
- Do NOT infer thinness, hollowness, or lack of bass from band deltas alone

Bass behaviour MUST be described as:
- present
- supported
- shaped by room interaction

Unless ALL of the following are true:
- balance score is severely skewed
- room gain is absent or negative
- modal support is poor or chaotic

Do NOT describe bass as weak, thin, hollow, recessed, or lacking depth.

REFLECTION INTERPRETATION RULES

- Early reflections affect image focus and spatial precision
- They do NOT imply tonal muddiness by default
- Moderate reflection scores indicate liveliness, not degradation

Use language such as:
- softened image edges
- reduced image anchoring
- broader spatial presentation
- blurred spatial definition

Do NOT use “clarity” to describe timing or reflection effects.

SUPPORTING DATA (REFERENCE ONLY)

Measurements:
{json.dumps(analysis_for_room_report, indent=2)}

Room:
{json.dumps(room_data, indent=2)}

Speaker Profile:
{json.dumps(speaker, indent=2)}

STRUCTURE (FOLLOW EXACTLY)

1. One short paragraph describing the room’s overall sound behaviour
2. A section titled “Why it sounds this way” linking key data to behaviour
3. A short concluding paragraph summarising observable strengths and trade-offs

FINAL CHECK BEFORE RESPONDING

If any sentence sounds like judgement, advice, or comparison,
rewrite it as a neutral statement of behaviour.
"""


room_report_response = client.chat.completions.create(
    model=MODEL,
    temperature=0.3,
    messages=[
        {
            "role": "system",
            "content": (
                "You are an experienced acoustic consultant explaining findings clearly "
                "to a technically curious listener."
            )
        },
        {
            "role": "user",
            "content": room_report_prompt
        },
    ],
)

room_report_text = room_report_response.choices[0].message.content.strip()


(LATEST_DIR / "room_report.json").write_text(
    json.dumps({
        "model": MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "report": room_report_text
    }, indent=2)
)

print("\n--- ROOM REPORT ---\n")
print(room_report_text)



# STEP 3 — CLIENT ROOM SUMMARY (ONE PARAGRAPH)

client_summary_prompt = f"""
You are explaining the room to a client in one paragraph.

INPUT:
{room_report_text}

RULES
- One paragraph
- No numbers
- No causes
- No fixes
- No judgement
- No audiophile clichés

GOAL
Explain how the room sounds, not why.
"""

client_summary_response = client.chat.completions.create(
    model=MODEL,
    temperature=0.3,
    messages=[
        {
            "role": "system",
            "content": (
                "You are a calm, confident professional explaining room character "
                "to a client in plain language."
            )
        },
        {
            "role": "user",
            "content": client_summary_prompt
        },
    ],
)

client_room_summary = client_summary_response.choices[0].message.content.strip()

print("\n--- CLIENT ROOM SUMMARY ---\n")
print(client_room_summary)

(LATEST_DIR / "room_client_summary.json").write_text(
    json.dumps({
        "model": MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": client_room_summary
    }, indent=2)
)

# -------------------------------------------------
# SWEEP COMPARISON (REAL SESSIONS + NOTES)
# -------------------------------------------------
sweep_files = sorted(
    MEASUREMENTS_DIR.glob("Sweep*/analysis.json"),
    key=lambda p: p.stat().st_mtime,
    reverse=True
)

if len(sweep_files) >= 2:
    AI_COMPARE_FILE = sweep_files[0].parent / "ai_compare.json"
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

LATEST SWEEP
{json.dumps(latest, indent=2)}

PREVIOUS SWEEP
{json.dumps(previous, indent=2)}

STRICT RULES
- Write exactly ONE sentence
- If no meaningful change is detected, state that explicitly
- No numbers
- No frequencies
- Do not mention bass, treble, midrange, highs, or lows
- Describe only changes in focus, coherence, control, or image stability.
- Do not explain causes
- Do not speculate
- Do not mention equipment or room changes
""".strip()

    compare_response = client.chat.completions.create(
        model=MODEL,
        temperature=TEMPERATURE,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a calm, precise acoustic measurement engineer writing for an informed audiophile."
                )
            },
            {
                "role": "user",
                "content": compare_prompt
            },
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
