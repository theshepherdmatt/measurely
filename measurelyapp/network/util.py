import subprocess
import shlex

def run(cmd, check=True):
    print(f"[NET] $ {cmd}")

    result = subprocess.run(
        shlex.split(cmd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip())

    # IMPORTANT: return raw stdout, not stripped lines
    return result.stdout


def try_run(cmd):
    try:
        return run(cmd, check=False)
    except Exception:
        return ""

def get_wifi_iface():
    # 1. Prefer installer-defined interface
    try:
        with open("/etc/measurely.conf") as f:
            for line in f:
                if line.startswith("WIFI_IFACE="):
                    iface = line.strip().split("=", 1)[1]
                    if iface:
                        return iface
    except Exception:
        pass

    # 2. Fallback: ask the kernel what actually exists
    out = try_run("iw dev")
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("Interface"):
            return line.split()[1]

    # 3. Absolute last resort
    return None

