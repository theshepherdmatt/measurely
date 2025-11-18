#!/usr/bin/env bash
# Install file for measurely – run on a fresh Raspberry Pi OS (Bookworm+)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="/opt/measurely/venv"
SERVICE_DIR="/opt/measurely"
STATE_FILE="$SERVICE_DIR/onboard/state.json"

# colours
GRN='\033[1;32m'; RED='\033[1;31m'; YLW='\033[1;33m'; NC='\033[0m'

msg(){ echo -e "${GRN}[measurely-install]${NC} $*"; }
warn(){ echo -e "${YLW}[measurely-install]${NC} $*"; }
die(){ echo -e "${RED}[measurely-install] $*${NC}" >&2; exit 1;}

# 0. must be root
[[ $EUID -eq 0 ]] || die "Please run as root (sudo)."

# 1. base deps
msg "Updating system packages…"
apt-get update -qq
apt-get -y full-upgrade

msg "Installing runtime dependencies…"
# system libs first
apt-get -y install libportaudio2 libasound2-dev
# python + tools
apt-get -y install python3-venv python3-dev python3-pip \
     nginx git curl ufw dnsmasq hostapd libsystemd-dev

# 2. service user & directories
msg "Creating service user & directories…"
mkdir -p "$SERVICE_DIR" "$VENV_DIR" /var/log/measurely
useradd -r -s /bin/false measurely 2>/dev/null || true
chown -R measurely:measurely "$SERVICE_DIR" /var/log/measurely

# 3. python venv + project
msg "Creating venv and installing measurely…"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip setuptools wheel
# runtime python deps
"$VENV_DIR/bin/pip" install --quiet flask flask-cors sounddevice gunicorn
# install project (editable so local src is used)
cd "$REPO_DIR"
"$VENV_DIR/bin/pip" install --quiet -e .
# copy static/web folder into service dir so 404 disappears
if [[ -d "$REPO_DIR/web" ]]; then
    rsync -a --delete "$REPO_DIR/web/" "$SERVICE_DIR/web/"
    chown -R measurely:measurely "$SERVICE_DIR/web"
fi
# fix global perms
chown -R measurely:measurely "$SERVICE_DIR"

# 3b. copy buddy-phrase banks
if [[ -d "$REPO_DIR/phrases" ]]; then
    rsync -a --delete "$REPO_DIR/phrases/" "$SERVICE_DIR/phrases/"
    chown -R measurely:measurely "$SERVICE_DIR/phrases"
fi

# 3c. copy speaker catalogue
if [[ -d "$REPO_DIR/speakers" ]]; then
    rsync -a --delete "$REPO_DIR/speakers/" "$SERVICE_DIR/speakers/"
    chown -R measurely:measurely "$SERVICE_DIR/speakers"
fi

# 4. discover correct gunicorn target (fallback to server:app)
msg "Detecting gunicorn target…"
GUNICORN_TARGET="$("$VENV_DIR/bin/python" -c "
import measurely.server as ms, inspect
if inspect.isfunction(getattr(ms, 'create_app', None)):
    print('measurely.server:create_app()')
else:
    print('measurely.server:app')
" 2>/dev/null || echo "measurely.server:app")"
msg "Using $GUNICORN_TARGET"

# 5. systemd units
msg "Installing systemd services…"
cat >/etc/systemd/system/measurely.service <<'EOF'
[Unit]
Description=Measurely web application
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=measurely
Group=measurely
WorkingDirectory=/opt/measurely
ExecStart=/opt/measurely/venv/bin/gunicorn -b 0.0.0.0:8000 --access-logfile - $GUNICORN_TARGET
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/measurely-onboard.service <<'EOF'
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

# 6. onboard portal files (create if missing)
msg "Installing on-boarding portal…"
PORTAL_DIR="$SERVICE_DIR/onboard"
mkdir -p "$PORTAL_DIR"

