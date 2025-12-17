from .util import run, try_run

IFACE = "wlan1"
AP_IP = "192.168.4.1/24"

def start():
    print("[AP] Starting access point")

    # Kill STA ownership
    try_run("pkill -9 wpa_supplicant")
    try_run(f"dhclient -r {IFACE}")

    # Hard reset interface (MANDATORY)
    run(f"ip link set {IFACE} down", check=False)
    run("sleep 2", check=False)
    run(f"ip link set {IFACE} up")

    # Assign AP IP
    try_run(f"ip addr flush dev {IFACE}")
    run(f"ip addr add {AP_IP} dev {IFACE}")

    # Start services
    run("systemctl start dnsmasq")
    run("systemctl start hostapd")

def stop():
    print("[AP] Stopping access point")
    run("systemctl stop hostapd", check=False)
    run("systemctl stop dnsmasq", check=False)
    try_run(f"ip addr flush dev {IFACE}")

def status():
    out = try_run("iw dev")
    return f"type AP" in out and "MeasurelyConnect" in out
