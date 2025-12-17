import json
import os
from pathlib import Path
from openai import OpenAI

# -----------------------------
# CONFIG
# -----------------------------
OPENAI_API_KEY = os.environ.get("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")
MEASUREMENTS_DIR = Path("/home/matt/measurely/measurements")  # adjust if needed
LATEST_DIR = MEASUREMENTS_DIR / "latest"
ANALYSIS_FILE = LATEST_DIR / "meta.json"

# -----------------------------
# LOAD ANALYSIS JSON
# -----------------------------
if not ANALYSIS_FILE.exists():
    raise FileNotFoundError(f"Could not find {ANALYSIS_FILE}")

with open(ANALYSIS_FILE, "r") as f:
    analysis_data = json.load(f)

# -----------------------------
# BUILD PROMPT
# -----------------------------
prompt = f"""
You are analysing a hi-fi room measurement.

Here is the structured analysis data from a room sweep.
Summarise what matters to a normal listener in plain English.
Be concise. No fluff.

JSON:
{json.dumps(analysis_data, indent=2)}
"""

# -----------------------------
# SEND TO OPENAI
# -----------------------------
client = OpenAI(api_key=OPENAI_API_KEY)

response = client.chat.completions.create(
    model="gpt-4o-mini",  # cheap + fast for testing
    messages=[
        {"role": "system", "content": "You are an audio acoustics assistant."},
        {"role": "user", "content": prompt},
    ],
    temperature=0.3,
)

# -----------------------------
# OUTPUT
# -----------------------------
print("\n--- AI RESPONSE ---\n")
print(response.choices[0].message.content)
