#!/bin/bash
# WiFi ↔ AP toggle for Measurely (NetworkManager + hostapd + dnsmasq)
# Bookworm-compatible (no dhcpcd)

IFACE="wlan1"
NM_IGNORE="/etc/NetworkManager/conf.d/unmanaged-${IFACE}.conf"

case "$1" in

  on)
    echo "[WiFi] Switching TO normal Wi-Fi client mode..."

    # Remove unmanaged config
    if [ -f "$NM_IGNORE" ]; then
        rm "$NM_IGNORE"
        echo "[WiFi] NetworkManager will now manage ${IFACE}."
    fi

    # Stop AP services
    systemctl stop hostapd 2>/dev/null
    systemctl stop dnsmasq 2>/dev/null

    # Clear static AP IP
    ip addr flush dev ${IFACE}

    # Restart NetworkManager so ${IFACE} comes back
    systemctl restart NetworkManager
    sleep 2

    nmcli radio wifi on

    echo "[WiFi] Wi-Fi ON. Connect using:"
    echo "       sudo nmcli device wifi connect \"YOURSSID\" password \"YOURPASS\""
    ;;

  off)
    echo "[AP] Switching TO Access Point mode…"

    # Disconnect NM from interface
    nmcli device disconnect ${IFACE} 2>/dev/null

    # Mark unmanaged
    echo -e "[keyfile]\nunmanaged-devices=interface-name:${IFACE}" > "$NM_IGNORE"
    echo "[AP] NetworkManager will now IGNORE ${IFACE}"

    # Restart NetworkManager to release control
    systemctl restart NetworkManager
    sleep 1

    # Assign static AP IP directly
    ip addr flush dev ${IFACE}
    ip addr add 192.168.4.1/24 dev ${IFACE}
    ip link set ${IFACE} up

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
