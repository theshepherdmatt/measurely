#!/usr/bin/env bash
# Measurely installer – clean, predictable, bulletproof

set -euo pipefail

# Colours
GRN='\033[1;32m'; RED='\033[1;31m'; YLW='\033[1;33m'; NC='\033[0m'
msg(){ echo -e "${GRN}[measurely-install]${NC} $*"; }
warn(){ echo -e "${YLW}[measurely-install]${NC} $*"; }
die(){ echo -e "${RED}[measurely-install] $*${NC}" >&2; exit 1;}

# Require sudo
[[ $EUID -eq 0 ]] || die "Please run with sudo"

# Repo directory (where install.sh lives)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine correct user
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  APP_USER="$SUDO_USER"
else
  APP_USER="$(logname 2>/dev/null || echo root)"
fi

APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || die "Could not determine home directory for $APP_USER"

VENV_DIR="$REPO_DIR/venv"

msg "Repo directory     : $REPO_DIR"
msg "Run-as user        : $APP_USER"
msg "Home directory     : $APP_HOME"
msg "Venv location      : $VENV_DIR"

# ------------------------------------------------------------
# 1. Install mandatory OS packages
# ------------------------------------------------------------
msg "Installing OS dependencies…"
apt-get update -qq
apt-get install -y \
    python3-venv python3-pip python3-dev \
    libportaudio2 libasound2-dev libsndfile1 \
    git \
    nodejs npm chromium

# ------------------------------------------------------------
# Allow Measurely to run DHCP client without full root
# ------------------------------------------------------------
msg "Installing minimal sudo rule for DHCP…"

cat >/etc/sudoers.d/measurely-network <<EOF
$APP_USER ALL=(root) NOPASSWD: /sbin/dhclient, /usr/sbin/dhclient
EOF

chmod 440 /etc/sudoers.d/measurely-network

msg "✔ DHCP sudo rule installed."


# ------------------------------------------------------------
# 1.5 Detect Wi-Fi interface (wlan0 / wlan1 / etc)
# ------------------------------------------------------------
msg "Detecting Wi-Fi interface…"

WIFI_IFACE="$(iw dev | awk '$1=="Interface"{print $2; exit}')"

if [[ -z "$WIFI_IFACE" ]]; then
    die "No Wi-Fi interface detected. Is Wi-Fi hardware present?"
fi

msg "✔ Detected Wi-Fi interface: $WIFI_IFACE"

# Persist for runtime use
CONF_FILE="/etc/measurely.conf"
echo "WIFI_IFACE=$WIFI_IFACE" > "$CONF_FILE"
chmod 644 "$CONF_FILE"

msg "✔ Saved Wi-Fi interface to $CONF_FILE"


# ------------------------------------------------------------
# 2. Create venv
# ------------------------------------------------------------
msg "Creating virtualenv…"
sudo -u "$APP_USER" python3 -m venv "$VENV_DIR"

msg "Upgrading pip/setuptools/wheel…"
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet --upgrade pip setuptools wheel

# ------------------------------------------------------------
# 3. Install ALL Python deps from requirements.txt
# ------------------------------------------------------------
if [[ ! -f "$REPO_DIR/requirements.txt" ]]; then
  die "requirements.txt missing — cannot continue"
fi

msg "Installing Python dependencies…"
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet -r "$REPO_DIR/requirements.txt"

# ------------------------------------------------------------
# 3.5 Install Node dependencies for report export
# ------------------------------------------------------------
msg "Installing Node dependencies (report export)…"

cd "$REPO_DIR/web/js"

sudo -u "$APP_USER" npm init -y >/dev/null
sudo -u "$APP_USER" npm install puppeteer --save

# ------------------------------------------------------------
# 4. Install Measurely package (editable)
# ------------------------------------------------------------
msg "Installing Measurely (editable)…"
sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --quiet -e "$REPO_DIR"

# ------------------------------------------------------------
# 5. Write systemd service
# ------------------------------------------------------------
msg "Writing systemd unit…"

cat >/etc/systemd/system/measurely.service <<EOF
[Unit]
Description=Measurely Flask Web Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$REPO_DIR
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$REPO_DIR
Environment=MEASURELY_MEAS_ROOT=$REPO_DIR/measurements
ExecStart=$VENV_DIR/bin/python -m measurelyapp.server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------------------
# 6. Disable any old services
# ------------------------------------------------------------
msg "Cleaning up old services…"
systemctl disable --now measurely-onboard.service 2>/dev/null || true
systemctl disable --now measurely.service 2>/dev/null || true

