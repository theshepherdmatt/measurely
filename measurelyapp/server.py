#!/usr/bin/env python3
"""
Real-Data Measurely Flask Server
- uses real analysis.json scores
- NEW:  /api/room/<session_id>  (POST + GET)  – stores user room/speaker data
"""

import sys
from pathlib import Path

# Ensure import from measurelyapp/
APP_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_ROOT))

from led_status import update_led_state

import os
import json
import re
import time
import glob
import subprocess
import threading
import csv
import random
import math
import traceback
import numpy as np
import sounddevice as sd
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from scipy.ndimage import gaussian_filter1d


# ------------------------------------------------------------------
#  Flask init
# ------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

update_led_state("boot")

# ------------------------------------------------------------------
#  Single, unified Measurely root
# ------------------------------------------------------------------

APP_ROOT      = Path(__file__).resolve().parent        # /home/matt/measurely/measurelyapp
SERVICE_ROOT  = APP_ROOT.parent                        # /home/matt/measurely

MEAS_ROOT     = SERVICE_ROOT / "measurements"
PHRASES_DIR   = APP_ROOT / "phrases"                   # ← CORRECT!!
WEB_DIR       = SERVICE_ROOT / "web"
SPEAKERS_DIR  = SERVICE_ROOT / "speakers"

# ------------------------------------------------------------------
#  First-time detection
# ------------------------------------------------------------------
def is_first_time_user():
    """
    User is 'first time' if MEAS_ROOT contains ONLY:
      - 'demo' (or 'DEMO')
      - or is empty
      - AND has no real measurement folders
    """
    if not MEAS_ROOT.exists():
        return True

    items = []
    for entry in MEAS_ROOT.iterdir():
        name = entry.name.lower()

        # ignore symlink 'latest'
        if name == "latest":
            continue

        # ignore hidden or temp junk
        if name.startswith('.'):
            continue

        # ignore demo folder
        if name.startswith("demo"):
            continue

        # anything else is a REAL measurement
        if entry.is_dir():
            return False

    # If we get here → no real measurements found
    return True

