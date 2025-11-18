#!/usr/bin/env bash
# Measurely installer (pure, minimal, no folder creation)

set -euo pipefail

# Colours
GRN='\033[1;32m'; RED='\033[1;31m'; YLW='\033[1;33m'; NC='\033[0m'
msg(){ echo -e "${GRN}[measurely-install]${NC} $*"; }
warn(){ echo -e "${YLW}[measurely-install]${NC} $*"; }
die(){ echo -e "${RED}[measurely-install] $*${NC}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."

# Where is the repo?
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Real (non-root) user
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  APP_USER="$SUDO_USER"
else
  APP_USER="$(logname 2>/dev/null || echo root)"
fi

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || die "Could not determine home directory."

VENV_DIR="$REPO_DIR/venv"

msg "Repo directory : $REPO_DIR"
msg "Run-as user    : $APP_USER"
msg "Home directory : $APP_HOME"
msg "Venv location  : $VENV_DIR"

# --------------------------------------------
# OS dependencies
# --------------------------------------------
msg "Installing OS dependencies…"
apt-get update -qq
apt-get install -y python3-venv python3-pip python3-dev \
                   libportaudio2 libasound2-dev \
                   git

# --------------------------------------------
# Virtualenv
# --------------------------------------------
msg "Creating virtualenv…"
sudo -u "$APP_USER" python3 -m venv "$VENV_DIR"

msg "Upgrading pip/setuptools…"
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet --upgrade pip setuptools wheel

# --------------------------------------------
# Python packages
# --------------------------------------------
if [[ -f "$REPO_DIR/requirements.txt" ]]; then
  msg "Installing Python requirements…"
  sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet -r "$REPO_DIR/requirements.txt"
else
  msg "Installing base Python deps…"
  sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet flask flask-cors sounddevice numpy scipy matplotlib
fi

# --------------------------------------------
# Editable install
# --------------------------------------------
msg "Installing Measurely (editable)…"
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet -e "$REPO_DIR"

# --------------------------------------------
# Systemd service
# --------------------------------------------
msg "Writing systemd unit…"

cat >/etc/systemd/system/measurely.service <<EOF
[Unit]
Description=Measurely Flask Web Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$REPO_DIR
Environment=MEASURELY_MEAS_ROOT=$REPO_DIR/measurements
ExecStart=$VENV_DIR/bin/python -m measurely.server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# --------------------------------------------
# Clean old services
# --------------------------------------------
msg "Cleaning old Measurely services…"
systemctl disable --now measurely-onboard.service 2>/dev/null || true
systemctl disable --now measurely.service 2>/dev/null || true
systemctl disable --now nginx 2>/dev/null || true

# --------------------------------------------
# Start new service
# --------------------------------------------
msg "Starting Measurely…"
systemctl daemon-reload
systemctl enable --now measurely.service

sleep 1
if systemctl -q is-active measurely.service; then
  msg "✔ measurely.service is active."
else
  warn "measurely.service failed — check logs with:"
  warn "    journalctl -u measurely.service -e"
fi

msg "Done. Visit: http://<pi-ip>:5000/"
