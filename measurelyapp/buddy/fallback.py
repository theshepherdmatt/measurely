"""Plain-text fallback when LLM is off-line."""

def plain_summary(res: dict) -> tuple[str, list[str]]:
    bands = res.get("band_levels_db", {})
    one, fix = "All good. Nothing scary showed up.", []

    if (bands.get("bass_20_200", 0) - bands.get("mid_200_2k", 0)) > 4:
        one, fix = "Bass strong vs mids", ["Pull speakers 10-20 cm from wall"]

    if res.get("reflections_ms"):
        one, fix = "Early reflections detected", ["Add rug / side-wall panels"]

    if (res.get("rt60_s") or 0) > 0.6:
        one = "Room a bit echoey"

    return one, fix[:3]
