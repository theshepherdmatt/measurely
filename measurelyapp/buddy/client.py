import json, random, os
from pathlib import Path
import math # You need to import math for the calculations

_PHRASE_FILE = Path(__file__).resolve().parent.parent / "phrases" / "buddy_phrases.json"
_bank = json.load(open(_PHRASE_FILE))

def _pick(tag):          # fallback if bank grows
    return random.choice(_bank.get(tag, [f"Check {tag}"]))

def _warm_phrase(score: float) -> str:
    bucket = "cold" if score < 5 else "cool" if score < 7 else "warm" if score < 9 else "hot"
    return random.choice(_bank[bucket])

# Updated signature to accept room_config
def ask_buddy(notes, scores, room_config: dict = {}) -> tuple[str, list[str]]:
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

    # Pull standard phrases from JSON
    phrases = _bank.get(bucket, [])

    # === NEW: Conditional, Specific Phrases based on Setup Data (Dave's Brain) ===
    # Only run this logic if we have the configuration data and the score isn't excellent
    if room_config and bucket != "overall_excellent":
        try:
            length = room_config.get("length_m")
            listener_dist = room_config.get("listener_front_m")

            # 1. Custom alert for sitting in the worst bass-null (half-way point)
            if length and listener_dist and scores.get("peaks_dips", 10) < 6:
                # The primary modal null is at 50% of room length
                half_way_null = length / 2.0
                
                # Check if the listening position is within 10cm (0.10m) of the null
                if abs(listener_dist - half_way_null) < 0.10:
                    # Suggest a move to the 'golden ratio' position (~38% of room length)
                    specific_move = round(length * 0.38, 2)
                    
                    phrases.append(
                        f"⚠️ **Custom Alert:** Your 🔊 listening seat is at **{listener_dist:.2f}m** which is directly in the **dead-zone** of your room's main bass mode (half-way null at {half_way_null:.2f}m). Try moving forward to **{specific_move}m** to restore punch."
                    )
            
            # 2. Acoustic Quick Fix: Hard floor with no rug
            if room_config.get("opt_hardfloor") and not room_config.get("opt_rug") and scores.get("reflections", 10) < 7:
                 phrases.append(
                    f"🧶 **Acoustic Quick Fix:** Dave sees you have a **hard floor** and **no rug**. That's a major cause of mid-high harshness. Getting a rug down is your top priority for cleaner sound."
                 )
                 
            # 3. Extreme liveliness warning for bare rooms
            if room_config.get("echo_pct", 0) > 70 and not room_config.get("opt_curtains"):
                 phrases.append(
                    f"🪟 **Room is Very Live:** Your echo rating is high! If you have bare windows/walls, heavy curtains or a large blanket on the wall behind the speakers will make a huge difference."
                 )

        except Exception as e:
            # Important: Log the error but continue to use standard phrases
            print(f"Buddy custom logic error: {e}")

    # Safety fallback
    if not phrases:
        headline = "Your room has potential — easy wins ahead."
    else:
        headline = random.choice(phrases)

    # We still return actions (empty list for now)
    return headline, []

# Update ask_buddy_full to pass the room config that comes from server.py's load_session_data
def ask_buddy_full(ana: dict) -> dict[str, str]:
    # The full analysis dictionary 'ana' contains the 'room' key from meta.json
    room_config = ana.get("room", {}) 
    headline, _ = ask_buddy(ana.get("notes", []), ana.get("scores", {}), room_config)
    return {"freq": headline, "treat": "", "action": ""}