# utils/regenerate_report_curve.py
# Generates report_curve.json from analysis.json (NO raw sweep required)

import json
import numpy as np
from pathlib import Path

MAX_F_REPORT = 18_000

def smooth_curve(y, window=9):
    if window < 3:
        return y
    pad = window // 2
    ypad = np.pad(y, (pad, pad), mode="edge")
    return np.convolve(ypad, np.ones(window) / window, mode="valid")

def regenerate(session_dir: Path):
    analysis = session_dir / "analysis.json"
    out = session_dir / "report_curve.json"

    if not analysis.exists():
        raise FileNotFoundError("analysis.json missing")

    data = json.loads(analysis.read_text())

    # support both keys
    freq = np.asarray(data.get("freq") or data.get("freq_hz"))
    mag  = np.asarray(data.get("mag")  or data.get("mag_db"))

    if freq.size == 0 or mag.size == 0:
        raise RuntimeError("No freq/mag data")

    mask = freq <= MAX_F_REPORT
    freq = freq[mask]
    mag  = smooth_curve(mag[mask])

    out.write_text(json.dumps({
        "freqs": freq.tolist(),
        "mag": mag.tolist()
    }, indent=2))

if __name__ == "__main__":
    import sys
    regenerate(Path(sys.argv[1]))
