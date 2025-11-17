#!/usr/bin/env bash
# Install file for measurely – run on a fresh Raspberry Pi OS (Bookworm)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="/opt/measurely/venv"
SERVICE_DIR="/opt/measurely"

# colours
GRN='\033[1;32m'; RED='\033[1;31m'; NC='\033[0m'

msg(){ echo -e "${GRN}[measurely-install]${NC} $*"; }
die(){ echo -e "${RED}[measurely-install] $*${NC}" >&2; exit 1;}

# 1. base deps
msg "Updating system packages…"
sudo apt update
sudo apt -y full-upgrade

msg "Installing runtime dependencies…"
sudo apt -y install python3-venv python3-dev python3-pip \
     nginx git curl ufw dnsmasq hostapd libsystemd-dev

# 2. create service user & directories
sudo mkdir -p "$SERVICE_DIR" "$VENV_DIR" /var/log/measurely
sudo useradd -r -s /bin/false measurely || true
sudo chown -R measurely:measurely "$SERVICE_DIR" /var/log/measurely

# 3. python venv + project
msg "Creating venv and installing measurely…"
sudo python3 -m venv "$VENV_DIR"
sudo -u measurely "$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel
sudo -u measurely "$VENV_DIR/bin/pip" install -e "$REPO_DIR"

# 4. systemd units
msg "Installing systemd services…"
sudo tee /etc/systemd/system/measurely.service >/dev/null <<'EOF'
[Unit]
Description=Measurely web application
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=measurely
Group=measurely
WorkingDirectory=/opt/measurely
ExecStart=/opt/measurely/venv/bin/gunicorn -b 0.0.0.0:8000 --access-logfile - "measurely:create_app()"
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/measurely-onboard.service >/dev/null <<'EOF'
[Unit]
Description=Measurely Wi-Fi on-boarding AP
After=network-pre.target
Before=measurely.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/opt/measurely/onboard/check-and-run.sh
ExecStart=/opt/measurely/venv/bin/python /opt/measurely/onboard/ap.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 5. onboard portal bits
msg "Installing on-boarding portal…"
sudo -u measurely mkdir -p "$SERVICE_DIR/onboard"
sudo cp "$REPO_DIR/onboard/"*.py "$REPO_DIR/onboard/check-and-run.sh" "$SERVICE_DIR/onboard/"
sudo chmod +x "$SERVICE_DIR/onboard/check-and-run.sh"

# 6. dnsmasq snippet (disabled by default – ap.py starts it when needed)
sudo tee /etc/dnsmasq.d/onboard.conf >/dev/null <<'EOF'
interface=wlan0
dhcp-range=192.168.4.10,192.168.4.50,24h
address=/#/192.168.4.1
EOF
sudo systemctl disable --now dnsmasq   # keep it off until AP is up

# 7. enable & start
sudo systemctl daemon-reload
sudo systemctl enable measurely-onboard.service measurely.service

msg "Starting services…"
sudo systemctl start measurely-onboard.service
sudo systemctl start measurely.service

# 8. show status
msg "Installation complete.  Service status:"
systemctl is-active measurely-onboard.service measurely.service
msg "Done – reboot whenever you like."
