#!/usr/bin/env python3
from flask import Flask, send_from_directory, abort, request
import os

WEB_DIR = "/home/matt/measurely/web"

app = Flask(__name__, static_folder=WEB_DIR)

print(f"[BOOT] Measurely Connect starting…")
print(f"[BOOT] Serving from: {WEB_DIR}")
print(f"[BOOT] Listening on http://192.168.4.1:80")

# ---------------------------------------------------
# ROOT → index.html
# ---------------------------------------------------
@app.route("/")
def index():
    print(f"[REQ] GET /  -> index.html")
    return send_from_directory(WEB_DIR, "index.html")

# ---------------------------------------------------
# STATIC FILES ONLY
# ---------------------------------------------------
@app.route("/<path:filename>")
def serve_static(filename):
    full_path = os.path.join(WEB_DIR, filename)
    print(f"[REQ] GET /{filename}")

    if os.path.isfile(full_path):
        print(f"[SERVE] OK -> {full_path}")
        return send_from_directory(WEB_DIR, filename)

    print(f"[404] NOT FOUND -> {full_path}")
    return abort(404)

# ---------------------------------------------------
# Captive portal pages
# ---------------------------------------------------
@app.route("/generate_204")
@app.route("/hotspot-detect.html")
@app.route("/success.txt")
@app.route("/ncsi.txt")
def captive():
    print(f"[CAPTIVE] {request.path} -> OK")
    return "OK", 200

# ---------------------------------------------------
# Run the AP web server
# ---------------------------------------------------
if __name__ == "__main__":
    print("[START] Flask AP server is now running.")
    app.run(host="192.168.4.1", port=80)
