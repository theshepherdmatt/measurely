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

WEB_JS_DIR="$REPO_DIR/web/js"
[ -d "$WEB_JS_DIR" ] || die "Missing web/js directory"
cd "$WEB_JS_DIR"

if [ ! -f package.json ]; then
  sudo -u "$APP_USER" npm init -y >/dev/null
fi

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
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$REPO_DIR
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$REPO_DIR
Environment=MEASURELY_MEAS_ROOT=$REPO_DIR/measurements
ExecStart=$VENV_DIR/bin/python -m measurelyapp.server --host 0.0.0.0 --port 5000
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
STARTER="uploads0"

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

msg "Configuring audio hardware (I2S DAC + USB microphone)…"

CONFIG="/boot/firmware/config.txt"

# --- Enable I2S (required for HiFiBerry DAC) ---
if ! grep -q "^dtparam=i2s=on" "$CONFIG"; then
    echo "dtparam=i2s=on" | tee -a "$CONFIG" >/dev/null
    msg "  - Enabled I2S"
else
    msg "  - I2S already enabled"
fi


# --- Enable I2S DAC overlay (NanoSound / PCM512x) ---
if ! grep -q "^dtoverlay=pcm512x" "$CONFIG"; then
    echo "dtoverlay=pcm512x" | tee -a "$CONFIG" >/dev/null
    msg "  - Added I2S DAC overlay (pcm512x)"
else
    msg "  - I2S DAC overlay already present"
fi


# --- Stabilise ALSA card ordering ---
msg "Writing /etc/asound.conf to stabilise audio card order…"

cat >/etc/asound.conf <<'EOF'
# Default playback device (I2S DAC – NanoSound / PCM512x)
pcm.!default {
    type plug
    slave.pcm "hw:0,0"
}

ctl.!default {
    type hw
    card 0
}

# USB microphone alias
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
# Force wlan0 up BEFORE starting AP services
# ------------------------------------------------------------

ip link set wlan0 up

# ------------------------------------------------------------
# Access Point setup (Pi 4 – wlan0 ONLY)
# ------------------------------------------------------------
msg "Configuring Access Point on wlan0…"

apt-get install -y hostapd dnsmasq avahi-daemon dhcpcd5
systemctl enable --now avahi-daemon

# Ensure hostname is correct for mDNS
hostnamectl set-hostname measurely

# Advertise Measurely web service over mDNS
mkdir -p /etc/avahi/services
cat >/etc/avahi/services/measurely.service <<'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Measurely</name>
  <service>
    <type>_http._tcp</type>
    <port>5000</port>
  </service>
</service-group>
EOF

systemctl restart avahi-daemon

# Ensure .local name resolution works (required for measurely.local)
if ! grep -q "mdns4" /etc/nsswitch.conf; then
    sed -i 's/^hosts:.*/hosts: files mdns4_minimal [NOTFOUND=return] dns mdns4/' /etc/nsswitch.conf
fi

systemctl stop hostapd dnsmasq || true
systemctl unmask hostapd

# Tell NetworkManager to leave wlan0 alone
mkdir -p /etc/NetworkManager/conf.d
cat >/etc/NetworkManager/conf.d/99-measurely-wlan0.conf <<'EOF'
[keyfile]
unmanaged-devices=interface-name:wlan0
EOF

systemctl restart NetworkManager 2>/dev/null || true

# Give wlan0 a static IP using dhcpcd (required for AP)
# Configure wlan0 static IP for AP
sed -i '/^interface wlan0$/,/^$/d' /etc/dhcpcd.conf

cat >>/etc/dhcpcd.conf <<'EOF'

interface wlan0
static ip_address=192.168.4.1/24
nohook wpa_supplicant
EOF

systemctl restart dhcpcd


# dnsmasq
cat >/etc/dnsmasq.d/measurely-ap.conf <<'EOF'
interface=wlan0
bind-interfaces

dhcp-range=192.168.4.20,192.168.4.80,255.255.255.0,12h
dhcp-option=option:router,192.168.4.1
dhcp-option=option:dns-server,192.168.4.1

domain-needed
bogus-priv
EOF

# hostapd
cat >/etc/hostapd/hostapd.conf <<EOF
interface=wlan0
driver=nl80211
country_code=GB
ssid=MeasurelyConnect
hw_mode=g
channel=6
ieee80211n=1
wmm_enabled=1
auth_algs=1
ignore_broadcast_ssid=0
wpa=0
EOF

sed -i 's|^#DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd

systemctl enable hostapd dnsmasq
systemctl restart dnsmasq
systemctl restart hostapd

msg "✔ Access Point MEASURELY active on wlan0 (192.168.4.1)"


# ------------------------------------------------------------
# 9. Configure eth0 as static 10.10.10.2 (SSH / dev link)
# ------------------------------------------------------------
msg "Configuring eth0 static IP (10.10.10.2)…"

# Remove old entries to avoid duplicates
sed -i '/^interface eth0$/,/^$/d' /etc/dhcpcd.conf

cat >>/etc/dhcpcd.conf <<'EOF'

interface eth0
static ip_address=10.10.10.2/24
EOF

systemctl restart dhcpcd
msg "✔ eth0 locked to 10.10.10.2 via dhcpcd"


# ------------------------------------------------------------
# Fix reverse path filtering (required for dual-network AP + eth0)
# ------------------------------------------------------------
msg "Disabling rp_filter for dual-network routing…"

sed -i '/net.ipv4.conf.all.rp_filter/d' /etc/sysctl.conf
sed -i '/net.ipv4.conf.wlan0.rp_filter/d' /etc/sysctl.conf

echo "net.ipv4.conf.all.rp_filter=0" >> /etc/sysctl.conf
echo "net.ipv4.conf.wlan0.rp_filter=0" >> /etc/sysctl.conf

sysctl -p >/dev/null
msg "✔ rp_filter disabled (AP replies will not be dropped)"


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


