#!/usr/bin/env python3
import sys, json, subprocess, threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, abort
import sounddevice as sd

# -------------------------------------------------------------------
# Paths
# -------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent   # repo root
WEB_DIR      = PROJECT_ROOT / "web"                     # serves index.html + assets
MEAS_ROOT    = Path.home() / "Measurely" / "measurements"
MEAS_ROOT.mkdir(parents=True, exist_ok=True)

CFG_PATH = Path.home() / ".measurely" / "config.json"
CFG_PATH.parent.mkdir(parents=True, exist_ok=True)

NMCLI_BIN = "/usr/bin/nmcli"
HOTSPOT_HELPER = "/usr/local/bin/measurely-hotspot.sh"

# -------------------------------------------------------------------
# Device detection
# -------------------------------------------------------------------
def detect_devices():
    mic_idx = mic_name = None
    dac_idx = dac_name = None
    alsa_str = None

    # --- Probe PortAudio (sounddevice) ---
    try:
        sd_devs = sd.query_devices()
    except Exception:
        sd_devs = []

    # Pick microphone (prefer UMIK), must have input channels
    for i, d in enumerate(sd_devs):
        try:
            if int(d.get("max_input_channels", 0)) > 0:
                name = (d.get("name") or "")
                if mic_idx is None:
                    mic_idx, mic_name = i, name
                if "umik" in name.lower():
                    mic_idx, mic_name = i, name
                    break
        except Exception:
            pass

    # We'll only accept DAC candidates with output channels
    def sd_output_candidates():
        out = []
        for i, d in enumerate(sd_devs):
            try:
                if int(d.get("max_output_channels", 0)) > 0:
                    out.append((i, d.get("name") or ""))
            except Exception:
                pass
        return out

    # --- Probe ALSA (authoritative for aplay backend) ---
    PREFERRED = ("hifiberry","snd_rpi_hifiberry","pcm510","pcm512","i2s","dac","usb audio","audioinjector","spdif","hdmi","wolfson")

    alsa_candidates = []
    try:
        out = subprocess.check_output(["aplay", "-l"], text=True, stderr=subprocess.STDOUT)
        for ln in out.splitlines():
            if "card " in ln and "device " in ln:
                parts = ln.strip().split()
                card = dev = None
                for j, p in enumerate(parts):
                    if p == "card" and j + 1 < len(parts):
                        try: card = int(parts[j+1].rstrip(":"))
                        except: pass
                    if p == "device" and j + 1 < len(parts):
                        try: dev = int(parts[j+1].rstrip(":"))
                        except: pass
                if card is not None and dev is not None:
                    alsa_candidates.append({"alsa": f"hw:{card},{dev}", "line": ln})
        # Prefer HiFiBerry/PCM/USB-ish
        def score(c):
            n = c["line"].lower()
            return 0 if any(k in n for k in PREFERRED) else 1
        alsa_candidates.sort(key=score)
        if alsa_candidates:
            alsa_str = alsa_candidates[0]["alsa"]
            # Use a readable name from the line
            dac_name = alsa_candidates[0]["line"]
    except Exception:
        pass

    # If PortAudio is available, try to map a sensible output index (purely for display)
    if dac_idx is None:
        outs = sd_output_candidates()
        # Prefer names that look like our ALSA choice or known DAC keywords
        if outs:
            # match by keyword
            pick = None
            for i, nm in outs:
                low = nm.lower()
                if any(k in low for k in PREFERRED):
                    pick = (i, nm); break
            # otherwise first output device
            if pick is None:
                pick = outs[0]
            dac_idx, _nm = pick
            # Only override dac_name with PortAudio name if we didn't get one from ALSA
            if not dac_name:
                dac_name = _nm

    # Fallback ALSA string if nothing parsed (shouldn’t happen often)
    if alsa_str is None:
        alsa_str = "hw:0,0"  # safer default on your box than hw:2,0

    return {
        "mic": {"connected": mic_idx is not None, "index": mic_idx, "name": mic_name or ""},
        "dac": {"connected": (alsa_str is not None), "index": dac_idx, "name": dac_name or "", "alsa": alsa_str}
    }

