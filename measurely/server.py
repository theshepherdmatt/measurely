#!/usr/bin/env python3
"""
Real-Data Measurely Flask Server
- uses real analysis.json scores
- NEW:  /api/room/<session_id>  (POST + GET)  – stores user room/speaker data
"""

import os
import sys
import json
import time
import glob
import subprocess
import threading
import csv
import random
import math
import traceback
import numpy as np
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from scipy.ndimage import gaussian_filter1d

# ------------------------------------------------------------------
#  Flask init
# ------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

# ------------------------------------------------------------------
#  config
# ------------------------------------------------------------------
MEAS_ROOT = Path("/home/matt/Measurely/measurements")
SMOOTH_SIGMA = 6          # tune to taste
MAX_PLOT_PTS = 1200       # ≈ one point per pixel on most screens

# ------------------------------------------------------------------
#  global sweep-progress tracker
# ------------------------------------------------------------------
sweep_progress = {
    'running': False,
    'progress': 0,
    'message': '',
    'session_id': None
}

# ------------------------------------------------------------------
#  helpers
# ------------------------------------------------------------------
def write_json_atomic(obj, dest: Path):
    """thread-safe atomic write for meta.json"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, dest)

def _smooth(arr, sigma):
    """light Gaussian 1-D smooth"""
    if len(arr) <= 1 or sigma <= 0:
        return arr
    return gaussian_filter1d(arr, sigma)

def _downsample(x, y, max_pts=MAX_PLOT_PTS):
    """keep max_pts evenly-spaced indices"""
    n = len(x)
    if n <= max_pts:
        return x, y
    idx = np.linspace(0, n-1, max_pts, dtype=int)
    return np.array(x)[idx], np.array(y)[idx]

# ------------------------------------------------------------------
#  original business-logic functions (unchanged)
# ------------------------------------------------------------------
def get_latest_measurement():
    """return most recent session dict or None"""
    try:
        if not MEAS_ROOT.exists():
            print("Measurements directory not found")
            return None
        session_dirs = [d for d in MEAS_ROOT.iterdir() if d.is_dir()]
        if not session_dirs:
            print("No session directories found")
            return None
        latest_session = max(session_dirs, key=lambda d: d.stat().st_mtime)
        print(f"Latest session: {latest_session}")
        return load_session_data(latest_session)
    except Exception as e:
        print(f"Error reading latest measurement: {e}")
        return None

def load_session_data(session_dir):
    """return dict with **both** left & right traces + merged summary"""
    try:
        path = Path(session_dir)
        left_file  = path / "left"  / "response.csv"
        right_file = path / "right" / "response.csv"
        root_file  = path / "response.csv"

        left_data  = convert_csv_to_json(left_file)  if left_file.exists()  else None
        right_data = convert_csv_to_json(right_file) if right_file.exists() else None

        # fall back to mono file
        if not left_data and not right_data and root_file.exists():
            mono = convert_csv_to_json(root_file)
            left_data  = mono
            right_data = {
                "freq_hz":   mono["freq_hz"][:],
                "mag_db":    mono["mag_db"][:],
                "phase_deg": mono["phase_deg"][:]
            }

        lf = _clean(left_data["freq_hz"])
        lm = _clean(left_data["mag_db"])
        rf = _clean(right_data["freq_hz"])
        rm = _clean(right_data["mag_db"])

        # analysis / meta
        ana = path / "analysis.json"
        ana_data = ana.exists() and json.loads(ana.read_text()) or {}
        meta = path / "meta.json"
        meta_data = meta.exists() and json.loads(meta.read_text()) or {}
        room_info = meta_data.get("settings", {}).get("room", {})

        out = {
            "id": path.name,
            "timestamp": meta_data.get("timestamp", datetime.now().isoformat()),
            "room": meta_data.get("room", "Unknown Room"),
            "length": room_info.get("length_m", meta_data.get("length", 4.0)),
            "width":  room_info.get("width_m",  meta_data.get("width",  4.0)),
            "height": room_info.get("height_m", meta_data.get("height", 3.0)),

            # BOTH TRACES
            "left_freq_hz":  lf,
            "left_mag_db":   lm,
            "right_freq_hz": rf,
            "right_mag_db":  rm,

            # merged summary
            "freq_hz":  lf if lf else rf,
            "mag_db":   [(l+r)/2 for l,r in zip(lm, rm)] if (lm and rm) else (lm or rm),

            "overall_score": ana_data.get("scores", {}).get("overall", 5.0),
            "bandwidth":     ana_data.get("scores", {}).get("bandwidth", 3.6),
            "balance":       ana_data.get("scores", {}).get("balance", 1.6),
            "smoothness":    ana_data.get("scores", {}).get("smoothness", 7.3),
            "peaks_dips":    ana_data.get("scores", {}).get("peaks_dips", 3.3),
            "reflections":   ana_data.get("scores", {}).get("reflections", 4.0),
            "reverb":        ana_data.get("scores", {}).get("reverb", 10.0),

            "session_dir": str(path),
            "analysis_notes": ana_data.get("notes", []),
            "simple_summary": ana_data.get("plain_summary", ""),
            "simple_fixes":   ana_data.get("simple_fixes", []),

            "has_analysis": ana.exists(),
            "has_summary":  (path / "summary.txt").exists(),
        }
        print(f"  loaded {path.name}  L:{len(lf)}  R:{len(rf)}  score {out['overall_score']}")
        return out
    except Exception as e:
        print("load_session_data error:", e)
        traceback.print_exc()
        return None

def convert_csv_to_json(csv_path: Path):
    """-> {freq_hz:[float], mag_db:[float], phase_deg:[float]}  – tidy & small"""
    freq, mag, phase = [], [], []
    try:
        with csv_path.open(newline='') as f:
            r = csv.reader(f)
            header = next(r, None)
            if header and header[0].lower() == 'freq':
                pass
            else:
                f.seek(0)

            for row in r:
                if len(row) < 2:
                    continue
                try:
                    f_hz = float(row[0])
                    m_db = float(row[1])
                    p_deg = float(row[2]) if len(row) > 2 else 0.0
                except ValueError:
                    continue
                if f_hz > 0 and math.isfinite(f_hz) and math.isfinite(m_db):
                    freq.append(f_hz)
                    mag.append(m_db)
                    phase.append(p_deg)
    except Exception as e:
        print(f"CSV read error ({csv_path}): {e}")

    # smooth & down-sample
    freq = np.array(freq, dtype=float)
    mag  = np.array(mag,  dtype=float)
    phase = np.array(phase, dtype=float)

    # 1. throw away points (makes Gaussian wider in frequency space)
    freq_ds, mag_ds = _downsample(freq, mag, max_pts=MAX_PLOT_PTS)
    _, phase_ds     = _downsample(freq, phase, max_pts=MAX_PLOT_PTS)

    # 2. now smooth the coarse curve
    mag_smooth = _smooth(mag_ds, SMOOTH_SIGMA)

    # --- 3. drop the junk tail ------------------------------------
    mask = (freq_ds >= 80.0) & (freq_ds <= 18_000)   # was 20 Hz
    return {"freq_hz":   freq_ds[mask].tolist(),
            "mag_db":    mag_smooth[mask].tolist(),
            "phase_deg": phase_ds[mask].tolist()}

def _clean(arr):
    """convert numpy/array -> list of JSON-safe floats, drop non-finite"""
    if arr is None:
        return []
    # if it's an ndarray, tolist() is enough
    if hasattr(arr, 'tolist'):
        arr = arr.tolist()
    # ensure every element is a finite float
    return [float(x) for x in arr if isinstance(x, (int, float)) and math.isfinite(x)]

# ------------------------------------------------------------------
#  Flask routes
# ------------------------------------------------------------------

@app.route('/api/run-sweep', methods=['POST'])
def run_sweep():
    import subprocess
    import sounddevice as sd
    import traceback

    try:
        payload = request.get_json(silent=True) or {}
        speaker = payload.get('speaker')

        # Pick USB mic and HiFiBerry DAC explicitly
        devices = sd.query_devices()
        input_devices = [(i, d['name']) for i, d in enumerate(devices) if 'USB' in d['name'] and d['max_input_channels'] > 0]
        output_devices = [(i, d['name']) for i, d in enumerate(devices) if 'hifiberry' in d['name'].lower() and d['max_output_channels'] > 0]

        if not input_devices:
            return jsonify({"error": "USB microphone not found"}), 400
        if not output_devices:
            return jsonify({"error": "HiFiBerry DAC not found"}), 400

        in_dev, in_name = input_devices[0]
        out_dev, out_name = output_devices[0]

        cmd = [
            sys.executable, "-m", "measurely.sweep",
            "--fs", "48000",
            "--dur", "8.0",
            "--alsa-device", "plughw:0,0",
            "--in", str(in_dev),
            "--out", str(out_dev),
            "--mode", "both"
        ]
        if speaker:
            cmd += ["--speaker", speaker]

        def run():
            # 1. run sweep
            completed = subprocess.run(cmd, cwd="/home/matt/measurely", capture_output=True, text=True)
            # 2. grab the session path from the last line of stdout
            #    sweep.py prints:  Saved: /home/matt/Measurely/measurements/20251111_xxxxxx
            out_lines = completed.stdout.strip().splitlines()
            if out_lines and out_lines[-1].startswith("Saved:"):
                session_path = out_lines[-1].replace("Saved:", "").strip()
                # 3. analyse
                analysis_cmd = [sys.executable, "-m", "measurely.analyse", session_path]
                subprocess.run(analysis_cmd, cwd="/home/matt/measurely", check=False)
            else:
                print("[run_sweep] Could not find 'Saved:' line in sweep output")

        threading.Thread(target=run, daemon=True).start()
        return jsonify({"status": "started", "in": in_name, "out": out_name})

    except Exception as e:
        print("[/api/run-sweep] ERROR:", traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route('/api/sweep-progress', methods=['GET'])
def api_sweep_progress():
    return jsonify(sweep_progress)


@app.route('/api/latest', methods=['GET'])
def get_latest_data():
    try:
        data = get_latest_measurement()
        if not data:
            # fallback sample
            data = {
                "timestamp": datetime.now().isoformat(),
                "room": "Sample Room",
                "length": 4.0, "width": 4.0, "height": 3.0,
                "overall_score": 5.0, "bandwidth": 3.6, "balance": 1.6,
                "smoothness": 7.3, "peaks_dips": 3.3,
                "reflections": 4.0, "reverb": 10.0
            }
        return jsonify(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "ready": True,
        "mic": {"connected": True, "name": "USB Audio Device"},
        "dac": {"connected": True, "name": "Audio Output Device"},
        "reason": "", "measurely_available": False
    })


@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    try:
        sessions = []
        if MEAS_ROOT.exists():
            for session_dir in sorted(MEAS_ROOT.iterdir(),
                                      key=lambda d: d.stat().st_mtime,
                                      reverse=True):
                if not session_dir.is_dir():
                    continue
                sessions.append({
                    "id": session_dir.name,
                    "timestamp": datetime.fromtimestamp(session_dir.stat().st_mtime).isoformat(),
                    "has_analysis": (session_dir / "analysis.json").exists(),
                    "has_summary":  (session_dir / "summary.txt").exists(),
                    "session_dir": str(session_dir)
                })
        return jsonify(sessions)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
# ------------------------------------------------------------------
#  LOAD (make live) a previous session
# ------------------------------------------------------------------
@app.route('/api/session/<session_id>/load', methods=['POST'])
def load_session(session_id):
    """
    Copy the chosen session directory to /latest so /api/latest returns it.
    We simply symlink (or copy) the folder to a fixed name.
    """
    try:
        src = MEAS_ROOT / session_id
        if not src.is_dir():
            return jsonify({"error": "Session not found"}), 404

        latest_link = MEAS_ROOT / "latest"
        # remove old link if it exists
        if latest_link.is_symlink() or latest_link.exists():
            latest_link.unlink()
        # create new symlink
        latest_link.symlink_to(src.resolve())
        return jsonify({"status": "loaded", "session_id": session_id})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ------------------------------------------------------------------
#  NEW room-setup endpoints
# ------------------------------------------------------------------
@app.route('/api/room/<session_id>', methods=['POST'])
def save_room(session_id):
    """store user room/speaker data (metres) in meta.json"""
    try:
        ses = MEAS_ROOT / session_id
        if not ses.is_dir():
            return jsonify({"error": "Session not found"}), 404
        data = request.get_json(force=True)
        meta_file = ses / "meta.json"
        meta = json.loads(meta_file.read_text(encoding='utf-8')) if meta_file.exists() else {}
        meta.setdefault("settings", {})
        meta["settings"]["room"] = data
        write_json_atomic(meta, meta_file)
        return jsonify({"status": "saved"})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/room/<session_id>', methods=['GET'])
def load_room(session_id):
    """return room part of meta.json"""
    try:
        ses = MEAS_ROOT / session_id
        meta_file = ses / "meta.json"
        if not meta_file.exists():
            return jsonify({}), 200
        meta = json.loads(meta_file.read_text(encoding='utf-8')) or {}
        room = meta.get("settings", {}).get("room", {})
        return jsonify(room)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ------------------------------------------------------------------
#  static files
# ------------------------------------------------------------------
@app.route('/', methods=['GET'])
def serve_index():
    return send_from_directory('/home/matt/measurely/web', 'index.html')


@app.route('/<path:path>', methods=['GET'])
def serve_static(path):
    return send_from_directory('/home/matt/measurely/web', path)


# ------------------------------------------------------------------
#  entry
# ------------------------------------------------------------------
if __name__ == '__main__':
    print("Starting Real-Data Measurely Flask Server...")
    print(f"Measurements root: {MEAS_ROOT}")
    print("NEW: /api/room/<session>  (POST + GET) – saves/loads user room setup")
    app.run(host='0.0.0.0', port=5001, debug=True)