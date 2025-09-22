#!/usr/bin/env python3
"""
Measurely – main orchestrator
- Picks playback backend (aplay/pa) via a tiny factory
- Runs capture sweep (measurely.sweep), then analysis (measurely.analyse)
- Echoes the sweep's stdout (so the "Saved: <dir>" line is preserved)
- After analysis, prints a plain-English summary + simple fixes
"""

import argparse, subprocess, sys, os, shlex, json

# --- backend managers ---
class PlaybackManager:
    def __init__(self, backend: str, alsa_device: str | None = None):
        self.backend = backend
        self.alsa_device = alsa_device

    def as_args(self):
        args = ["--playback", self.backend]
        if self.backend == "aplay" and self.alsa_device:
            args += ["--alsa-device", self.alsa_device]
        return args

class ManagerFactory:
    @staticmethod
    def for_system(prefer: str = "aplay", alsa_device: str = "hw:2,0"):
        # (Optional) You could auto-detect a suitable ALSA hw:X,Y here.
        return PlaybackManager(prefer, alsa_device if prefer == "aplay" else None)

# --- small helpers ---
def _print_err(msg: str):
    print(msg, file=sys.stderr, flush=True)

def _read_analysis_json(session_dir: str) -> dict:
    try:
        p = os.path.join(session_dir, "analysis.json")
        with open(p, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def main():
    ap = argparse.ArgumentParser(description="Measurely – orchestrator")
    ap.add_argument("--in", dest="in_dev", type=int, required=False, help="Input device index")
    ap.add_argument("--out", dest="out_dev", type=int, required=False, help="Output device index")
    ap.add_argument("--fs", type=int, default=48000)
    ap.add_argument("--dur", type=float, default=8.0)
    ap.add_argument("--prepad", type=float, default=0.5)
    ap.add_argument("--postpad", type=float, default=1.0)
    ap.add_argument("--backend", choices=["aplay", "pa"], default="aplay")
    ap.add_argument("--alsa-device", default="hw:2,0")
    ap.add_argument("--points-per-oct", type=int, default=48,
                    help="Log bins per octave to pass to analyse")
    ap.add_argument("--tag", default=None, help="Optional tag for the capture (saved in meta)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    mgr = ManagerFactory.for_system(prefer=args.backend, alsa_device=args.alsa_device)

    # ----- Build capture (sweep) command -----
    sweep_cmd = [
        sys.executable, "-m", "measurely.sweep",
        "--fs", str(args.fs),
        "--dur", str(args.dur),
        "--prepad", str(args.prepad),
        "--postpad", str(args.postpad),
        "--verbose",
        *mgr.as_args(),
    ]
    if args.in_dev is not None:
        sweep_cmd += ["--in", str(args.in_dev)]
    if args.out_dev is not None:
        sweep_cmd += ["--out", str(args.out_dev)]
    if args.tag:
        sweep_cmd += ["--tag", args.tag]

    if args.dry_run:
        print("Would run capture:\n ", shlex.join(sweep_cmd))
        print("Then run analyse on the Saved: directory found in capture output with:")
        print(" ", shlex.join([
            sys.executable, "-m", "measurely.analyse", "<session_dir>",
            "--points-per-oct", str(args.points_per_oct),
        ]))
        sys.exit(0)

    # ----- Run capture and surface its stdout (incl. Saved: ...) -----
    print("Running capture…", flush=True)
    cap = subprocess.run(sweep_cmd, text=True, capture_output=True)
    # Echo stdout/stderr from sweep so the UI can show logs and parse "Saved:"
    if cap.stdout:
        print(cap.stdout, end="" if cap.stdout.endswith("\n") else "\n", flush=True)
    if cap.returncode != 0:
        if cap.stderr:
            _print_err(cap.stderr)
        sys.exit(cap.returncode)

    # Parse Saved: path from capture stdout
    saved_dir = None
    for line in (cap.stdout or "").splitlines():
        if line.startswith("Saved:"):
            saved_dir = line.split("Saved:", 1)[1].strip()
            break
    if not saved_dir or not os.path.isdir(saved_dir):
        _print_err("Could not locate Saved: directory in capture output.")
        sys.exit(2)

    # ----- Run analysis on that session directory -----
    print("Running analysis…", flush=True)
    analyse_cmd = [
        sys.executable, "-m", "measurely.analyse", saved_dir,
        "--points-per-oct", str(args.points_per_oct),
    ]
    ana = subprocess.run(analyse_cmd, text=True, capture_output=True)
    # Surface analysis logs (so UI shows them too)
    if ana.stdout:
        print(ana.stdout, end="" if ana.stdout.endswith("\n") else "\n", flush=True)
    if ana.returncode != 0:
        if ana.stderr:
            _print_err(ana.stderr)
        sys.exit(ana.returncode)

    # ----- Print a plain-English digest for the UI log pane -----
    analysis = _read_analysis_json(saved_dir)
    one = analysis.get("plain_summary")
    fixes = analysis.get("simple_fixes") or []

    if one:
        print(f"Simple result: {one}", flush=True)
    if fixes:
        print("What to do next:", flush=True)
        for tip in fixes[:3]:
            print(f" - {tip}", flush=True)

    # Re-emit Saved: line at the end too (harmless; makes parsing robust)
    print(f"Saved: {saved_dir}", flush=True)
    sys.exit(0)

if __name__ == "__main__":
    main()
