#!/bin/bash
set -euo pipefail

echo ">>> Measurely installer starting..."

# -----------------------------
# System dependencies
# -----------------------------
sudo apt update
sudo apt install -y \
  python3 python3-venv python3-pip \
  git build-essential \
  portaudio19-dev \
  libatlas-base-dev \
  alsa-utils \
  ffmpeg

# -----------------------------
# Paths
# -----------------------------
INSTALL_DIR="$HOME/Measurely"
CFG_DIR="$HOME/.config/measurely"
BIN_DIR="$INSTALL_DIR/bin"
SERVICE_NAME="measurely@${USER}.service"
UNIT_PATH="/etc/systemd/system/measurely@.service"

mkdir -p "$INSTALL_DIR" "$CFG_DIR" "$BIN_DIR"

# -----------------------------
# Copy project into install dir
# -----------------------------
echo "Copying Measurely files to $INSTALL_DIR ..."
rsync -a --delete --exclude ".venv" --exclude ".git" ./ "$INSTALL_DIR"/

# -----------------------------
# Python venv + deps
# -----------------------------
cd "$INSTALL_DIR"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip wheel
# Install your requirements + waitress for serving Flask
pip install -r requirements.txt waitress

# -----------------------------
# Launcher script
# -----------------------------
cat > "$BIN_DIR/measurely-serve" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/.venv/bin/activate"

# Host/port defaults (overridable via env file)
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8080}"

# We’ll run a tiny Python loader that:
# 1) tries to import create_app() from common module paths
# 2) falls back to finding a global "app"
# 3) serves via waitress
python - "$HOST" "$PORT" <<'PY'
import importlib, os, sys
from waitress import serve

host = sys.argv[1]
port = int(sys.argv[2])

candidates = [
    ("measurely.web", "create_app"),
    ("measurely.webapp", "create_app"),
    ("measurely.server", "create_app"),
    ("measurely.api", "create_app"),
]

app = None

# Try factory pattern first
for modname, factory in candidates:
    try:
        mod = importlib.import_module(modname)
        if hasattr(mod, factory):
            app = getattr(mod, factory)()
            print(f"[measurely] Loaded Flask app via {modname}:{factory}()")
            break
    except Exception as e:
        pass

# Try to find a global "app" in common modules
if app is None:
    for modname in ["measurely.web", "measurely.webapp", "measurely.server", "app"]:
        try:
            mod = importlib.import_module(modname)
            if hasattr(mod, "app"):
                app = getattr(mod, "app")
                print(f"[measurely] Loaded Flask app via {modname}:app")
                break
        except Exception:
            pass

if app is None:
    sys.stderr.write(
        "[measurely] Could not locate a Flask app. "
        "Expected create_app() or app in measurely.web/measurely.webapp/etc.\n"
    )
    sys.exit(1)

serve(app, host=host, port=port, threads=4)
PY
EOF
chmod +x "$BIN_DIR/measurely-serve"

# -----------------------------
# Optional env file
# -----------------------------
if [ ! -f "$CFG_DIR/env" ]; then
  cat > "$CFG_DIR/env" <<'EOF'
# Measurely environment overrides
HOST=0.0.0.0
PORT=8080
# Add any project-specific env like:
# MEASURELY_DATA_DIR=/home/youruser/Measurely/measurements
EOF
fi

# -----------------------------
# systemd unit (templated)
# -----------------------------
sudo tee "$UNIT_PATH" >/dev/null <<'EOF'
[Unit]
Description=Measurely Web Service (instance: %i)
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=/home/%i/Measurely
EnvironmentFile=-/home/%i/.config/measurely/env
ExecStart=/home/%i/Measurely/bin/measurely-serve
Restart=on-failure
RestartSec=3
# Give ALSA/PortAudio devices a moment after boot
StartLimitBurst=5
StartLimitIntervalSec=30

[Install]
WantedBy=multi-user.target
EOF

# -----------------------------
# Enable + start service
# -----------------------------
echo "Enabling service: $SERVICE_NAME"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ">>> Done!"
echo "Service status:"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "--------- Usage ---------"
echo "Stop service:   sudo systemctl stop $SERVICE_NAME"
echo "Start service:  sudo systemctl start $SERVICE_NAME"
echo "Logs:           journalctl -u $SERVICE_NAME -f"
echo "Change port:    edit ~/.config/measurely/env then:"
echo "                sudo systemctl restart $SERVICE_NAME"
echo "App should be on: http://<pi-ip>:8080/"