# ------------------------------------------------------------
# 7. Create 'latest' symlink → bundled starter measurement
# ------------------------------------------------------------
msg "Ensuring 'latest' measurement link exists…"

MEAS_DIR="$REPO_DIR/measurements"
STARTER="Sweep0"

# Ensure starter folder exists
if [[ ! -d "$MEAS_DIR/$STARTER" ]]; then
  die "ERROR: starter measurement folder '$STARTER' not found in $MEAS_DIR"
fi

# Delete ANYTHING called 'latest' (broken symlinks, dirs, files)
if [[ -L "$MEAS_DIR/latest" || -e "$MEAS_DIR/latest" ]]; then
    rm -rf "$MEAS_DIR/latest"
fi

# Recreate fresh symlink
sudo -u "$APP_USER" ln -s "$MEAS_DIR/$STARTER" "$MEAS_DIR/latest"

msg "✔ 'latest' → $STARTER (fresh initialisation)"


# ------------------------------------------------------------
# 7.5. Audio Hardware Setup: HiFiBerry DAC + USB Microphone
# ------------------------------------------------------------

msg "Configuring audio hardware (HiFiBerry DAC + USB microphone)…"

CONFIG="/boot/firmware/config.txt"

# --- Enable I2S (required for HiFiBerry DAC) ---
if ! grep -q "^dtparam=i2s=on" "$CONFIG"; then
    echo "dtparam=i2s=on" | tee -a "$CONFIG" >/dev/null
    msg "  - Enabled I2S"
else
    msg "  - I2S already enabled"
fi

# --- Enable correct HiFiBerry DAC overlay (PCM5102A-based) ---
if ! grep -q "^dtoverlay=hifiberry-dac" "$CONFIG"; then
    echo "dtoverlay=hifiberry-dac" | tee -a "$CONFIG" >/dev/null
    msg "  - Added HiFiBerry DAC overlay (hifiberry-dac)"
else
    msg "  - HiFiBerry DAC overlay already present"
fi

# --- Stabilise ALSA card ordering ---
msg "Writing /etc/asound.conf to stabilise audio card order…"

cat >/etc/asound.conf <<'EOF'
# Force HiFiBerry DAC as default playback (card 0)
defaults.pcm.card 0
defaults.ctl.card 0

# USB microphone alias (usually card 1)
pcm.usb_mic {
    type hw
    card 1
    device 0
}
EOF

msg "  - ALSA device order locked (DAC=card0, USB mic=card1)"
msg "  - ALSA alias 'usb_mic' created for recording"

# --- Detect USB microphone presence ---
USB_MIC_FOUND=$(arecord -l 2>/dev/null | grep -i "USB Audio" || true)

if [[ -n "$USB_MIC_FOUND" ]]; then
    msg "  ✔ USB microphone detected:"
    echo "$USB_MIC_FOUND"
else
    warn "  ⚠ USB microphone NOT detected. Plug it in before running sweeps."
fi

msg "Audio hardware configuration complete. A reboot will activate overlays."

# ------------------------------------------------------------
# 7.6. Samba Setup (file sharing + password)
# ------------------------------------------------------------

msg "Installing and configuring Samba…"

apt-get install -y samba samba-common-bin

# Backup existing config once
if [[ ! -f /etc/samba/smb.conf.backup ]]; then
    cp /etc/samba/smb.conf /etc/samba/smb.conf.backup
fi

msg "Writing Samba configuration…"

cat >/etc/samba/smb.conf <<EOF
[global]
   workgroup = WORKGROUP
   server string = Measurely Pi
   netbios name = MEASURELY
   security = user
   map to guest = Bad User
   dns proxy = no
   client min protocol = NT1

[measurely]
   path = $REPO_DIR
   browseable = yes
   writable = yes
   read only = no
   create mask = 0775
   directory mask = 0775
   valid users = $APP_USER
   force user = $APP_USER
EOF

msg "Adding Samba user '$APP_USER'…"

# Ensure Linux user exists in Samba database
pdbedit -L | grep -q "^$APP_USER:" || smbpasswd -a "$APP_USER"

# Set password silently
(echo "measurely"; echo "measurely") | smbpasswd -s "$APP_USER"

systemctl restart smbd
systemctl restart nmbd

msg "✔ Samba is ready. Connect using:"
msg "   \\\\MEASURELY\\measurely   (Windows)"
msg "   smb://MEASURELY/measurely (Mac)"
msg "   or smb://10.10.10.2/measurely"

