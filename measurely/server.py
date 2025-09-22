#!/usr/bin/env python3
import sys, json, subprocess, os
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file, abort
import sounddevice as sd

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # repo root
MEAS_ROOT = Path.home() / "Measurely" / "measurements"

# ------------------ Device detection ------------------
def detect_devices():
    """Return dict with mic + dac connection info and ALSA string."""
    mic_idx = mic_name = dac_idx = dac_name = None
    alsa_str = "hw:2,0"  # sensible default

    try:
        devs = sd.query_devices()
    except Exception:
        devs = []

    # Mic: prefer 'umik', else first input with channels > 0
    for i, d in enumerate(devs):
        if int(d.get("max_input_channels", 0)) > 0:
            if mic_idx is None:
                mic_idx, mic_name = i, d.get("name", "")
            if "umik" in (d.get("name", "")).lower():
                mic_idx, mic_name = i, d.get("name", "")
                break

    # DAC: prefer hifiberry, else first output with channels > 0
    for i, d in enumerate(devs):
        if int(d.get("max_output_channels", 0)) > 0:
            if dac_idx is None:
                dac_idx, dac_name = i, d.get("name", "")
            if any(k in d.get("name", "").lower()
                   for k in ("hifiberry", "snd_rpi_hifiberry", "pcm510", "pcm512", "i2s", "dac")):
                dac_idx, dac_name = i, d.get("name", "")
                break

    # Optional: refine ALSA hw:X,Y from aplay -l
    try:
        out = subprocess.check_output(["aplay", "-l"], text=True, stderr=subprocess.STDOUT)
        for ln in out.splitlines():
            if "hifiberry" in ln.lower():
                parts = ln.split()
                card = dev = None
                for j, p in enumerate(parts):
                    if p == "card" and j + 1 < len(parts):
                        try: card = int(parts[j+1].rstrip(":"))
                        except: pass
                    if p == "device" and j + 1 < len(parts):
                        try: dev = int(parts[j+1].rstrip(":"))
                        except: pass
                if card is not None and dev is not None:
                    alsa_str = f"hw:{card},{dev}"
                    break
    except Exception:
        pass

    return {
        "mic": {"connected": mic_idx is not None, "index": mic_idx, "name": mic_name or ""},
        "dac": {"connected": dac_idx is not None, "index": dac_idx, "name": dac_name or "", "alsa": alsa_str}
    }

# ------------------ Flask app ------------------
def create_app():
    app = Flask(__name__)

    def run_orchestrator(params):
        cmd = [
            sys.executable, "-m", "measurely.main",
            "--backend", params.get("backend", "aplay"),
            "--prepad", str(params.get("prepad", 0.5)),
            "--postpad", str(params.get("postpad", 1.0)),
            "--fs", str(params.get("fs", 48000)),
            "--dur", str(params.get("dur", 8.0)),
        ]
        if params.get("in_dev") is not None:
            cmd += ["--in", str(params["in_dev"])]
        if params.get("out_dev") is not None:
            cmd += ["--out", str(params["out_dev"])]
        if params.get("backend", "aplay") == "aplay":
            cmd += ["--alsa-device", params.get("alsa_device", "hw:2,0")]

        proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT),
                              text=True, capture_output=True)
        out = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if proc.stderr else "")
        saved_dir = None
        for ln in (proc.stdout or "").splitlines():
            if ln.startswith("Saved:"):
                saved_dir = ln.split("Saved:", 1)[1].strip()
                break
        return out, saved_dir, proc.returncode

    def session_dir_from_id(sid: str) -> Path:
        p = MEAS_ROOT / sid
        if not p.is_dir(): abort(404, f"Session not found: {sid}")
        return p

    def list_sessions():
        if not MEAS_ROOT.exists():
            return []
        items = []
        for p in sorted(MEAS_ROOT.iterdir(), key=lambda x: x.name, reverse=True):
            if not p.is_dir(): continue
            summary = p / "summary.txt"
            analysis = p / "analysis.json"
            items.append({
                "id": p.name,
                "path": str(p),
                "has_summary": summary.exists(),
                "has_analysis": analysis.exists()
            })
        return items

    # ---------- Routes ----------
    @app.get("/")
    def index():
        return send_file(PROJECT_ROOT / "web" / "index.html")

    @app.get("/api/status")
    def api_status():
        return jsonify(detect_devices())

    @app.get("/api/sessions")
    def api_sessions():
        return jsonify(list_sessions())

    @app.get("/api/session/<sid>")
    def api_session(sid):
        d = session_dir_from_id(sid)
        resp = {"id": sid, "path": str(d)}
        sfile = d / "summary.txt"
        jfile = d / "analysis.json"
        if sfile.exists(): resp["summary"] = sfile.read_text()
        if jfile.exists(): resp["analysis"] = json.loads(jfile.read_text())
        arts = []
        for a in ("response.png","impulse_response.png","response.csv","mic_recording_used.wav","impulse.wav"):
            if (d / a).exists(): arts.append(a)
        if arts: resp["artifacts"] = arts
        return jsonify(resp)

    @app.get("/api/session/<sid>/artifact/<path:fname>")
    def api_artifact(sid, fname):
        d = session_dir_from_id(sid)
        f = d / fname
        if not f.exists() or not f.is_file(): abort(404)
        return send_from_directory(d, fname)

    @app.post("/api/run-sweep")
    def api_run():
        params = request.get_json(force=True, silent=True) or {}
        # If user didn’t pass devices, fill in from detection
        status = detect_devices()
        params.setdefault("in_dev", status["mic"]["index"])
        params.setdefault("out_dev", status["dac"]["index"])
        params.setdefault("backend", "aplay")
        params.setdefault("alsa_device", status["dac"]["alsa"])
        params.setdefault("fs", 48000)
        params.setdefault("dur", 8.0)
        params.setdefault("prepad", 0.5)
        params.setdefault("postpad", 1.0)

        out, saved_dir, rc = run_orchestrator(params)
        resp = {"ok": rc == 0, "returncode": rc, "stdout": out}
        if saved_dir:
            sid = Path(saved_dir).name
            resp.update({"saved_dir": saved_dir, "session_id": sid})
            sfile = Path(saved_dir) / "summary.txt"
            if sfile.exists(): resp["summary"] = sfile.read_text()
        return jsonify(resp), (200 if rc == 0 else 500)

    return app

# ------------------ Entrypoint ------------------
def main():
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=False)

if __name__ == "__main__":
    main()
