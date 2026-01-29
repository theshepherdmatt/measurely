#!/bin/bash
# Measurely WiFi ↔ AP hard toggle
# Purpose:
#   on  = Use wlan0 as Wi-Fi client (internet for dev)
#   off = Use wlan0 as Measurely Access Point

IFACE="wlan0"
NM_IGNORE="/etc/NetworkManager/conf.d/measurely-unmanaged.conf"

case "$1" in

  on)
    echo "[MODE] Switching to Wi-Fi CLIENT mode (internet)"

    # Stop AP stack completely
    systemctl stop hostapd dnsmasq 2>/dev/null

    # Allow NetworkManager to control wlan0
    rm -f "$NM_IGNORE"
    systemctl restart NetworkManager
    sleep 3

    nmcli radio wifi on
    echo
    echo "Connect using:"
    echo "  nmcli device wifi list"
    echo "  nmcli device wifi connect \"SSID\" password \"PASS\""
    ;;

  off)
    echo "[MODE] Switching to MEASURELY ACCESS POINT mode"

    # Disconnect from any Wi-Fi network
    nmcli device disconnect ${IFACE} 2>/dev/null

    # Tell NetworkManager to IGNORE wlan0 completely
    echo -e "[keyfile]\nunmanaged-devices=interface-name:${IFACE}" > "$NM_IGNORE"
    systemctl restart NetworkManager
    sleep 2

    # Fully reset Wi-Fi interface (important)
    ip link set ${IFACE} down
    sleep 1
    ip link set ${IFACE} up
    sleep 1

    # Assign AP IP
    ip addr flush dev ${IFACE}
    ip addr add 192.168.4.1/24 dev ${IFACE}

    # Start AP services
    systemctl restart dnsmasq
    systemctl restart hostapd

    echo
    echo "✔ Measurely AP ACTIVE"
    echo "SSID: MeasurelyConnect"
    echo "IP:   192.168.4.1"
    ;;

  *)
    echo "Usage:"
    echo "  sudo ./wifi-toggle.sh on    # Internet mode"
    echo "  sudo ./wifi-toggle.sh off   # Measurely AP mode"
    exit 1
    ;;
esac