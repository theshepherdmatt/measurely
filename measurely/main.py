#!/usr/bin/env python3
"""
Measurely – main orchestrator
- Picks playback backend (aplay/pa) via a tiny factory
- Runs capture sweep (measurely.sweep), then analysis (measurely.analyse)
- Echoes the sweep's stdout (so the "Saved: <dir>" line is preserved)
- After analysis, prints a plain-English summary + simple fixes

Extras:
- --speaker support to load a profile from ~/measurely/speakers/speakers.json
- Forwards safe sweep bounds/levels to measurely.sweep
- Passes target curve CSV to measurely.analyse
"""

import argparse, subprocess, sys, os, shlex, json

# --- speaker profiles ---
def _repo_root():
    # Resolve .../measurely (project root) from this file's location
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here))  # script sits at repo root already

def _speakers_root():
    # <repo>/speakers
    return os.path.join(_repo_root(), "speakers")

def _load_speakers_index():
    cfg = os.path.join(_speakers_root(), "speakers.json")
    with open(cfg, "r") as f:
        return json.load(f), cfg

def _load_speaker_profile(key: str) -> dict:
    data, cfg_path = _load_speakers_index()
    prof = data.get(key)
    if not prof:
        raise ValueError(f"Speaker profile '{key}' not found in {cfg_path}")
    folder = os.path.join(_speakers_root(), prof["folder"])
    target_csv = os.path.join(folder, prof.get("target_curve", ""))
    if prof.get("target_curve") and not os.path.isfile(target_csv):
        raise FileNotFoundError(f"Target curve not found: {target_csv}")
    prof["_target_csv_abs"] = target_csv if prof.get("target_curve") else None
    return prof

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
    ap.add_argument("--speaker", default=None, help="Speaker profile key (e.g. quad_esl57)")
    # Optional manual overrides (take precedence over speaker defaults)
    ap.add_argument("--level", type=float, default=None, help="Sweep level in dBFS (e.g. -15)")
    ap.add_argument("--start-hz", type=float, default=None, help="Sweep start frequency")
    ap.add_argument("--end-hz", type=float, default=None, help="Sweep end frequency")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # Load speaker profile (if any)
    speaker = None
    if args.speaker:
        try:
            speaker = _load_speaker_profile(args.speaker)
        except Exception as e:
            _print_err(f"[speaker] {e}")
            sys.exit(3)

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

    # Apply speaker defaults unless overridden by CLI
    lvl = args.level if args.level is not None else (speaker.get("safe_level_dbfs") if speaker else None)
    s_hz = args.start_hz if args.start_hz is not None else (speaker.get("sweep_start_hz") if speaker else None)
    e_hz = args.end_hz if args.end_hz is not None else (speaker.get("sweep_end_hz") if speaker else None)
    if lvl is not None:
        sweep_cmd += ["--level", str(lvl)]
    if s_hz is not None:
        sweep_cmd += ["--start-hz", str(s_hz)]
    if e_hz is not None:
        sweep_cmd += ["--end-hz", str(e_hz)]

    if args.dry_run:
        print("Would run capture:\n ", shlex.join(sweep_cmd))
        print("Then run analyse on the Saved: directory found in capture output with:")
        ana_preview = [sys.executable, "-m", "measurely.analyse", "<session_dir>",
                       "--points-per-oct", str(args.points_per_oct)]
        if speaker and speaker.get("_target_csv_abs"):
            ana_preview += ["--target-csv", speaker["_target_csv_abs"]]
        print(" ", shlex.join(ana_preview))
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
    # Forward target curve if present
    if speaker and speaker.get("_target_csv_abs"):
        analyse_cmd += ["--target-csv", speaker["_target_csv_abs"]]

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