# ------------------------------------------------------------
# LED STATUS SERVICE (Raspberry Pi 4/5 compatible)
# ------------------------------------------------------------
msg "Installing GPIO support for Pi 5…"
apt-get install -y python3-rpi-lgpio

LED_SCRIPT="$REPO_DIR/measurelyapp/led_status.py"

if [[ ! -f "$LED_SCRIPT" ]]; then
    die "LED script not found at $LED_SCRIPT"
fi

msg "Making LED script executable…"
chmod +x "$LED_SCRIPT"

msg "Creating initial LED state JSON…"
rm -f /tmp/measurely_status.json
echo "{\"state\":\"boot\"}" | tee /tmp/measurely_status.json >/dev/null || true
chmod 666 /tmp/measurely_status.json

msg "Writing LED systemd service…"

cat >/etc/systemd/system/measurely-led.service <<EOF
[Unit]
Description=Measurely LED Status
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $LED_SCRIPT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

msg "Enabling Measurely LED service…"
systemctl daemon-reload
systemctl enable --now measurely-led.service

msg "✔ LED status service installed and active."


# ------------------------------------------------------------
# Final minimal permissions
# ------------------------------------------------------------
msg "Applying minimal permission fix…"

# Ensure runtime dirs exist
mkdir -p "$REPO_DIR/measurelyapp/room"
mkdir -p "$REPO_DIR/measurelyapp/tmp"
mkdir -p "$REPO_DIR/measurements"

# Make everything in the repo owned by the app user
chown -R "$APP_USER:$APP_USER" "$REPO_DIR"

# Ensure repo files/dirs are readable + writable for the app user
chmod -R u+rwX "$REPO_DIR"

msg "✔ Permissions applied."

# ------------------------------------------------------------
# Optional legacy AP setup (deprecated)
# ------------------------------------------------------------
AP_SCRIPT="$REPO_DIR/measurely-ap.sh"

msg "Checking for legacy AP setup…"

if [[ -f "$AP_SCRIPT" ]]; then
    warn "Legacy AP script detected — this path is deprecated."
    warn "Flask-based onboarding is preferred."

    chmod +x "$AP_SCRIPT"
    install -m 755 "$AP_SCRIPT" /usr/local/sbin/measurely-ap.sh

    cat >/etc/systemd/system/measurely-ap.service <<EOF
[Unit]
Description=Legacy Measurely AP setup (deprecated)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/measurely-ap.sh
ExecStartPost=/bin/systemctl disable measurely-ap.service

[Install]
WantedBy=multi-user.target
EOF

    systemctl enable measurely-ap.service
else
    msg "No legacy AP script present — using web-based onboarding."
fi


# ------------------------------------------------------------
# 8. Start service
# ------------------------------------------------------------
msg "Reloading systemd and starting Measurely…"
systemctl daemon-reload
systemctl enable --now measurely.service

sleep 1

if systemctl -q is-active measurely.service; then
  msg "✔ measurely.service is running."
else
  warn "❌ measurely.service failed — view logs with:"
  warn "   journalctl -u measurely.service -e"
fi

# ------------------------------------------------------------
# 9. Configure eth0 as static 10.10.10.2 and PERMANENTLY stop NM
# ------------------------------------------------------------
msg "Locking eth0 to 10.10.10.2 and disabling NetworkManager control…"

# --- 1. Full NM ignore rules (TWO LAYERS) ---
mkdir -p /etc/NetworkManager/conf.d

cat >/etc/NetworkManager/conf.d/99-eth0-unmanaged.conf <<EOF
[keyfile]
unmanaged-devices=interface-name:eth0
EOF

cat >/etc/NetworkManager/conf.d/99-eth0-device.conf <<EOF
[device]
match-device=interface-name:eth0
managed=false
EOF

# --- 2. Static IP via systemd-networkd (with carrier protection) ---
mkdir -p /etc/systemd/network

cat >/etc/systemd/network/10-eth0-static.network <<EOF
[Match]
Name=eth0

[Network]
Address=10.10.10.2/24
ConfigureWithoutCarrier=yes
EOF

# --- 3. Enable + restart networkd ---
systemctl enable systemd-networkd >/dev/null 2>&1
systemctl restart systemd-networkd >/dev/null 2>&1

# --- 4. Restart NetworkManager (safe now) ---
systemctl restart NetworkManager >/dev/null 2>&1

msg "✔ eth0 is now PERMANENTLY static (10.10.10.2) and NetworkManager-proof."