# ------------------------------------------------------------------
#  Ensure folders exist (installer may have copied them, but be safe)
# ------------------------------------------------------------------
for d in (MEAS_ROOT, PHRASES_DIR, SPEAKERS_DIR, WEB_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------
#  rest of your original config
# ------------------------------------------------------------------
SMOOTH_SIGMA = 6
MAX_PLOT_PTS = 1200

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
def get_latest_measurement():
    import os, pprint
    print("DEBUG: MEAS_ROOT =", os.environ.get("MEASURELY_MEAS_ROOT"))
    print("DEBUG: real path  =", MEAS_ROOT)

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
            # (keep everything you already have)
            "id": path.name,
            "timestamp": meta_data.get("timestamp", datetime.now().isoformat()),
            "room": room_info,
            "length": room_info.get("length_m", 4.0),
            "width":  room_info.get("width_m", 4.0),
            "height": room_info.get("height_m", 3.0),

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

            "band_levels_db": ana_data.get("band_levels_db", {}),
            "modes": ana_data.get("modes", []),

            # NEW: buddy-friendly keys
            "buddy_freq_blurb":   ana_data.get("buddy_freq_blurb", ""),
            "buddy_treat_blurb":  ana_data.get("buddy_treat_blurb", ""),
            "buddy_action_blurb": ana_data.get("buddy_action_blurb", ""),

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
#  IP Detection Helper
# ------------------------------------------------------------------
import socket

def get_ip_address():
    """Return the Pi's LAN IP address (eth0 or wlan0)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return None


# ------------------------------------------------------------------
#  FETCH A SINGLE SESSION'S ANALYSIS + FREQUENCY DATA
# ------------------------------------------------------------------
@app.route('/api/session/<session_id>', methods=['GET'])
def api_get_session(session_id):
    try:
        ses = MEAS_ROOT / ("latest" if session_id == "latest" else session_id)

        if not ses.exists():
            return jsonify({"error": f"Session not found: {session_id}"}), 404

        data = load_session_data(ses)
        if not data:
            return jsonify({"error": "Failed to load session"}), 500

        return jsonify(data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ------------------------------------------------------------------
#  RUN SWEEP + UPDATE LATEST + RESTORE ROOM DATA + ANALYSE
# ------------------------------------------------------------------
@app.route('/api/run-sweep', methods=['POST'])
def run_sweep():
    import subprocess, traceback, sounddevice as sd
    import threading, os

    try:
        payload = request.get_json(silent=True) or {}
        speaker = payload.get('speaker')

        update_led_state("sweep_running")

        # Detect audio devices
        devices = sd.query_devices()
        input_devices = [(i, d['name']) for i, d in enumerate(devices)
                         if "usb" in d['name'].lower() and d['max_input_channels'] > 0]
        output_devices = [(i, d['name']) for i, d in enumerate(devices)
                          if "hifiberry" in d['name'].lower() and d['max_output_channels'] > 0]

        if not input_devices:
            return jsonify({"error": "USB microphone not found"}), 400
        if not output_devices:
            return jsonify({"error": "HiFiBerry DAC not found"}), 400

        in_dev, in_name = input_devices[0]
        out_dev, out_name = output_devices[0]

        SWEEP = f"{SERVICE_ROOT}/measurelyapp/sweep.py"
        ANALYSE = f"{SERVICE_ROOT}/measurelyapp/analyse.py"
        BASEDIR = str(SERVICE_ROOT)

        cmd = [sys.executable, SWEEP, "--mode", "both", "--playback", "aplay", "--verbose"]
        if speaker:
            cmd += ["--speaker", speaker]

        # -----------------------------------------------------
        # Background thread
        # -----------------------------------------------------
        def run():
            # -----------------------------------------------------
            # 1. Run sweep
            # -----------------------------------------------------
            completed = subprocess.run(
                cmd, cwd=BASEDIR, capture_output=True, text=True
            )

            out_lines = completed.stdout.strip().splitlines()
            session_path = None

            for line in reversed(out_lines):
                if line.startswith("Saved:"):
                    session_path = line.replace("Saved:", "").strip()
                    break

            if not session_path:
                print("[run_sweep] ERROR: No Saved: path found")
                print(completed.stdout)
                print(completed.stderr)
                return

            # -----------------------------------------------------
            # 2. Update latest symlink
            # -----------------------------------------------------
            subprocess.run([
                "ln", "-sfn",
                session_path,
                f"{BASEDIR}/measurements/latest"
            ])

            # -----------------------------------------------------
            # 3. RESTORE ROOM SETTINGS BEFORE ANALYSIS
            # -----------------------------------------------------
            try:
                latest = MEAS_ROOT / "latest"
                room_file = SERVICE_ROOT / "room.json"

                if room_file.exists():
                    room_data = json.loads(room_file.read_text())

                    meta_file = latest / "meta.json"
                    meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}

                    meta.setdefault("settings", {})
                    meta["settings"]["room"] = room_data

                    write_json_atomic(meta, meta_file)

                    print("✓ Restored room settings into new latest/meta.json")

                else:
                    print("⚠ No room.json exists — nothing to restore")

            except Exception as e:
                print("Room metadata restore failed:", e)

            # -----------------------------------------------------
            # 4. Analyse AFTER restoring room data
            # -----------------------------------------------------
            subprocess.run(
                [sys.executable, ANALYSE, session_path],
                cwd=BASEDIR,
                check=False
            )

            update_led_state("sweep_complete")

        threading.Thread(target=run, daemon=True).start()

        return jsonify({"status": "started", "in": in_name, "out": out_name})

    except Exception as e:
        print("[/api/run-sweep] ERROR:", traceback.format_exc())
        return jsonify({"error": str(e)}), 500



@app.route('/api/sweep-progress', methods=['GET'])
def api_sweep_progress():
    return jsonify(sweep_progress)


@app.route('/api/status', methods=['GET'])
def get_status():
    ip = get_ip_address()

    try:
        devices = sd.query_devices()

        # Detect USB Mic
        usb_mics = [
            d for d in devices
            if "usb" in d["name"].lower() and d["max_input_channels"] > 0
        ]
        mic_connected = len(usb_mics) > 0
        mic_name = usb_mics[0]["name"] if mic_connected else None

        # Detect HiFiBerry DAC
        dacs = [
            d for d in devices
            if "hifiberry" in d["name"].lower() and d["max_output_channels"] > 0
        ]
        dac_connected = len(dacs) > 0
        dac_name = dacs[0]["name"] if dac_connected else None

    except Exception as e:
        print("Device detection error:", e)
        mic_connected = False
        dac_connected = False
        mic_name = None
        dac_name = None

    ready = mic_connected and dac_connected

    return jsonify({
        "ready": ready,
        "ip": ip if ip else None,

        "mic": {
            "connected": mic_connected,
            "name": mic_name
        },
        "dac": {
            "connected": dac_connected,
            "name": dac_name
        },

        "reason": "" if ready else "Missing audio devices",
        "measurely_available": True
    })



# measurelyapp/server.py (UPDATED)

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """
    Return ONLY the last 3 REAL session folders:
    - ignore DEMO folder
    - ignore 'latest' symlink
    - ignore anything not matching actual session format
    """
    try:
        sessions = []
        pattern = re.compile(r"^\d{8}_\d{6}_[0-9a-fA-F]{6}$")

        if MEAS_ROOT.exists():

            for entry in MEAS_ROOT.iterdir():

                name = entry.name

                # ignore demo
                if name.upper().startswith("DEMO"):
                    continue

                # ignore symlink 'latest'
                if name == "latest":
                    continue

                # ignore anything not matching session folder pattern
                if not pattern.match(name):
                    continue

                # valid folder → include
                sessions.append(entry)

            # newest first
            sessions.sort(key=lambda d: d.stat().st_mtime, reverse=True)

            # return ONLY the last 3 real sessions
            out = []
            for d in sessions[:3]:
                out.append({
                    "id": d.name,
                    "timestamp": datetime.fromtimestamp(d.stat().st_mtime).isoformat(),
                    "has_analysis": (d / "analysis.json").exists(),
                    "has_summary":  (d / "summary.txt").exists(),
                    "session_dir": str(d)
                })

            return jsonify(out)

        return jsonify([])

    except Exception as e:
        print(f"Error in get_sessions: {e}")
        return jsonify({"error": str(e)}), 500

    
# ----------------------------------------------------------
#  serve buddy_phrases.json from project root
# ----------------------------------------------------------
@app.route('/buddy_phrases.json')
def serve_buddy_phrases():
    return send_from_directory(PHRASES_DIR, 'buddy_phrases.json')

# ----------------------------------------------------------
#  serve foot_tags.json from project root
# ----------------------------------------------------------
@app.route('/foot_tags.json')
def serve_foot_tags():
    return send_from_directory(PHRASES_DIR, 'foot_tags.json')

# ----------------------------------------------------------
#  serve foot_tags.json from project root
# ----------------------------------------------------------
@app.route('/buddy_recommends.json')
def serve_buddy_recommends():
    return send_from_directory(PHRASES_DIR, 'buddy_recommends.json')

# ----------------------------------------------------------
#  serve speakers.json from project root
# ----------------------------------------------------------

@app.route('/speakers/<path:filename>')
def serve_speakers(filename):
    return send_from_directory(SPEAKERS_DIR, filename)
    
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
#  FIXED: room-setup endpoints – always use /measurements/latest
# ------------------------------------------------------------------

@app.route('/api/room/latest', methods=['POST'])
def save_room():
    """store persistent user room/speaker data in latest/meta.json + global room.json"""
    try:
        ses = MEAS_ROOT / "latest"
        if not ses.is_dir():
            return jsonify({"error": "latest session not found"}), 404

        data = request.get_json(force=True)
        print("📥 Received room data:", data)

        # --- UPDATE latest/meta.json ---
        meta_file = ses / "meta.json"
        meta = json.loads(meta_file.read_text(encoding='utf-8')) if meta_file.exists() else {}
        meta.setdefault("settings", {})
        meta["settings"].setdefault("room", {})
        meta["settings"]["room"].update(data)
        write_json_atomic(meta, meta_file)

        # --- UPDATE GLOBAL room.json ---
        room_file = SERVICE_ROOT / "room.json"
        write_json_atomic(data, room_file)

        return jsonify({"status": "saved"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/room/latest', methods=['GET'])
def load_room():
    """return room settings from latest/meta.json"""
    try:
        ses = MEAS_ROOT / "latest"
        meta_file = ses / "meta.json"

        if not meta_file.exists():
            return jsonify({}), 200

        meta = json.loads(meta_file.read_text(encoding='utf-8'))
        room = meta.get("settings", {}).get("room", {})
        return jsonify(room)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
@app.route('/api/latest', methods=['GET'])
def api_latest():
    """Return latest session (alias for /api/session/latest)."""
    ses = MEAS_ROOT / "latest"
    if not ses.exists():
        return jsonify({"error": "no latest session"}), 404

    data = load_session_data(ses)
    if not data:
        return jsonify({"error": "failed to load latest"}), 500

    return jsonify(data)

# ------------------------------------------------------------------
#  serve onboarding or index
# ------------------------------------------------------------------
@app.route('/', methods=['GET'])
def serve_index():
    update_led_state("client_connected")   # LED goes green instantly
    if is_first_time_user():
        return send_from_directory(WEB_DIR, 'onboarding.html')
    return send_from_directory(WEB_DIR, 'index.html')

# ------------------------------------------------------------------
#  static files (CSS, JS, icons, images, HTML)
# ------------------------------------------------------------------
@app.route('/<path:filename>', methods=['GET'])
def serve_static(filename):
    return send_from_directory(WEB_DIR, filename)


# ------------------------------------------------------------------
#  entry
# ------------------------------------------------------------------
if __name__ == '__main__':
    print("Starting Real-Data Measurely Flask Server...")
    print(f"Measurements root: {MEAS_ROOT}")
    print("NEW: /api/room/<session>  (POST + GET) – saves/loads user room setup")
    app.run(host='0.0.0.0', port=5000, debug=False)
