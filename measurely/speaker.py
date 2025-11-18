"""Target-curve loader."""
import json, csv
from pathlib import Path
from scipy.interpolate import interp1d

__all__ = ["load_target_curve"]

SPEAKER_DIR = Path.home() / "measurely" / "speakers"

def load_target_curve(speaker_key: str | None):
    if not speaker_key:
        return None
    master = SPEAKER_DIR / "speakers.json"
    if not master.exists():
        return None
    catalogue = json.loads(master.read_text())
    if speaker_key not in catalogue:
        return None
    folder = catalogue[speaker_key]["folder"]
    fname  = catalogue[speaker_key]["target_curve"]
    path   = SPEAKER_DIR / folder / fname
    if not path.exists():
        return None

    freq, targ = [], []
    if path.suffix == ".csv":
        for row in csv.reader(path.read_text().splitlines()):
            if len(row) >= 2:
                freq.append(float(row[0]))
                targ.append(float(row[1]))
    elif path.suffix == ".json":
        data = json.loads(path.read_text())
        for pt in data.get("points", data):
            f = pt.get("frequency_hz") or pt.get("f")
            t = pt.get("target_rel_db") or pt.get("mag")
            if f is not None and t is not None:
                freq.append(float(f))
                targ.append(float(t))
    if len(freq) < 3:
        return None
    return interp1d(freq, targ, bounds_error=False, fill_value=(targ[0], targ[-1]))
