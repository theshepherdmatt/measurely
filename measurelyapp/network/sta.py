import time
from .util import run, try_run
from .util import get_wifi_iface

IFACE = get_wifi_iface()

WPA_CONF = f"/etc/wpa_supplicant/wpa_supplicant-{IFACE}.conf"


def write_config(ssid, psk):
    print(f"[STA] Writing wpa_supplicant config for SSID='{ssid}'")
    with open(WPA_CONF, "w") as f:
        f.write(f"""
ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev
update_config=0
country=GB

network={{
    ssid="{ssid}"
    psk="{psk}"
}}
""".strip())


def connect(ssid, psk, timeout=25):
    print(f"[STA] Connecting to SSID='{ssid}'")

    write_config(ssid, psk)

    print("[STA] Stopping AP services")
    run("systemctl stop hostapd", check=False)
    run("systemctl stop dnsmasq", check=False)

    print("[STA] Hard-resetting Wi-Fi state")
    try_run("pkill -9 wpa_supplicant")
    try_run("pkill -9 dhclient")
    try_run(f"rm -rf /run/wpa_supplicant/{IFACE}")
    try_run("rm -f /var/lib/dhcp/dhclient.*")
    try_run(f"ip route flush dev {IFACE}")
    try_run(f"ip addr flush dev {IFACE}")
    try_run(f"ip link set {IFACE} down")
    try_run("sleep 1")
    try_run(f"ip link set {IFACE} up")

    print("[STA] Starting wpa_supplicant")
    run(f"wpa_supplicant -B -i {IFACE} -c {WPA_CONF}", check=False)

    print("[STA] Starting DHCP client")
    run(f"dhclient -4 {IFACE}", check=False)

    start = time.time()
    while time.time() - start < timeout:
        routes = try_run("ip route")
        if "default via" in routes:
            print("[STA] Default route acquired")
            return True
        time.sleep(1)

    print("[STA] DHCP / default route timeout")
    return False


def scan():
    print(f"[SCAN] Running: iw dev {IFACE} scan")
    out = run(f"iw dev {IFACE} scan", check=False)

    print(f"[SCAN] Raw output length: {len(out)}")

    nets = []
    ssid = None
    signal_dbm = None

    for line in out.splitlines():
        line = line.strip()

        if line.startswith("BSS "):
            if ssid:
                sig = None
                if signal_dbm is not None:
                    sig = int(max(0, min(100, 2 * (signal_dbm + 100))))
                print(f"[SCAN] Commit BSS: ssid='{ssid}', signal_dbm={signal_dbm}, signal={sig}")
                nets.append({"ssid": ssid, "signal": sig})
            ssid = None
            signal_dbm = None
            continue

        if line.startswith("SSID:"):
            ssid = line.split("SSID:", 1)[1].strip() or None
            print(f"[SCAN] Found SSID: {ssid}")
            continue

        if line.startswith("signal:"):
            try:
                signal_dbm = float(line.split("signal:", 1)[1].strip().split()[0])
                print(f"[SCAN] Signal dBm: {signal_dbm}")
            except Exception:
                print("[SCAN] Failed to parse signal line:", line)
                signal_dbm = None
            continue

    if ssid:
        sig = None
        if signal_dbm is not None:
            sig = int(max(0, min(100, 2 * (signal_dbm + 100))))
        print(f"[SCAN] Commit FINAL BSS: ssid='{ssid}', signal_dbm={signal_dbm}, signal={sig}")
        nets.append({"ssid": ssid, "signal": sig})

    print(f"[SCAN] Parsed BSS entries (pre-dedupe): {len(nets)}")

    best = {}
    for n in nets:
        s = n.get("ssid")
        if not s:
            continue
        if s not in best:
            best[s] = n
        else:
            a = best[s].get("signal")
            b = n.get("signal")
            if b is not None and (a is None or b > a):
                best[s] = n

    result = sorted(
        best.values(),
        key=lambda x: (x.get("signal") is None, -(x.get("signal") or 0), x["ssid"])
    )

    print(f"[SCAN] Final network list count: {len(result)}")
    return result


def disconnect():
    print("[STA] Disconnecting")
    try_run("pkill -9 wpa_supplicant")
    try_run(f"dhclient -r {IFACE}")
    try_run(f"ip addr flush dev {IFACE}")


def has_internet():
    routes = try_run("ip route")
    has_net = "default via" in routes
    print(f"[STA] Internet check: {has_net}")
    return has_net


def status():
    return has_internet()
