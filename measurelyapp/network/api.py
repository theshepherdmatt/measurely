from flask import Blueprint, request, jsonify
import threading
from . import controller

network_api = Blueprint("network_api", __name__, url_prefix="/api/network")


@network_api.route("/status", methods=["GET"])
def status():
    return jsonify(controller.status())

@network_api.route("/scan", methods=["GET"])
def scan():
    try:
        return jsonify({"ok": True, "networks": controller.scan()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@network_api.route("/connect", methods=["POST"])
def connect():
    data = request.get_json(force=True)
    ssid = data.get("ssid")
    password = data.get("password")

    if not ssid or not password:
        return jsonify({"ok": False, "error": "Missing SSID or password"}), 400

    def worker():
        controller.connect(ssid, password)

    threading.Thread(target=worker, daemon=True).start()

    # IMPORTANT: return immediately
    return jsonify({
        "ok": True,
        "status": "connecting"
    })


@network_api.route("/ap/start", methods=["POST"])
def start_ap():
    controller.start_ap()
    return jsonify({"ok": True})
