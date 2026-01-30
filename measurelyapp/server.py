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

from measurelyapp.network.api import network_api
from measurelyapp.network import controller
from history import build_sweephistory

import os

env_file = Path.home() / "measurely" / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def play_startup_sound():
    wav = "/home/matt/measurely/web/startup-sound.wav"

    if not os.path.exists(wav):
        print("⚠️ Startup sound not found:", wav)
        return

    try:
        # Give ALSA/USB a moment to settle
        time.sleep(2)

        subprocess.Popen(
            ["aplay", "-q", wav],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("🔊 Startup sound played")

    except Exception as e:
        print("⚠️ Failed to play startup sound:", e)

try:
    sd._initialize()
    print("✓ PortAudio initialised once at startup")
except Exception as e:
    print("❌ PortAudio init failed at startup:", e)

threading.Thread(target=play_startup_sound, daemon=True).start()


def cancel_sweep():
    global SWEEP_CANCELLED
    SWEEP_CANCELLED = True
    try:
        sd.stop()  # Immediately halt playback/recording
    except Exception:
        pass

def force_stop_audio():
    try:
        sd.stop()
    except Exception:
        pass
# ------------------------------------------------------------------
#  Flask init
# ------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

app.register_blueprint(network_api)

update_led_state("boot")

#controller.init_network_on_boot()

# ------------------------------------------------------------------
#  Single, unified Measurely root
# ------------------------------------------------------------------

APP_ROOT      = Path(__file__).resolve().parent        
SERVICE_ROOT  = APP_ROOT.parent                        

MEAS_ROOT     = SERVICE_ROOT / "measurements"
PHRASES_DIR   = APP_ROOT / "dave" / "phrases"                   # ← CORRECT!!
WEB_DIR       = SERVICE_ROOT / "web"
SPEAKERS_DIR  = SERVICE_ROOT / "speakers"

AI_SUMMARY_FILE = MEAS_ROOT / "latest" / "ai.json"


# ------------------------------------------------------------------
#  First-time detection
# ------------------------------------------------------------------
def is_first_time_user():
    """
    User is 'first time' if onboarding has not been completed.
    Falls back to legacy sweep-based detection if state file is missing.
    """

    STATE_FILE = SERVICE_ROOT / "state" / "onboarding.json"

    # --- NEW: explicit onboarding state ---
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if data.get("completed") is False:
                return True
        except Exception as e:
            print("⚠️ onboarding.json unreadable, falling back:", e)

    # --- LEGACY: sweep-based fallback ---
    if not MEAS_ROOT.exists():
        return True

    for entry in MEAS_ROOT.iterdir():
        name = entry.name.lower()

        if name in ("latest",):
            continue
        if name.startswith('.'):
            continue
        if name.startswith("demo"):
            continue

        if entry.is_dir():
            return False

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

# 🔥 LIVE SWEEP LOG BUFFER (for UI streaming)
sweep_logs = []
MAX_LOG_LINES = 200

# ------------------------------------------------------------------
#  helpers
# ------------------------------------------------------------------
def ensure_latest():
    meas = MEAS_ROOT
    demo = meas / "DEMO_DO_NOT_DELETE"
    latest = meas / "latest"

    # Only fix when nothing else exists
    real_sessions = [
        d for d in meas.iterdir()
        if d.is_dir() and d.name not in ("latest", "DEMO_DO_NOT_DELETE")
    ]

    # If there are no real sessions, latest must point to demo
    if not real_sessions:
        if latest.exists() or latest.is_symlink():
            latest.unlink()
        latest.symlink_to(demo)
        print("✓ latest → DEMO_DO_NOT_DELETE")
    else:
        print("✓ real sessions exist → leaving latest alone")

ensure_latest()


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
        

        # ---------------------------------------------------
        # ✔️ Load Dave summary + action tips from summary.txt
        # ---------------------------------------------------
        summary_file = path / "summary.txt"
        dave_summary = None
        dave_actions = []

        if summary_file.exists():
            lines = summary_file.read_text(encoding='utf-8').splitlines()
            if lines:
                dave_summary = lines[0]
                if len(lines) > 1:
                    dave_actions = [
                        line.lstrip("-• ").strip()
                        for line in lines[1:]
                        if line.strip()
                    ]

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
            "smoothness_std_db": ana_data.get("smoothness_std_db"),
            "peaks_dips":    ana_data.get("scores", {}).get("peaks_dips", 3.3),
            "reflections":   ana_data.get("scores", {}).get("reflections", 4.0),
            "clarity":       ana_data.get("scores", {}).get("clarity", 3.0),
            "scores":        {**ana_data.get("scores", {}), "clarity": ana_data.get("scores", {}).get("clarity", 3.0)},

            "reflections_ms": ana_data.get("reflections_ms", []),
            "smoothness_std_db": ana_data.get("smoothness_std_db", None),

            "signal_integrity": ana_data.get("signal_integrity", {}).get("score", 0.0),
            "signal_integrity_raw": ana_data.get("signal_integrity", {}),

            "session_dir": str(path),
            "analysis_notes": ana_data.get("notes", []),
            "notes": meta_data.get("notes", ""),
            "simple_summary": ana_data.get("plain_summary", ""),
            "simple_fixes":   ana_data.get("simple_fixes", []),
            "dave": ana_data.get("dave", {}),   # ← inject backend Dave summary + actions
            "band_levels_db": ana_data.get("band_levels_db", {}),
            "modes": ana_data.get("modes", []),

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
#  FETCH ALL SESSION FOLDERS (uploadsX or timestamped)
# ------------------------------------------------------------------
@app.route('/api/sessions/all', methods=['GET'])
def get_sessions_all():
    """Return ALL real session folders (uploadsX or legacy timestamp format)."""
    try:
        sessions = []

        # Accept:
        #   - uploads1, uploads2, uploads10...
        #   - 20241201_191422_A4FBCD (old timestamp format)
        pattern = re.compile(r"^(uploads\d+|\d{8}_\d{6}_[0-9a-fA-F]{6})$")

        if MEAS_ROOT.exists():
            for entry in MEAS_ROOT.iterdir():
                name = entry.name

                # Skip irrelevant folders
                if name.upper().startswith("DEMO"):
                    continue
                if name == "latest":
                    continue

                # Only accept folders matching uploadsX or timestamp pattern
                if not pattern.match(name):
                    continue

                sessions.append(entry)

            # Sort newest → oldest
            sessions.sort(key=lambda d: d.stat().st_mtime, reverse=True)

            # Build response objects
            out = [{
                "id": d.name,
                "timestamp": datetime.fromtimestamp(d.stat().st_mtime).isoformat(),
                "has_analysis": (d / "analysis.json").exists(),
                "has_summary": (d / "summary.txt").exists(),
                "session_dir": str(d)
            } for d in sessions]

            return jsonify(out)

        # No MEAS_ROOT or no sessions
        return jsonify([])

    except Exception as e:
        print(f"Error in get_sessions_all: {e}")
        return jsonify({"error": str(e)}), 500



# ------------------------------------------------------------------
#  FETCH A SINGLE SESSION'S FULL ANALYSIS + FREQUENCY DATA
# ------------------------------------------------------------------
@app.route('/api/session/<session_id>', methods=['GET'])
def api_get_session(session_id):
    """Load a specific session (or 'latest') and return full analysis."""
    try:
        session_path = MEAS_ROOT / ("latest" if session_id == "latest" else session_id)

        if not session_path.exists():
            return jsonify({"error": f"Session not found: {session_id}"}), 404

        data = load_session_data(session_path)
        if not data:
            return jsonify({"error": "Failed to load session"}), 500

        return jsonify(data)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    

# ------------------------------------------------------------------
#  FETCH AI COMPARISON FOR A SESSION
# ------------------------------------------------------------------
@app.route("/api/session/<session_id>/ai_compare", methods=["GET"])
def api_session_ai_compare(session_id):
    """
    Return ai_compare.json for a given uploads session if it exists.
    """
    try:
        session_dir = MEAS_ROOT / ("latest" if session_id == "latest" else session_id)
        ai_file = session_dir / "ai_compare.json"

        if not ai_file.exists():
            return jsonify({}), 404

        return send_from_directory(
            session_dir,
            "ai_compare.json",
            mimetype="application/json"
        )

    except Exception as e:
        print("❌ AI compare load failed:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



# ------------------------------------------------------------------
# SAVE/UPDATE NOTE for a Session
# ------------------------------------------------------------------
@app.route("/api/session/<session_id>/note", methods=["POST"])
def update_session_note(session_id):
    """ Save per-uploads notes into meta.json """

    try:
        # Resolve session path exactly like GET handler does
        session_dir = MEAS_ROOT / ( "latest" if session_id == "latest" else session_id )
        if not session_dir.exists():
            return jsonify(error=f"Session folder not found: {session_id}", session_dir=str(session_dir)), 404

        meta_file = session_dir / "meta.json"
        if not meta_file.exists():
            return jsonify(error="meta.json missing", path=str(meta_file)), 404

        payload = request.get_json(force=True) or {}
        note = payload.get("note", "").strip()

        # Load existing meta
        meta = json.loads(meta_file.read_text(encoding='utf-8'))

        # Update meta with notes field
        meta["notes"] = note

        # Save atomically
        write_json_atomic(meta, meta_file)

        print(f"[NOTE SAVED] {session_id}: {note}")

        return jsonify(ok=True, note=note)

    except Exception as e:
        print("ERROR saving note:", e)
        traceback.print_exc()
        return jsonify(error=str(e)), 500


# ------------------------------------------------------------------
#  RUN uploads + UPDATE LATEST + RESTORE ROOM DATA + ANALYSE
# ------------------------------------------------------------------
@app.route('/api/run-sweep', methods=['POST'])
def run_sweep():
    import subprocess, traceback, sounddevice as sd
    import threading, os, time, json

    try:
        payload = request.get_json(silent=True) or {}
        speaker = payload.get('speaker')

        update_led_state("sweep_running")

        sweep_progress['running'] = True
        sweep_progress['progress'] = 0
        sweep_progress['message'] = "Starting sweep…"
        sweep_progress['session_id'] = None

        # Clear old status file
        status_file = "/tmp/measurely_sweep_status.json"
        if os.path.exists(status_file):
            os.remove(status_file)

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
        VENV_PY = f"{SERVICE_ROOT}/venv/bin/python"

        cmd = [
            VENV_PY, SWEEP,
            "--mode", "both",
            "--playback", "aplay",
            "--alsa-device", "plughw:CARD=sndrpihifiberry,DEV=0",
            "--verbose",
            "--in", "1",
            "--out", "0"
        ]

        if speaker:
            cmd += ["--speaker", speaker]

        # -----------------------------------------------------
        # Background thread
        # -----------------------------------------------------
        def run():
            print("🔥 Sweep thread started")
            sweep_cancel_event.clear()

            global sweep_process
            sweep_process = subprocess.Popen(
                cmd,
                cwd=BASEDIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            # -----------------------------
            # LIVE LOG STREAMING
            # -----------------------------
            def stream_logs(proc):
                global sweep_logs
                for line in iter(proc.stdout.readline, ''):
                    line = line.strip()
                    if not line:
                        continue

                    print("[SWEEP LOG]", line)
                    sweep_logs.append(line)
                    print(f"[LOG BUFFER SIZE] {len(sweep_logs)}")
                    if len(sweep_logs) > MAX_LOG_LINES:
                        sweep_logs = sweep_logs[-MAX_LOG_LINES:]

            threading.Thread(target=stream_logs, args=(sweep_process,), daemon=True).start()

            time.sleep(0.5)
            threading.Thread(target=read_real_progress, daemon=True).start()

            # -----------------------------
            # WAIT FOR SWEEP TO FINISH
            # -----------------------------
            while sweep_process.poll() is None:
                if sweep_cancel_event.is_set():
                    print("🟥 Sweep cancelled mid-run")
                    try:
                        sweep_process.terminate()
                        sweep_process.wait(timeout=2)
                    except Exception:
                        sweep_process.kill()

                    sweep_progress.update({
                        "running": False,
                        "progress": 0,
                        "message": "Cancelled"
                    })
                    update_led_state("idle")
                    return
                time.sleep(0.2)

            if sweep_process.returncode != 0:
                print("❌ Sweep process failed")
                sweep_progress.update({
                    "running": False,
                    "progress": 0,
                    "message": "Sweep failed"
                })
                update_led_state("error")
                return

            # -----------------------------
            # FIND NEW SESSION FOLDER
            # -----------------------------
            sessions = [
                d for d in MEAS_ROOT.iterdir()
                if d.is_dir() and d.name not in ("latest", "DEMO_DO_NOT_DELETE")
            ]

            if not sessions:
                print("❌ No session folder created")
                sweep_progress.update({
                    "running": False,
                    "progress": 0,
                    "message": "Sweep failed"
                })
                update_led_state("error")
                return

            latest_session = max(sessions, key=lambda d: d.stat().st_mtime)
            session_path = str(latest_session)
            print("✓ New session detected:", session_path)

            # -----------------------------
            # UPDATE latest symlink
            # -----------------------------
            subprocess.run([
                "ln", "-sfn",
                session_path,
                f"{BASEDIR}/measurements/latest"
            ])

            # -----------------------------
            # RESTORE ROOM DATA
            # -----------------------------
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
                    print("✓ Room data restored")
            except Exception as e:
                print("Room restore failed:", e)

            # -----------------------------
            # RUN ANALYSIS
            # -----------------------------
            subprocess.run([VENV_PY, ANALYSE, session_path], cwd=BASEDIR, check=False)

            try:
                build_sweephistory(limit=4)
                print("✓ sweephistory updated")
            except Exception as e:
                print("⚠️ sweephistory failed:", e)

            sweep_progress.update({
                "running": False,
                "progress": 100,
                "message": "Analysis complete ✔"
            })
            update_led_state("sweep_complete")

        threading.Thread(target=run, daemon=True).start()

        return jsonify({"status": "started", "in": in_name, "out": out_name})

    except Exception as e:
        print("[/api/run-sweep] ERROR:", traceback.format_exc())
        return jsonify({"error": str(e)}), 500

# ------------------------------------------------------------------
#  sweep control (for cancellation)
# ------------------------------------------------------------------
def read_real_progress():
    status_file = "/tmp/measurely_sweep_status.json"

    while sweep_progress["running"] and not sweep_cancel_event.is_set():
        try:
            if os.path.exists(status_file):
                with open(status_file) as f:
                    data = json.load(f)

                sweep_progress["progress"] = int(data.get("percent", 0))
                sweep_progress["message"] = data.get("phase", "Running…")

                # 🔒 DO NOT allow the sweep.py status file to end the sweep in the UI
                # Only allow it to keep running=True (never set False here)
                if bool(data.get("running", True)) is True:
                    sweep_progress["running"] = True

        except Exception:
            pass

        time.sleep(0.4)


sweep_process = None
sweep_cancel_event = threading.Event()

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

@app.route("/api/sweephistory", methods=["GET", "POST"])
def api_build_sweephistory():
    history = build_sweephistory(limit=4)
    return jsonify(history)

@app.route('/api/sweep-logs', methods=['GET'])
def api_sweep_logs():
    return jsonify(sweep_logs)

@app.route("/api/cancel-sweep", methods=["POST"])
def cancel_sweep():
    global sweep_process

    if not sweep_progress["running"]:
        return jsonify({"status": "no sweep running"}), 200

    print("🟥 Cancel sweep requested")
    sweep_cancel_event.set()

    force_stop_audio()

    # Kill Python sweep process
    if sweep_process and sweep_process.poll() is None:
        try:
            sweep_process.terminate()
            sweep_process.wait(timeout=2)
        except Exception:
            sweep_process.kill()

    # Reset progress
    sweep_progress["running"] = False
    sweep_progress["progress"] = 0
    sweep_progress["message"] = "Cancelled"
    sweep_progress["session_id"] = None

    update_led_state("idle")

    return jsonify({"status": "cancelled"})


# ----------------------------------------------------------
#  Chart stuff
# ----------------------------------------------------------

from flask import send_file

@app.route("/api/session/<session_id>/report_curve")
def api_report_curve(session_id):
    session_dir = MEAS_ROOT / ("latest" if session_id == "latest" else session_id)
    curve = session_dir / "report_curve.json"

    if not curve.exists():
        return jsonify({"error": "report_curve.json not found"}), 404

    return send_file(curve, mimetype="application/json")

# ----------------------------------------------------------
#  Report stuff
# ----------------------------------------------------------

@app.route("/api/report/latest", methods=["GET"])
def api_report_latest():
    try:
        latest = MEAS_ROOT / "latest"
        if not latest.exists():
            return {"error": "No latest session"}, 404

        output_png = SERVICE_ROOT / "web" / "report.png"

        cmd = [
            "node",
            str(SERVICE_ROOT / "web" / "js" / "share-report.js"),
            str(latest.resolve())
        ]

        # 🔧 FIX: do NOT crash the API if Node fails
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )

        print("REPORT STDOUT:", result.stdout)
        print("REPORT STDERR:", result.stderr)

        if not output_png.exists():
            return {"error": "Report not generated"}, 500

        return send_file(
            output_png,
            mimetype="image/png",
            as_attachment=True,
            download_name="measurely-room-report.png"
        )

    except Exception:
        traceback.print_exc()
        return {"error": "Report failed"}, 500


# ----------------------------------------------------------
#  Analysis Progress Endpoint  (UI polling)
# ----------------------------------------------------------
@app.route('/api/analysis-progress', methods=['GET'])
def api_analysis_progress():
    STATUS_FILE = "/tmp/measurely_analysis_status.json"

    if not os.path.exists(STATUS_FILE):
        return jsonify({
            "running": False,
            "progress": 0,
            "message": "waiting for analysis"
        }), 200

    try:
        with open(STATUS_FILE, "r") as f:
            data = json.load(f)
        # Guarantee required fields exist
        return jsonify({
            "running": bool(data.get("running", False)),
            "progress": int(data.get("progress", 0)),
            "message": data.get("message", "…")
        }), 200
    except Exception as e:
        print("❌ Error reading analysis status:", e)
        return jsonify({
            "running": False,
            "progress": 0,
            "message": "error reading status"
        }), 200


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


@app.route("/api/session/<session_id>/analysis_ai")
def api_session_analysis_ai(session_id):
    import os
    from flask import jsonify

    path = os.path.join("measurements", session_id, "analysis_ai.json")

    if not os.path.exists(path):
        return jsonify({"error": "analysis_ai not found"}), 404

    with open(path) as f:
        return jsonify(json.load(f))
    
# ----------------------------------------------------------
#  serve dave_phrases.json from project root
# ----------------------------------------------------------
@app.route('/dave_phrases.json')
def serve_dave_phrases():
    return send_from_directory(PHRASES_DIR, 'dave_phrases.json')

@app.route('/overall_phrases.json')
def serve_overall_phrases():
    return send_from_directory(PHRASES_DIR, 'overall_phrases.json')

@app.route('/tipstweaks_phrases.json')
def serve_tipstweaks_phrases():
    return send_from_directory(PHRASES_DIR, 'tipstweaks_phrases.json')

# ----------------------------------------------------------
#  serve speakers.json from project root
# ----------------------------------------------------------

@app.route('/api/speakers', methods=['GET'])
def api_speakers():
    """
    Provide active speaker and list of available profiles from master catalogue:
    ~/measurely/speakers/speakers.json
    """
    try:
        # Correct import to ensure SPEAKER_DIR exists
        from measurelyapp.speaker import SPEAKER_DIR

        master = SPEAKER_DIR / "speakers.json"

        if not master.exists():
            print("⚠️ speakers.json missing at:", master)
            return jsonify({
                "current": {"key": "unknown", "name": "Unknown", "type": "unknown"},
                "list": []
            })

        # Load master speaker catalogue safely
        catalogue = json.loads(master.read_text() or "{}")

        # Build speaker list
        # Build speaker list — include friendly_name and all extras
        speakers = []

        for key, data in catalogue.items():
            speakers.append({
                "key": key,
                "name": data.get("name", key.replace("_", " ").title()),
                "friendly_name": data.get("friendly_name"),
                "type": data.get("type", "unknown"),
                "notes": data.get("notes"),
                "brand": data.get("brand"),
                "model": data.get("model"),
            })

        # Attempt to read current from latest session
        current_key = None
        try:
            latest = load_session_data(MEAS_ROOT / "latest")
            if isinstance(latest, dict):
                current_key = (
                    latest.get("room", {}).get("speaker_key")
                    or latest.get("speaker_key")
                    or None
                )
        except Exception as e:
            print("⚠️ Could not determine current speaker from latest:", e)

        # Fallback to room.json
        if not current_key:
            room_file = SERVICE_ROOT / "room.json"
            if room_file.exists():
                try:
                    room_data = json.loads(room_file.read_text())
                    current_key = room_data.get("speaker_key")
                except Exception:
                    pass

        # Final fallback: use first entry in catalogue
        if not current_key and speakers:
            current_key = speakers[0]["key"]

        # Resolve friendly current speaker
        current = next(
            (s for s in speakers if s["key"] == current_key),
            {"key": current_key or "unknown", "name": "Unknown", "type": "unknown"}
        )

        return jsonify({
            "current": current,
            "list": speakers
        })

    except Exception as e:
        print("❌ ERROR in /api/speakers:", e)
        traceback.print_exc()
        return jsonify({
            "error": str(e),
            "current": {"key": "unknown", "name": "Unknown"},
            "list": []
        }), 500
    
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
    """Return room settings from latest/meta.json, fallback to global room.json."""
    try:
        # 1) Try session-scoped room first
        ses = MEAS_ROOT / "latest"
        meta_file = ses / "meta.json"

        room = {}

        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding='utf-8'))
            room = meta.get("settings", {}).get("room", {}) or {}

        # 2) Fallback to persistent global room.json
        if not room:
            room_file = SERVICE_ROOT / "room.json"
            if room_file.exists():
                room = json.loads(room_file.read_text(encoding='utf-8')) or {}

        # Always return an object (never None)
        return jsonify(room if isinstance(room, dict) else {}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    
@app.route('/api/latest', methods=['GET'])
def api_latest():
    """
    Return the latest session, resolving the real folder name so
    dashboard notes & UI always operate on the correct SweepX folder.
    """
    ses = MEAS_ROOT / "latest"

    if not ses.exists():
        return jsonify({"error": "no latest session"}), 404

    # Load current latest session data
    data = load_session_data(ses)
    if not data:
        return jsonify({"error": "failed to load latest"}), 500

    # 🔥 FIX: Make sure the real ID is returned instead of "latest"
    try:
        real_path = ses.resolve(strict=True)
        data["id"] = real_path.name
        print(f"📌 Resolved latest → {data['id']}")
    except Exception as e:
        print(f"⚠️ Could not resolve real latest path: {e}")

    # --------------------------------------------------
    # 🔥 AI SUMMARY INJECTION (THIS WAS MISSING)
    # --------------------------------------------------
    ai_file = ses / "ai.json"
    if ai_file.exists():
        try:
            with ai_file.open() as f:
                ai = json.load(f)
            data["ai_summary"] = ai.get("summary")
            data["has_summary"] = True
        except Exception as e:
            print("⚠️ Failed to load AI summary:", e)
            data["has_summary"] = False
    else:
        data["has_summary"] = False

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

# ----------------------------------------------------------
#  Serve AI comparison + other latest measurement artifacts
# ----------------------------------------------------------
@app.route("/measurements/latest/<path:filename>")
def serve_latest_measurements(filename):
    return send_from_directory(
        MEAS_ROOT / "latest",
        filename
    )

@app.route("/measurements/<session_id>/<path:filename>")
def serve_session_measurements(session_id, filename):
    session_dir = MEAS_ROOT / session_id
    if not session_dir.exists():
        return jsonify({"error": "session not found"}), 404

    return send_from_directory(session_dir, filename)


# ----------------------------------------------------------
#  SERVE sweephistory.json (REQUIRED FOR DASHBOARD)
# ----------------------------------------------------------
@app.route("/measurements/sweephistory.json", methods=["GET"])
def serve_sweephistory_file():
    path = MEAS_ROOT / "sweephistory.json"

    if not path.exists():
        return jsonify({"error": "sweephistory.json not found"}), 404

    return send_file(path, mimetype="application/json")


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