# -------------------------------------------------------------------
# Config
# -------------------------------------------------------------------
def read_config():
    if CFG_PATH.exists():
        try:
            return json.loads(CFG_PATH.read_text())
        except Exception:
            return {}
    return {}

def write_config(cfg: dict):
    CFG_PATH.write_text(json.dumps(cfg, indent=2))

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def run_nmcli(args):
    proc = subprocess.run(["sudo", NMCLI_BIN, *args], text=True, capture_output=True)
    return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()

# NEW: session helpers ------------------------------------------------
def _session_dir_from_id(sid: str) -> Path:
    p = MEAS_ROOT / sid
    if not p.is_dir():
        abort(404, f"Session not found: {sid}")
    return p

def _latest_session_dir() -> Path | None:
    if not MEAS_ROOT.exists():
        return None
    dirs = [p for p in MEAS_ROOT.iterdir() if p.is_dir() and (p/"analysis.json").exists()]
    if not dirs:
        return None
    dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return dirs[0]

def _load_analysis_for(sid: str | None):
    d = _session_dir_from_id(sid) if sid else _latest_session_dir()
    if not d:
        return None, None
    jfile = d / "analysis.json"
    if not jfile.exists():
        return d.name, None
    try:
        return d.name, json.loads(jfile.read_text(encoding="utf-8"))
    except Exception:
        return d.name, None

