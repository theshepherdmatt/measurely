#!/bin/bash
# Measurely Access Point Setup (Bookworm / systemd-networkd)
# Creates AP on wlan0, static 192.168.4.1 and isolates it from NetworkManager.

LOG="/var/log/measurely-ap.log"

echo "-------------------------------------" | tee -a $LOG
echo " MEASURELY – AP SETUP START "          | tee -a $LOG
echo "-------------------------------------" | tee -a $LOG

python3 /home/matt/measurely/measurelyapp/update_led_state.py ap_starting

# ---------------------------------------------------------------
# 1. CHECK WLAN0 EXISTS
# ---------------------------------------------------------------
echo "[CHECK] Checking for wlan0…" | tee -a $LOG
if ! ip link show wlan0 >/dev/null 2>&1; then
    echo "[ERROR] wlan0 not found — aborting." | tee -a $LOG
    exit 1
fi
echo "[OK] wlan0 is present." | tee -a $LOG

# ---------------------------------------------------------------
# 2. INSTALL REQUIRED PACKAGES
# ---------------------------------------------------------------
echo "[STEP] Installing hostapd + dnsmasq…" | tee -a $LOG
apt-get update >> $LOG 2>&1
apt-get install -y hostapd dnsmasq >> $LOG 2>&1
echo "[OK] Packages installed." | tee -a $LOG

# ---------------------------------------------------------------
# 3. DISABLE NETWORKMANAGER CONTROL OF wlan0
# ---------------------------------------------------------------
echo "[STEP] Marking wlan0 as unmanaged by NetworkManager…" | tee -a $LOG

mkdir -p /etc/NetworkManager/conf.d
cat <<EOF >/etc/NetworkManager/conf.d/unmanaged-wlan0.conf
[keyfile]
unmanaged-devices=interface-name:wlan0
EOF

echo "[OK] NetworkManager will ignore wlan0." | tee -a $LOG

# ---------------------------------------------------------------
# 4. STATIC IP (systemd-networkd)
# ---------------------------------------------------------------
echo "[STEP] Configuring static IP 192.168.4.1…" | tee -a $LOG

mkdir -p /etc/systemd/network
cat <<EOF >/etc/systemd/network/12-wlan0-ap.network
[Match]
Name=wlan0

[Network]
Address=192.168.4.1/24
ConfigureWithoutCarrier=yes
EOF

systemctl restart systemd-networkd >> $LOG 2>&1
echo "[OK] systemd-networkd now manages wlan0." | tee -a $LOG

# ---------------------------------------------------------------
# 5. CONFIGURE dnsmasq
# ---------------------------------------------------------------
echo "[STEP] Writing dnsmasq config…" | tee -a $LOG

cat <<EOF >/etc/dnsmasq.d/measurely-ap.conf
interface=wlan0
dhcp-range=192.168.4.100,192.168.4.150,255.255.255.0,12h
EOF

echo "[OK] dnsmasq configured." | tee -a $LOG

# ---------------------------------------------------------------
# 6. CONFIGURE hostapd
# ---------------------------------------------------------------
echo "[STEP] Writing hostapd config…" | tee -a $LOG

mkdir -p /etc/hostapd
cat <<EOF >/etc/hostapd/hostapd.conf
interface=wlan0
driver=nl80211
ssid=MeasurelyConnect
hw_mode=g
channel=6
wmm_enabled=0
auth_algs=1
ignore_broadcast_ssid=0
EOF

echo "[OK] hostapd.conf created." | tee -a $LOG

# Force hostapd to use our config
sed -i '/DAEMON_CONF/d' /etc/default/hostapd
echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' >> /etc/default/hostapd

# ---------------------------------------------------------------
# 7. ENABLE AP SERVICES
# ---------------------------------------------------------------
echo "[STEP] Enabling hostapd & dnsmasq…" | tee -a $LOG
systemctl unmask hostapd >> $LOG 2>&1
systemctl enable hostapd dnsmasq >> $LOG 2>&1
echo "[OK] Services enabled." | tee -a $LOG

# ---------------------------------------------------------------
# 8. RESTART SERVICES
# ---------------------------------------------------------------
echo "[STEP] Restarting AP services…" | tee -a $LOG
systemctl restart dnsmasq >> $LOG 2>&1
systemctl restart hostapd >> $LOG 2>&1
echo "[OK] AP services restarted." | tee -a $LOG

# ---------------------------------------------------------------
# 9. VALIDATE wlan0 ADDRESS
# ---------------------------------------------------------------
IP=$(ip -4 addr show wlan0 | grep inet | awk '{print $2}' | cut -d/ -f1)

if [[ "$IP" == "192.168.4.1" ]]; then
    echo "[OK] wlan0 confirmed at 192.168.4.1." | tee -a $LOG
else
    echo "[ERROR] wlan0 missing 192.168.4.1 — AP may not start correctly." | tee -a $LOG
fi

echo "" | tee -a $LOG
echo "-------------------------------------" | tee -a $LOG
echo "   MEASURELY AP READY "              | tee -a $LOG
echo "   SSID: MeasurelyConnect"           | tee -a $LOG
echo "   IP:   http://192.168.4.1:5000"    | tee -a $LOG
echo "   Logs: $LOG"                       | tee -a $LOG
echo "-------------------------------------" | tee -a $LOG

python3 /home/matt/measurely/measurelyapp/update_led_state.py ap_ready
