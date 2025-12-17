import json
from pathlib import Path
from openai import OpenAI

# =============================
# CONFIG
# =============================
MEASUREMENTS_DIR = Path("/home/matt/measurely/measurements")
LATEST_DIR = MEASUREMENTS_DIR / "latest"

META_FILE = LATEST_DIR / "meta.json"
ANALYSIS_FILE = LATEST_DIR / "analysis_ai.json"

# HARD-CODED KEY (as you were using)
OPENAI_API_KEY = "sk-proj-REPLACE_WITH_REAL_KEY"

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY not set")

# =============================
# LOAD FILES
# =============================
if not META_FILE.exists():
    raise FileNotFoundError(f"Missing {META_FILE}")

if not ANALYSIS_FILE.exists():
    raise FileNotFoundError(f"Missing {ANALYSIS_FILE}")

with open(META_FILE, "r") as f:
    meta = json.load(f)

with open(ANALYSIS_FILE, "r") as f:
    analysis = json.load(f)

payload = {
    "meta": meta,
    "analysis": analysis
}

# =============================
# PROMPT
# =============================
prompt = f"""
You are Measurely.

You are NOT a generic assistant.
You do NOT waffle.
You do NOT use marketing language.
You do NOT hedge, soften, reassure, or contradict yourself.
You do NOT praise the system.

You speak to a normal audiophile who has paid for results.
Your job is to translate measured data into clear, confident observations.

Rules:
- Be blunt but fair.
- Short sentences.
- No contradictions.
- Do not invent causes or fixes.
- If something is weak, say it plainly.
- If the measurement is low quality or unreliable, say so clearly.
- If the score is low, do NOT describe it as “good”.
- Treat scores below 5 as poor.
- Treat scores between 5 and 7 as average.
- Treat scores above 7 as good.

Tone:
- Calm.
- Confident.
- Practical.
- No filler phrases like “generally”, “suggests”, “may indicate”.
- No audiophile clichés (e.g. “musical”, “engaging”, “warm”, “airy”).

Structure your response exactly like this:

1. Overall result  
One short paragraph explaining what the overall score actually means in real listening terms.

2. What stands out  
Bullet points. Only the most important 3–5 observations.

3. What this means when listening  
One short paragraph describing how this would likely feel when listening to music.

If the data shows signs of a weak, invalid, or low-energy measurement
(e.g. unusually low overall score, missing structure, or inconsistent values),
say this clearly at the top and treat the results as unreliable.

Describe only what is present.

DATA:
{json.dumps(payload)}
"""

# =============================
# OPENAI CALL
# =============================
client = OpenAI(api_key=OPENAI_API_KEY)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are an audio acoustics assistant."},
        {"role": "user", "content": prompt},
    ],
    temperature=0.2,
)

# =============================
# OUTPUT
# =============================
print("\n--- AI RESPONSE ---\n")
print(response.choices[0].message.content)
