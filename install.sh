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
    git

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
msg "Linking 'latest' to bundled starter measurement…"

MEAS_DIR="$REPO_DIR/measurements"
STARTER="20250112_213044_ab12cd"

# Ensure folder exists
if [[ ! -d "$MEAS_DIR/$STARTER" ]]; then
  die "ERROR: starter measurement folder '$STARTER' not found in $MEAS_DIR"
fi

# Force create (or replace) symlink
sudo -u "$APP_USER" ln -sfn "$MEAS_DIR/$STARTER" "$MEAS_DIR/latest"

msg "✔ latest → $STARTER"

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

# Install samba if not installed
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
   security = user
   map to guest = Bad User
   dns proxy = no

[measurely]
   path = $REPO_DIR
   browseable = yes
   writable = yes
   create mask = 0775
   directory mask = 0775
   valid users = $APP_USER
   force user = $APP_USER
EOF

msg "Setting Samba password for user '$APP_USER'…"

# We set the Samba password to match the current system password.
# Samba does not allow non-interactive password entry without piping.
echo -e "$APP_USER\n$APP_USER" >/tmp/smbpass.$$  # placeholder, real pass is set below

# Ask user for password if sudoer wants a custom one:
read -rsp "Enter password for Samba user '$APP_USER': " SMBPASS
echo
read -rsp "Confirm password: " SMBPASS2
echo

if [[ "$SMBPASS" != "$SMBPASS2" ]]; then
    die "Samba passwords do not match. Aborting."
fi

# Create the Samba user (or reset password)
(echo "$SMBPASS"; echo "$SMBPASS") | smbpasswd -a "$APP_USER" >/dev/null

rm -f /tmp/smbpass.$$

msg "  ✔ Samba user password set."

systemctl restart smbd
systemctl restart nmbd

msg "✔ Samba setup complete. You can now access the Pi at:"
msg "   \\\\measurely-pi\\measurely"

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
# 9. Access Point Setup (hostapd + dnsmasq + unmanaged wlan0)
# ------------------------------------------------------------
msg "Setting up Measurely Access Point (offline mode)…"

# ---- Install packages ----
msg "Installing hostapd + dnsmasq…"

apt-get install -y hostapd dnsmasq

# Ensure services do not auto-start until configured
systemctl stop hostapd 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable hostapd 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true

# ---- STATIC IP CONFIGURATION ----
msg "Configuring static IP for wlan0…"

DHCPCD_CONF="/etc/dhcpcd.conf"

if ! grep -q "measurely-ap" "$DHCPCD_CONF"; then
cat >>"$DHCPCD_CONF" <<EOF

# measurely-ap
interface wlan0
    static ip_address=192.168.4.1/24
    nohook wpa_supplicant
EOF
msg "  ✔ Added static IP for wlan0"
else
msg "  ✔ Static IP already configured"
fi

# ---- DNSMASQ CONFIG ----
msg "Writing dnsmasq configuration…"

mkdir -p /etc/dnsmasq.d

cat >/etc/dnsmasq.d/measurely-ap.conf <<EOF
interface=wlan0
dhcp-range=192.168.4.100,192.168.4.150,12h
EOF

msg "  ✔ dnsmasq configured"

# ---- HOSTAPD CONFIG ----
msg "Writing hostapd configuration…"

cat >/etc/hostapd/hostapd.conf <<EOF
interface=wlan0
driver=nl80211
ssid=Measurely
hw_mode=g
channel=6
wmm_enabled=0
auth_algs=1
ignore_broadcast_ssid=0
EOF

# Set DAEMON_CONF
sed -i 's|#DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd 2>/dev/null || true
sed -i 's|DAEMON_CONF=".*"|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd 2>/dev/null || true

msg "  ✔ hostapd configured"

# ---- NetworkManager ignore-wlan0 ----
msg "Configuring NetworkManager to ignore wlan0…"

NM_IGNORE="/etc/NetworkManager/conf.d/ignore-wlan0.conf"

cat >"$NM_IGNORE" <<EOF
[keyfile]
unmanaged-devices=interface-name:wlan0
EOF

msg "  ✔ wlan0 set to unmanaged"

systemctl restart NetworkManager

# ---- Enable services ----
msg "Enabling hostapd + dnsmasq…"

systemctl enable hostapd
systemctl enable dnsmasq

systemctl restart dhcpcd
systemctl restart dnsmasq
systemctl restart hostapd

sleep 1

if systemctl -q is-active hostapd; then
    msg "✔ Access Point active: SSID=Measurely on 192.168.4.1"
else
    warn "⚠ hostapd not active — check logs:"
    warn "   journalctl -u hostapd -e"
fi
