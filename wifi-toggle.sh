#!/bin/bash
# WiFi ↔ AP toggle for Measurely (NetworkManager + hostapd + dnsmasq)
# Bookworm-compatible (no dhcpcd)

NM_IGNORE="/etc/NetworkManager/conf.d/unmanaged-wlan0.conf"

case "$1" in

  on)
    echo "[WiFi] Switching TO normal Wi-Fi client mode..."

    # Remove unmanaged config
    if [ -f "$NM_IGNORE" ]; then
        rm "$NM_IGNORE"
        echo "[WiFi] NetworkManager will now manage wlan0."
    fi

    # Stop AP services
    systemctl stop hostapd 2>/dev/null
    systemctl stop dnsmasq 2>/dev/null

    # Clear static AP IP
    ip addr flush dev wlan0

    # Restart NetworkManager so wlan0 comes back
    systemctl restart NetworkManager
    sleep 2

    nmcli radio wifi on

    echo "[WiFi] Wi-Fi ON. Connect using:"
    echo "       sudo nmcli device wifi connect \"YOURSSID\" password \"YOURPASS\""
    ;;

  off)
    echo "[AP] Switching TO Access Point mode…"

    # Disconnect NM from the interface
    nmcli device disconnect wlan0 2>/dev/null

    # Mark unmanaged
    echo -e "[keyfile]\nunmanaged-devices=interface-name:wlan0" > "$NM_IGNORE"

    # Restart NM to release control
    systemctl restart NetworkManager
    sleep 1

    # Assign static AP IP directly
    ip addr flush dev wlan0
    ip addr add 192.168.4.1/24 dev wlan0
    ip link set wlan0 up

    # Start AP stack
    systemctl start dnsmasq
    systemctl start hostapd

    echo "[AP] Access Point ENABLED."
    echo "[AP] SSID: MeasurelyConnect"
    echo "[AP] IP:   192.168.4.1"
    ;;

  *)
    echo "WiFi Toggle for Measurely"
    echo "Usage:"
    echo "  sudo ./wifi-toggle.sh on"
    echo "  sudo ./wifi-toggle.sh off"
    exit 1
    ;;
esac
