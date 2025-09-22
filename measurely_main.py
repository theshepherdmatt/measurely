#!/usr/bin/env python3
"""
Measurely – main orchestrator
- Selects playback backend via a simple factory
- Runs sweep (measurely_sweep.py) then analysis (measurely_analyse.py)
- Supports --dry-run and --tag that passes into the capture step
"""

import argparse, subprocess, sys, os, shlex

# --- backend managers ---
class PlaybackManager:
    def __init__(self, backend, alsa_device=None):
        self.backend = backend
        self.alsa_device = alsa_device

    def as_args(self):
        args = ["--playback", self.backend]
        if self.backend == "aplay" and self.alsa_device:
            args += ["--alsa-device", self.alsa_device]
        return args

class ManagerFactory:
    @staticmethod
    def for_system(prefer="aplay", alsa_device="hw:2,0"):
        # You could add autodetection here (parse `aplay -l`), for now fixed:
        return PlaybackManager(prefer, alsa_device if prefer == "aplay" else None)

def main():
    ap = argparse.ArgumentParser(description="Measurely – orchestrator")
    ap.add_argument("--in", dest="in_dev", type=int, required=False, help="Input device index")
    ap.add_argument("--out", dest="out_dev", type=int, required=False, help="Output device index")
    ap.add_argument("--fs", type=int, default=48000)
    ap.add_argument("--dur", type=float, default=8.0)
    ap.add_argument("--prepad", type=float, default=0.5)
    ap.add_argument("--postpad", type=float, default=1.0)
    ap.add_argument("--backend", choices=["aplay","pa"], default="aplay")
    ap.add_argument("--alsa-device", default="hw:2,0")
    ap.add_argument("--tag", default=None, help="Optional tag for the capture (saved in meta)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    mgr = ManagerFactory.for_system(prefer=args.backend, alsa_device=args.alsa_device)
    sweep_cmd = [
        sys.executable, "measurely_sweep.py",
        "--fs", str(args.fs),
        "--dur", str(args.dur),
        "--prepad", str(args.prepad),
        "--postpad", str(args.postpad),
        "--verbose"
    ] + mgr.as_args()

    if args.in_dev is not None:
        sweep_cmd += ["--in", str(args.in_dev)]
    if args.out_dev is not None:
        sweep_cmd += ["--out", str(args.out_dev)]
    if args.tag:
        # harmless: measurely_sweep.py will ignore unknown arg unless you’ve added --tag support;
        # if you implemented it, pass it through:
        sweep_cmd += ["--tag", args.tag]

    if args.dry_run:
        print("Would run capture:\n ", shlex.join(sweep_cmd))
        print("Then run analyse on the Saved: directory found in capture output")
        sys.exit(0)

    # Run capture and parse Saved: path from stdout
    print("Running capture…")
    proc = subprocess.run(sweep_cmd, text=True, capture_output=True)
    print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)

    saved_dir = None
    for line in proc.stdout.splitlines():
        if line.startswith("Saved:"):
            saved_dir = line.split("Saved:",1)[1].strip()
            break
    if not saved_dir or not os.path.isdir(saved_dir):
        print("Could not locate Saved: directory in capture output.", file=sys.stderr)
        sys.exit(2)

    # Run analysis
    print("Running analysis…")
    proc2 = subprocess.run([sys.executable, "measurely_analyse.py", saved_dir], text=True)
    sys.exit(proc2.returncode)

if __name__ == "__main__":
    main()
