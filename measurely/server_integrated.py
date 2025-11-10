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
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ------------------------------------------------------------------
#  Flask init
# ------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

# ------------------------------------------------------------------
#  config
# ------------------------------------------------------------------
MEAS_ROOT = Path("/home/matt/Measurely/measurements")

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
    """load response + analysis.json (+ meta.json) -> dict for dashboard"""
    try:
        session_path = Path(session_dir)
        print(f"Loading session: {session_path}")

        # find response.csv (left/right or root)
        left_csv   = session_path / "left" / "response.csv"
        right_csv  = session_path / "right" / "response.csv"
        root_csv   = session_path / "response.csv"

        response_file = None
        if left_csv.exists():
            response_file = left_csv
        elif right_csv.exists():
            response_file = right_csv
        elif root_csv.exists():
            response_file = root_csv

        if not response_file:
            print("No response.csv found")
            return None

        freq_data = convert_csv_to_json(response_file)
        if not freq_data:
            print("Could not convert CSV")
            return None

        # analysis.json
        analysis_data = {}
        analysis_file = session_path / "analysis.json"
        if analysis_file.exists():
            with open(analysis_file, 'r', encoding='utf-8') as f:
                analysis_data = json.load(f)

        # meta.json
        meta_data = {}
        meta_file = session_path / "meta.json"
        if meta_file.exists():
            with open(meta_file, 'r', encoding='utf-8') as f:
                meta_data = json.load(f)

        # build unified payload
        room_info = meta_data.get("settings", {}).get("room", {})
        result = {
            "timestamp": meta_data.get('timestamp', datetime.now().isoformat()),
            "room": meta_data.get('room', 'Unknown Room'),
            "length": room_info.get('length_m', meta_data.get('length', 4.0)),
            "width":  room_info.get('width_m',  meta_data.get('width',  4.0)),
            "height": room_info.get('height_m', meta_data.get('height', 3.0)),
            "freq_hz": freq_data.get('freq_hz', []),
            "mag_db":  freq_data.get('mag_db',  []),
            "phase_deg": freq_data.get('phase_deg', []),

            # real scores from analysis.json
            "overall_score": analysis_data.get('scores', {}).get('overall', 5.0),
            "bandwidth":     analysis_data.get('scores', {}).get('bandwidth', 3.6),
            "balance":       analysis_data.get('scores', {}).get('balance', 1.6),
            "smoothness":    analysis_data.get('scores', {}).get('smoothness', 7.3),
            "peaks_dips":    analysis_data.get('scores', {}).get('peaks_dips', 3.3),
            "reflections":   analysis_data.get('scores', {}).get('reflections', 4.0),
            "reverb":        analysis_data.get('scores', {}).get('reverb', 10.0),

            "session_dir": str(session_dir),
            "analysis_notes": analysis_data.get('notes', []),
            "simple_summary": analysis_data.get('plain_summary', ''),
            "simple_fixes":   analysis_data.get('simple_fixes', [])
        }
        print(f"Loaded session data with {len(result['freq_hz'])} frequency points")
        return result

    except Exception as e:
        print(f"Error loading session data: {e}")
        import traceback
        traceback.print_exc()
        return None

def convert_csv_to_json(csv_path):
    """convert response.csv -> {freq_hz:[],mag_db:[],phase_deg:[]}"""
    try:
        print(f"Converting CSV: {csv_path}")
        frequencies, magnitudes, phases = [], [], []
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            # optional header skip
            try:
                header = next(reader)
                if len(header) == 3 and header[0] == 'freq':
                    pass  # skip
                else:
                    f.seek(0)
                    reader = csv.reader(f)
            except:
                f.seek(0)
                reader = csv.reader(f)

            for row in reader:
                if len(row) < 2:
                    continue
                try:
                    freq, mag = float(row[0]), float(row[1])
                    frequencies.append(freq)
                    magnitudes.append(mag)
                    phases.append(0)          # no phase column
                except ValueError:
                    continue
        frequencies = np.array(frequencies, dtype=float)
        magnitudes  = np.array(magnitudes,  dtype=float)
        phases      = np.array(phases,      dtype=float)
        mask = np.isfinite(frequencies) & np.isfinite(magnitudes) & (frequencies > 0)
        return {"freq_hz": frequencies[mask], "mag_db": magnitudes[mask], "phase_deg": phases[mask]}
    except Exception as e:
        print(f"CSV error: {e}")
        import traceback
        traceback.print_exc()
        return None

# ------------------------------------------------------------------
#  original Flask routes (unchanged)
# ------------------------------------------------------------------
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
            for session_dir in sorted(MEAS_ROOT.iterdir(), key=lambda d: d.stat().st_mtime, reverse=True):
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