# -------------------------------------------------------------------
# Flask app
# -------------------------------------------------------------------
def create_app():
    app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")

    # Index route
    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    # ----- Measurement helper -----
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

        proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), text=True, capture_output=True)
        out = (proc.stdout or "") + (("\n[stderr]\n" + (proc.stderr or "")) if proc.stderr else "")
        saved_dir = None
        for ln in (proc.stdout or "").splitlines():
            if ln.startswith("Saved:"):
                saved_dir = ln.split("Saved:", 1)[1].strip()
                break
        return out, saved_dir, proc.returncode

    def session_dir_from_id(sid: str) -> Path:
        return _session_dir_from_id(sid)

    def list_sessions():
        if not MEAS_ROOT.exists():
            return []
        dirs = [p for p in MEAS_ROOT.iterdir() if p.is_dir()]
        dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
        items = []
        for p in dirs:
            summary = p / "summary.txt"
            analysis = p / "analysis.json"
            items.append({
                "id": p.name,
                "path": str(p),
                "has_summary": summary.exists(),
                "has_analysis": analysis.exists()
            })
        return items

    # -------------------------------------------------------------------
    # API routes
    # -------------------------------------------------------------------
    @app.get("/api/status")
    def api_status():
        return jsonify(detect_devices())

    @app.get("/api/settings")
    def api_get_settings():
        return jsonify(read_config())

    @app.post("/api/settings")
    def api_post_settings():
        cfg = read_config()
        body = request.get_json(silent=True) or {}
        if "room" in body:
            cfg["room"] = body["room"]
        write_config(cfg)
        return jsonify({"ok": True, "saved": cfg})

    @app.get("/api/sessions")
    def api_sessions():
        return jsonify(list_sessions())

    @app.get("/api/session/<sid>")
    def api_session(sid):
        d = session_dir_from_id(sid)
        resp = {"id": sid, "path": str(d)}
        sfile = d / "summary.txt"
        jfile = d / "analysis.json"
        if sfile.exists():
            resp["summary"] = sfile.read_text(errors="ignore")
        if jfile.exists():
            try:
                resp["analysis"] = json.loads(jfile.read_text())
            except Exception:
                pass
        arts = sorted([f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() == ".png"])
        if arts:
            resp["artifacts"] = arts
        return jsonify(resp)

    @app.get("/api/session/<sid>/artifact/<path:fname>")
    def api_artifact(sid, fname):
        d = session_dir_from_id(sid)
        f = d / fname
        if not f.exists() or not f.is_file():
            abort(404)
        return send_from_directory(d, fname)

    @app.post("/api/run-sweep")
    def api_run():
        params = request.get_json(force=True, silent=True) or {}
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

        sid = None
        if saved_dir:
            try:
                sid = Path(saved_dir).name
                session_dir = Path(saved_dir)
                if not session_dir.exists():
                    session_dir = MEAS_ROOT / sid
                meta = {"settings": read_config()}
                (session_dir / "meta.json").write_text(json.dumps(meta, indent=2))
            except Exception:
                pass

        resp = {"ok": rc == 0, "returncode": rc, "stdout": out}
        if sid:
            resp.update({"saved_dir": saved_dir, "session_id": sid})
            sfile = MEAS_ROOT / sid / "summary.txt"
            if sfile.exists():
                resp["summary"] = sfile.read_text(errors="ignore")
        return jsonify(resp), (200 if rc == 0 else 500)

    # ---------------- Simple + Geek endpoints (NEW) -------------------
    @app.get("/api/simple")
    def api_simple():
        """
        Returns the compact 'Simple' payload for the latest session, or a given sid:
        GET /api/simple            -> latest
        GET /api/simple?sid=XYZ    -> specific session
        """
        sid = request.args.get("sid")
        sid, data = _load_analysis_for(sid)
        if data is None:
            return jsonify({"ok": False, "error": "No analysis.json found", "sid": sid}), 404

        # Prefer analyser-generated simple_view. Provide a safe fallback if missing.
        simple = data.get("simple_view")
        if not simple:
            scores = data.get("scores", {}) or {}
            overall = scores.get("overall")
            # Minimal headline logic
            if overall is None:
                headline = "Room status unavailable."
            elif overall >= 9.0:
                headline = "Excellent — leave it be!"
            elif overall >= 7.5:
                headline = "Strong result."
            elif overall >= 6.0:
                headline = "Decent — a few tweaks will help."
            elif overall >= 4.0:
                headline = "Sounds a bit echoey."
            else:
                headline = "Room needs attention."
            sections = {k: {"score": scores.get(k), "status": "unknown"}
                        for k in ("bandwidth","balance","peaks_dips","smoothness","reflections","reverb")}
            top_actions = data.get("simple_fixes") or []
            # Convert simple_fixes (list of strings) into [{section:'advice',...}] shape lightly
            top_actions = [{"section": "advice", "score": None, "advice": s} for s in top_actions[:3]]
            simple = {"overall": overall, "headline": headline, "sections": sections, "top_actions": top_actions}

        return jsonify({"ok": True, "sid": sid, **simple})

    @app.get("/api/geek")
    def api_geek():
        """
        Returns the full analysis.json for the latest session, or a given sid:
        GET /api/geek            -> latest
        GET /api/geek?sid=XYZ    -> specific session
        """
        sid = request.args.get("sid")
        sid, data = _load_analysis_for(sid)
        if data is None:
            return jsonify({"ok": False, "error": "No analysis.json found", "sid": sid}), 404
        return jsonify({"ok": True, "sid": sid, "analysis": data})

    # -------------------------------------------------------------------
    # Captive portal + Wi-Fi onboarding
    # -------------------------------------------------------------------
    @app.get("/hotspot-detect.html")
    def apple_captive():
        return "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>", 200, {"Content-Type": "text/html"}

    @app.get("/generate_204")
    def android_captive():
        return "", 204

    @app.get("/ncsi.txt")
    def windows_captive():
        return "Microsoft NCSI", 200, {"Content-Type": "text/plain"}

    @app.get("/api/wifi/scan")
    def wifi_scan():
        try:
            run_nmcli(["dev", "wifi", "rescan"])
            rc, out, err = run_nmcli(["-t", "-f", "SSID,SECURITY,SIGNAL,CHAN", "dev", "wifi", "list"])
            if rc != 0:
                return jsonify({"ok": False, "error": err or out or f"nmcli rc={rc}"}), 500

            nets, seen = [], set()
            for ln in out.splitlines():
                ssid, sec, sig, chan = (ln.split(":", 3) + ["", "", "", ""])[:4]
                key = (ssid, chan)
                if not ssid or key in seen:
                    continue
                seen.add(key)
                try:
                    sig_i = int(sig or 0)
                except Exception:
                    sig_i = 0
                nets.append({"ssid": ssid, "security": sec or "OPEN", "signal": sig_i, "channel": chan})
            nets.sort(key=lambda x: x["signal"], reverse=True)
            return jsonify({"ok": True, "networks": nets})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    @app.post("/api/wifi/connect")
    def wifi_connect():
        body = request.get_json(force=True, silent=True) or {}
        ssid = (body.get("ssid") or "").strip()
        psk  = body.get("psk") or ""
        if not ssid:
            return jsonify({"ok": False, "error": "Missing ssid"}), 400

        con_name = f"Measurely-{ssid}"
        try:
            run_nmcli(["con", "delete", con_name])  # clean prior

            add_args = ["con", "add", "type", "wifi", "ifname", "*",
                        "con-name", con_name, "ssid", ssid,
                        "connection.autoconnect", "yes"]
            if psk:
                add_args += ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", psk]
            else:
                add_args += ["wifi-sec.key-mgmt", "none"]

            rc, out, err = run_nmcli(add_args)
            if rc != 0:
                return jsonify({"ok": False, "error": err or out or f"nmcli add rc={rc}"}), 500

            # Respond immediately
            def switch_to_wifi():
                run_nmcli(["con", "up", con_name])
                subprocess.run([HOTSPOT_HELPER, "stop"], check=False)

            threading.Thread(target=switch_to_wifi, daemon=True).start()
            return jsonify({"ok": True, "connected": ssid, "note": "Switching to Wi-Fi..."})

        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    @app.get("/api/wifi/status")
    def wifi_status():
        try:
            rc, out, err = run_nmcli(["-t", "-f", "NAME,TYPE,DEVICE", "con", "show", "--active"])
            active = (out or "").splitlines() if rc == 0 else []

            hotspot_active = any(
                ln.split(":")[0] == "Measurely-Hotspot" and ln.split(":")[-1] == "wlan0"
                for ln in active if ":" in ln
            )

            con_name = None
            for ln in active:
                try:
                    name, typ, dev = ln.split(":")
                    if dev == "wlan0" and typ == "wifi":
                        con_name = name
                        break
                except ValueError:
                    pass

            rc, ip_out, _ = run_nmcli(["-t", "-f", "IP4.ADDRESS", "dev", "show", "wlan0"])
            ip4 = None
            if rc == 0:
                for line in (ip_out or "").splitlines():
                    if ":" in line:
                        ip4 = line.split(":", 1)[1].split("/", 1)[0].strip()
                        if ip4:
                            break

            ssid = None
            if con_name:
                rc, ssid_out, _ = run_nmcli(["-t", "-f", "802-11-wireless.ssid", "con", "show", con_name])
                if rc == 0 and ssid_out:
                    ssid = ssid_out.split(":", 1)[-1].strip() or None
                if not ssid and con_name.startswith("Measurely-"):
                    ssid = con_name[len("Measurely-"):]

            if hotspot_active:
                mode = "ap"
            elif con_name and ip4:
                mode = "station"
            else:
                mode = "down"

            return jsonify({
                "ok": True,
                "mode": mode,
                "ssid": ssid,
                "connection": con_name,
                "ip4": ip4,
                "hotspot_active": hotspot_active,
                "hostname": "measurely.local"
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    @app.post("/api/hotspot/stop")
    def hotspot_stop():
        try:
            subprocess.check_call([HOTSPOT_HELPER, "stop"])
            return jsonify({"ok": True})
        except subprocess.CalledProcessError as e:
            return jsonify({"ok": False, "error": f"stop failed: {e}"}), 500
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    return app

# -------------------------------------------------------------------
# Entrypoint
# -------------------------------------------------------------------
def main():
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=False)

if __name__ == "__main__":
    main()