# -- check-and-run.sh
cat >"$PORTAL_DIR/check-and-run.sh" <<'EOF'
#!/bin/bash
# exit 0 = we have Wi-Fi  -> systemd will skip the service
# exit 1 = no Wi-Fi       -> service starts AP
ip route get 1 2>/dev/null | grep -q wlan0 && exit 0
exit 1
EOF
chmod +x "$PORTAL_DIR/check-and-run.sh"

# -- ap.py  (ASCII-only, Python 3)
cat >"$PORTAL_DIR/ap.py" <<'EOF'
#!/usr/bin/env python3
import subprocess, socket, os, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

AP_IF    = "wlan0"
AP_SSID  = "measurely-setup"
AP_PSK   = "setup1234"
AP_IP    = "192.168.4.1/24"
PORTAL   = 80
CFG_FILE = "/etc/wpa_supplicant/wpa_supplicant-wlan0.conf"
STATE    = "/opt/measurely/onboard/state.json"

def sh(cmd): subprocess.run(cmd, shell=True, check=False)

def start_ap():
    sh(f"systemctl stop wpa_supplicant@{AP_IF}")
    sh(f"ip addr flush dev {AP_IF}")
    sh(f"ip addr add {AP_IP} dev {AP_IF}")
    sh("rfkill unblock wifi")
    with open("/tmp/hostapd.conf","w") as f:
        f.write(f"""interface={AP_IF}
driver=nl80211
ssid={AP_SSID}
wpa=2
wpa_passphrase={AP_PSK}
channel=6""")
    sh("hostapd -B /tmp/hostapd.conf")
    sh("systemctl start dnsmasq")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers()
        self.wfile.write(b"""<!doctype html>
<html>
<head><title>measurely - Wi-Fi setup</title></head>
<body>
<h2>Join your network</h2>
<form method="post">
SSID:<br><input name="s"><br>
Password:<br><input type="password" name="p"><br>
<button>Save & reboot</button>
</form>
</body>
</html>""")

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        data = urllib.parse.parse_qs(body)
        ssid = data.get("s",[""])[0]
        psk  = data.get("p",[""])[0]
        with open(CFG_FILE,"w") as f:
            f.write(f"""country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
network={{
    ssid="{ssid}"
    psk="{psk}"
    key_mgmt=WPA-PSK
}}""")
        self.send_response(200); self.end_headers()
        self.wfile.write(b"Credentials saved - rebooting...")
        subprocess.run("reboot", shell=False)

if __name__ == "__main__":
    if os.path.exists(STATE): exit(0)
    start_ap()
    sh("iptables -t nat -A PREROUTING -p tcp --dport 80 -j DNAT --to-destination 192.168.4.1:80")
    print("Portal listening on 192.168.4.1:80")
    HTTPServer(("0.0.0.0", PORTAL), Handler).serve_forever()
EOF
chmod +x "$PORTAL_DIR/ap.py"

# 7. dnsmasq snippet (kept disabled – ap.py starts it when needed)
msg "Configuring dnsmasq…"
cat >/etc/dnsmasq.d/onboard.conf <<'EOF'
interface=wlan0
dhcp-range=192.168.4.10,192.168.4.50,24h
address=/#/192.168.4.1
EOF
systemctl disable --now dnsmasq   # keep it off until AP is up

# 8. enable & start
msg "Enabling services…"
systemctl daemon-reload
systemctl enable --now measurely-onboard.service measurely.service

# 9. final status
msg "Installation complete."
if systemctl -q is-active measurely-onboard.service measurely.service; then
    echo -e "${GRN}✔${NC}  measurely-onboard.service  $(systemctl is-active measurely-onboard.service)"
    echo -e "${GRN}✔${NC}  measurely.service          $(systemctl is-active measurely.service)"
else
    warn "One or more services failed to start - check logs above."
fi
msg "Reboot whenever you like; onboard AP will appear if no Wi-Fi is configured."