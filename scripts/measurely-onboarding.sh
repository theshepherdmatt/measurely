#!/usr/bin/env bash
set -euo pipefail

# Give NM time to auto-connect to known Wi-Fi
for i in {1..20}; do
  # Online check uses NetworkManager’s connectivity probe when configured,
  # otherwise fall back to a simple ping.
  if nmcli -t -f CONNECTIVITY general | grep -q "full"; then
    exit 0
  fi
  if ping -c1 -W1 8.8.8.8 >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

# Still offline → bring up onboarding AP
/usr/local/bin/measurely-hotspot.sh start
