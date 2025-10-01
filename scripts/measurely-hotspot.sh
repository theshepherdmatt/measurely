#!/usr/bin/env bash
set -euo pipefail
SSID="${SSID:-Measurely-Setup}"
PASS="${PASS:-measurely123}"
IFACE="${IFACE:-wlan0}"
case "${1:-}" in
  start)
    if nmcli -g NAME connection | grep -qx "Measurely-Hotspot"; then
      nmcli connection up "Measurely-Hotspot" || true
    else
      nmcli connection add type wifi ifname "$IFACE" con-name "Measurely-Hotspot" autoconnect yes ssid "$SSID"
      nmcli connection modify "Measurely-Hotspot" 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS"
      nmcli connection up "Measurely-Hotspot"
    fi
    ;;
  stop) nmcli connection down "Measurely-Hotspot" 2>/dev/null || true ;;
  *) echo "Usage: $0 {start|stop}"; exit 1 ;;
esac
