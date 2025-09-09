from pathlib import Path
from datetime import datetime
import json
import re

SERVICE_ROOT = Path(__file__).resolve().parents[1]
MEASUREMENTS_DIR = SERVICE_ROOT / "measurements"


def extract_num(sweep_id):
    m = re.search(r"(\d+)$", sweep_id)
    return int(m.group(1)) if m else -1


def load_json(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def build_sweephistory(limit=4):
    sessions = []

    for d in MEASUREMENTS_DIR.iterdir():
        if not d.is_dir():
            continue
        if d.name in ("latest",) or d.name.upper().startswith("DEMO"):
            continue
        if not re.match(r"^(Sweep|uploads)\d+$", d.name):
            continue

        analysis = load_json(d / "analysis.json")
        meta = load_json(d / "meta.json")

        if not analysis:
            analysis = {}

        sessions.append({
            "id": d.name,
            "timestamp": meta.get("timestamp")
                or datetime.fromtimestamp(d.stat().st_mtime).isoformat(),
            "overall_score": analysis.get("scores", {}).get("overall"),
            "metrics": {
                "bandwidth": analysis.get("scores", {}).get("bandwidth"),
                "balance": analysis.get("scores", {}).get("balance"),
                "smoothness": analysis.get("scores", {}).get("smoothness"),
                "peaks_dips": analysis.get("scores", {}).get("peaks_dips"),
                "reflections": analysis.get("scores", {}).get("reflections"),
                "clarity": analysis.get("scores", {}).get("clarity"),
                "signal_integrity": analysis.get("signal_integrity", {}).get("score"),
            },
            "bands_db": analysis.get("band_levels_db", {}),
            "note": meta.get("notes", "")
        })

    # --------------------------------------------------
    # 🔥 CRITICAL FIX: stable, deterministic ordering
    # uploadsN first, then SweepN — each numerically
    # --------------------------------------------------
    def sort_key(s):
        name = s["id"]
        num = extract_num(name)
        if name.startswith("uploads"):
            return (0, num)   # uploads first
        return (1, num)       # sweeps after

    sessions.sort(key=sort_key, reverse=True)

    sweeps = sessions[:limit]

    history = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "sweep_count": len(sweeps),
        "sweeps": sweeps
    }

    out_path = MEASUREMENTS_DIR / "sweephistory.json"
    out_path.write_text(json.dumps(history, indent=2), encoding="utf-8")

    return history
