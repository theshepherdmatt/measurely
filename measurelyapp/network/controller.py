import json
import os
import time

from . import ap, sta
from .util import run, try_run

STATE_DIR = "/home/matt/measurely/state"
ONBOARDING_FILE = os.path.join(STATE_DIR, "onboarding.json")


def _write_onboarding_done():
    os.makedirs(STATE_DIR, exist_ok=True)

    payload = {
        "onboarded": True,
        "completed": True
    }

    with open(ONBOARDING_FILE, "w") as f:
        json.dump(payload, f)

    print(f"[ONBOARDING] Wrote {ONBOARDING_FILE}: {payload}")


def connect(ssid, password):
    print(f"[NETWORK] connect {ssid}")

    ok = sta.connect(ssid, password)
    print(f"[NETWORK] sta.connect result: {ok}")

    if ok:
        _write_onboarding_done()

        # Give the OS a beat to settle routes, then restart Measurely
        try_run("sync")
        time.sleep(1)

        print("[NETWORK] Restarting measurely service...")
        run("systemctl reboot", check=False)
        return True

    # If STA failed, bring AP back
    print("[NETWORK] STA failed – starting AP again")
    ap.start()
    return False


def start_ap():
    ap.start()


def stop_ap():
    ap.stop()


def scan():
    # delegate if present
    if hasattr(sta, "scan"):
        return sta.scan()
    return []


def _get_ip():
    # returns first IPv4 on wlan1, or None
    out = try_run("ip -4 addr show dev wlan1")
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("inet "):
            # inet 192.168.x.x/24 ...
            return line.split()[1].split("/")[0]
    return None


def status():
    connected = bool(getattr(sta, "has_internet")() if hasattr(sta, "has_internet") else False)
    mode = "sta" if connected else "ap"
    return {
        "mode": mode,
        "connected": connected,
        "ip": _get_ip()
    }
