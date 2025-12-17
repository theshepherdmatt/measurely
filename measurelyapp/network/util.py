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
