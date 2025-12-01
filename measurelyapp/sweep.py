#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
measurely – headless sweep runner (SSH-friendly, atomic writes)
- Supports left / right / both channel sweeps.
- Records slightly BEFORE playback to avoid missing sweep onset.
- Detects sweep start via cross-correlation; trims pre-roll.
- Deconvolves to impulse response; computes magnitude response.
- Saves all artefacts (wav, csv, png, json) atomically per run.
- NEW: --layout {folders,flat,both} controls per-channel file naming:
    * folders (default):   SESSION/left/response.csv, SESSION/right/response.csv
    * flat:                SESSION/left-response.csv, SESSION/right-response.csv
    * both:                writes both structures
- Verbose SSH-friendly logging with --verbose flag.
"""

import os, sys, json, uuid, argparse, subprocess, shutil, tempfile, signal, time
from datetime import datetime
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf
from scipy.signal import fftconvolve

# Headless-safe plotting
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ------------------------------------------------------------------
#  SWEEP STATUS WRITER
# ------------------------------------------------------------------
import json

SWEEP_STATUS_FILE = "/tmp/measurely_sweep_status.json"

def update_status(phase, percent, running=True):
    try:
        with open(SWEEP_STATUS_FILE, "w") as f:
            json.dump({
                "phase": phase,
                "percent": percent,
                "running": running,
                "ts": time.time()   # <-- NEW: monotonic ordering
            }, f)
    except Exception:
        pass


# ------------------------------------------------------------------
#  utilities
# ------------------------------------------------------------------
def session_dir() -> str:
    """
    Create sequential session folders: Sweep1, Sweep2, Sweep3…
    Tracks next number inside next_sweep.txt.
    """
    root = Path.home() / "measurely" / "measurements"
    root.mkdir(parents=True, exist_ok=True)

    counter_file = root / "next_sweep.txt"

    # Load current number
    if counter_file.exists():
        try:
            with open(counter_file, "r") as f:
                n = int(f.read().strip())
        except:
            n = 1
    else:
        n = 1

    # Folder name
    sweep_name = f"Sweep{n}"
    session_path = root / sweep_name

    # Increment & save for next time
    with open(counter_file, "w") as f:
        f.write(str(n + 1))

    return str(session_path)


def route_to_left(sweep):  return np.column_stack([sweep, np.zeros_like(sweep)])
def route_to_right(sweep): return np.column_stack([np.zeros_like(sweep), sweep])
def route_to_both(sweep):  return np.column_stack([sweep, sweep])

def write_log(outdir, lines):
    outdir = Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    text = "\n".join([str(ln).rstrip() for ln in lines]) + "\n" if isinstance(lines, (list, tuple)) else str(lines).rstrip() + "\n"
    try:
        with open(outdir / "debug.txt", "a", encoding="utf-8") as f: f.write(text)
    except Exception:
        pass

def log_print(outdir, *msg, verbose=True):
    line = " ".join(str(m) for m in msg)
    if verbose:
        print(line, flush=True)
    write_log(outdir, line)

def dev_info(idx, kind=None):
    try:
        return sd.query_devices(idx, kind) if kind else sd.query_devices(idx)
    except Exception as e:
        return {"error": str(e), "index": idx, "kind": kind}

def fail(outdir, e, where=""):
    write_log(outdir, f"FATAL{(' @'+where) if where else ''}: {e}")
    raise

# ------------------------------------------------------------------
#  atomic file I/O
# ------------------------------------------------------------------
def _atomic_write_bytes(data: bytes, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=str(dest.parent), delete=False) as tf:
        tf.write(data); tf.flush(); os.fsync(tf.fileno())
        os.replace(tf.name, dest)

def write_text_atomic(text: str, dest: Path):
    _atomic_write_bytes(text.encode("utf-8"), Path(dest))

def write_json_atomic(obj, dest: Path):
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    _atomic_write_bytes(payload, Path(dest))

def savefig_atomic(fig, dest: Path, **kwargs):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(dir=str(dest.parent), suffix=dest.suffix, delete=False).name
    try:
        fig.savefig(tmp, **kwargs)
        with open(tmp, "rb") as rf: os.fsync(rf.fileno())
        os.replace(tmp, dest)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass
        plt.close(fig)

def write_wav_atomic(dest: Path, data, fs: int):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(dir=str(dest.parent), suffix=".wav", delete=False).name
    try:
        sf.write(tmp, data, fs)
        with open(tmp, "rb") as rf: os.fsync(rf.fileno())
        os.replace(tmp, dest)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass

# ------------------------------------------------------------------
#  graceful shutdown
# ------------------------------------------------------------------
def _graceful_stop(sig, _frame):
    try:
        sd.stop()
    finally:
        sys.exit(130 if sig == signal.SIGINT else 143)

signal.signal(signal.SIGINT, _graceful_stop)
signal.signal(signal.SIGTERM, _graceful_stop)

# ------------------------------------------------------------------
#  DSP core
# ------------------------------------------------------------------
def gen_log_sweep(fs=48000, dur=8.0, f0=20.0, f1=20000.0):
    t   = np.linspace(0, dur, int(fs * dur), endpoint=False, dtype=np.float64)
    K   = dur / np.log(f1 / f0)
    phase = 2.0 * np.pi * f0 * K * (np.exp(t / K) - 1.0)
    sweep = np.sin(phase).astype(np.float32)
    sweep /= np.max(np.abs(sweep)) + 1e-12
    sweep *= 0.7
    inv   = (sweep[::-1] / np.exp(t / K)).astype(np.float32)
    return sweep, inv

def xcorr_peak_index(rec, ref):
    c = fftconvolve(rec, ref[::-1], mode="full")
    k = int(np.argmax(np.abs(c)))
    return max(0, k - (len(ref) - 1))

def deconvolve(y, inv):
    ir = fftconvolve(y, inv, mode="full")
    p  = int(np.argmax(np.abs(ir)))
    s  = max(p - 2048, 0)
    ir = ir[s : s + len(y)]
    return (ir / (np.max(np.abs(ir)) + 1e-12)).astype(np.float32)

def mag_response(ir, fs):
    L = int(len(ir))
    if L < 8 or not np.isfinite(ir).any():
        return np.array([]), np.array([])
    n = 1 << (L - 1).bit_length()
    F = np.fft.rfft(ir, n=n)
    A = np.abs(F).astype(np.float64)
    A[~np.isfinite(A)] = 0.0
    mag = 20.0 * np.log10(np.maximum(A, 1e-12))
    freqs = np.fft.rfftfreq(n, 1.0 / float(fs))[1:]
    mag   = mag[1:]
    return freqs, mag

# ------------------------------------------------------------------
#  playback helpers
# ------------------------------------------------------------------
def write_temp_wav(stereo, fs):
    td = tempfile.TemporaryDirectory()
    p  = os.path.join(td.name, "sweep.wav")
    sf.write(p, stereo, fs, subtype="PCM_16")
    return td, p

def play_via_aplay(stereo, fs, alsa_device=None):
    td, path = write_temp_wav(stereo, fs)
    try:
        device = alsa_device if alsa_device else "hw:0,0"
        cmd = ["aplay", "-q", "-D", device, path]
        print(f"[SWEEP] running: {' '.join(cmd)}")
        subprocess.run(cmd, check=True, capture_output=True)
        time.sleep(1.0)          # <-- NEW: let ALSA finish
    finally:
        td.cleanup()

def play_via_portaudio(stereo, fs, out_dev=None):
    print(f"[SWEEP] playing on device {out_dev}  name={sd.query_devices(out_dev)['name']}")
    # BLOCKING so we hear the whole sweep
    sd.play(stereo.astype(np.float32, copy=False), fs, device=out_dev, blocking=True)

# ------------------------------------------------------------------
#  file-target helpers
# ------------------------------------------------------------------
def _folder_targets(root: Path, channel: str):
    base = root / channel
    return {
        "sweep": base / "sweep.wav",
        "mic_recording_raw": base / "mic_recording_raw.wav",
        "mic_recording_used": base / "mic_recording_used.wav",
        "impulse": base / "impulse.wav",
        "response_csv": base / "response.csv",
        "impulse_png": base / "impulse_response.png",
        "response_png": base / "response.png",
        "meta_json": base / "meta.json",
    }

def _flat_targets(root: Path, channel: str):
    pfx = f"{channel}-"
    return {
        "sweep": f"{pfx}sweep.wav",
        "mic_recording_raw": f"{pfx}mic_recording_raw.wav",
        "mic_recording_used": f"{pfx}mic_recording_used.wav",
        "impulse": f"{pfx}impulse.wav",
        "response_csv": f"{pfx}response.csv",
        "impulse_png": f"{pfx}impulse_response.png",
        "response_png": f"{pfx}response.png",
        "meta_json": f"{pfx}meta.json",
    }

def _targets_for_layout(root: Path, channel: str, layout: str):
    if layout == "folders":
        return [_folder_targets(root, channel)]
    if layout == "flat":
        return [_flat_targets(root, channel)]
    if layout == "both":
        return [_folder_targets(root, channel), _flat_targets(root, channel)]
    raise ValueError(f"Unknown layout: {layout}")

# ------------------------------------------------------------------
#  single sweep run
# ------------------------------------------------------------------
def run_sweep(session_root, sweep, inv, fs, args, channel_label, stereo_sweep):
    log_base = Path(session_root) / channel_label
    log_base.mkdir(parents=True, exist_ok=True)
    print(f"[SWEEP] entered run_sweep, channel={channel_label}, playback={args.playback}, out_dev={args.out_dev}")

    # 🔥 Tell UI we’re starting this channel
    if channel_label == "left":
        update_status("Left sweep started", 10)
    elif channel_label == "right":
        update_status("Right sweep started", 35)

    try:
        sd.default.samplerate = fs
        total_rec_s = args.prepad + args.dur + args.postpad
        total_frames = int(fs * total_rec_s)

        # --- 1. start recording (pre-pad) ------------------------------------
        update_status(f"Recording {channel_label} mic input…", 12 if channel_label=="left" else 40)
        rec = sd.rec(total_frames, channels=1, dtype="float32", device=args.in_dev, blocking=False)

        print(f"[SWEEP] about to choose playback, args.playback={args.playback}, aplay avail={shutil.which('aplay') is not None}")

        # --- 2. playback ------------------------------------------------------
        update_status(f"Playing {channel_label} test sweep…", 18 if channel_label=="left" else 45)

        if args.playback == "aplay" or (args.playback == "auto" and shutil.which("aplay")):
            play_via_aplay(stereo_sweep, fs, args.alsa_device)
        else:
            play_via_portaudio(stereo_sweep, fs, args.out_dev)

        sd.wait()   # wait for record to finish

        # --- 3. process recording -------------------------------------------
        update_status(f"Processing {channel_label} recording…", 25 if channel_label=="left" else 55)

        rec_raw = np.nan_to_num(np.asarray(rec, dtype=np.float32).flatten())
        rms = float(np.sqrt(np.mean(rec_raw**2))) if rec_raw.size else 0.0
        if rms < 1e-6:
            raise RuntimeError("Recording silent (RMS < 1e-6).")

        start_idx = xcorr_peak_index(rec_raw, sweep)
        end_idx   = min(start_idx + len(sweep) + int(fs * args.postpad), len(rec_raw))
        rec_used  = rec_raw[start_idx:end_idx].copy()

        ir = deconvolve(rec_used, inv)
        freqs, mag = mag_response(ir, fs)

        meta = dict(
            fs=fs, dur=args.dur, f0=args.f0, f1=args.f1,
            in_dev=args.in_dev, out_dev=args.out_dev,
            prepad=args.prepad, postpad=args.postpad,
            playback=args.playback, alsa_device=args.alsa_device,
            sweep_onset_frame=start_idx,
            timestamp=datetime.now().isoformat(),
            channel=channel_label,
            layout=args.layout,
        )

        save_all(session_root, channel_label, fs, sweep, rec_raw, rec_used, ir, freqs, mag, meta, args.layout)
        print(f"Saved {channel_label} in '{session_root}'")

        # 🔥 Tell UI we’re done with this channel
        if channel_label == "left":
            update_status("Left sweep finished", 30)
        else:
            update_status("Right sweep finished", 60)

    except Exception as e:
        update_status(f"ERROR during {channel_label} sweep",  
                      0 if channel_label=="left" else 35,  
                      running=False)
        fail(log_base, e, where=f"sweep_{channel_label}")

# ------------------------------------------------------------------
#  plot + save bundle
# ------------------------------------------------------------------
def save_all(session_root, channel, fs, sweep, rec_raw, rec_used, ir, freqs, mag, meta, layout):
    root = Path(session_root)
    target_sets = _targets_for_layout(root, channel, layout)

    # build CSV text once
    lines = ["freq_hz,mag_db\n"]
    lines += [f"{float(fr):.6f},{float(db):.2f}\n" for fr, db in zip(freqs, mag)]
    csv_text = "".join(lines)

    # IR plot
    try:
        t = np.arange(len(ir)) / float(fs)
        fig_ir = plt.figure(figsize=(9, 4))
        ax = fig_ir.add_subplot(111)
        ax.plot(t, ir)
        ax.set(xlabel="Time (s)", ylabel="Amplitude", title=f"Impulse Response ({channel})")
        ax.grid(True, ls=":")
        fig_ir.tight_layout()
    except Exception:
        fig_ir = None

    # FR plot
    try:
        fig_fr = plt.figure(figsize=(9, 5))
        ax = fig_fr.add_subplot(111)
        ax.semilogx(freqs, mag)
        ax.set(xlabel="Frequency (Hz)", ylabel="Magnitude (dB)", title=f"Frequency Response ({channel})")
        ax.grid(True, which="both", ls=":")
        fig_fr.tight_layout()
    except Exception:
        fig_fr = None

    for targets in target_sets:
        # WAVs
        write_wav_atomic(targets["sweep"], sweep, fs)
        write_wav_atomic(targets["mic_recording_raw"], rec_raw, fs)
        write_wav_atomic(targets["mic_recording_used"], rec_used, fs)
        write_wav_atomic(targets["impulse"], ir, fs)

        # CSV
        write_text_atomic(csv_text, targets["response_csv"])

        # PNGs
        if fig_ir is not None:
            savefig_atomic(fig_ir, targets["impulse_png"], dpi=150)
        if fig_fr is not None:
            savefig_atomic(fig_fr, targets["response_png"], dpi=150)

        # JSON **inside the loop**
        print(f"[DEBUG] save_all called, meta_json={targets['meta_json']}")


    # JSON
    write_json_atomic(meta, targets["meta_json"])

    # close figures
    try:
        if fig_ir: plt.close(fig_ir)
        if fig_fr: plt.close(fig_fr)
    except Exception:
        pass

# ------------------------------------------------------------------
#  CLI entry
# ------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="measurely: left/right/both sweep runner")
    ap.add_argument("--fs", type=int, default=48000)
    ap.add_argument("--dur", type=float, default=8.0)
    ap.add_argument("--f0", type=float, default=20.0)
    ap.add_argument("--f1", type=float, default=20000.0)
    ap.add_argument("--in", dest="in_dev", type=int, default=None)
    ap.add_argument("--out", dest="out_dev", type=int, default=None)
    ap.add_argument("--prepad", type=float, default=1.0)
    ap.add_argument("--postpad", type=float, default=1.5)
    ap.add_argument("--playback", choices=["auto", "aplay", "pa"], default="auto")
    ap.add_argument("--alsa-device", default=None)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--mode", choices=["left", "right", "both"], default="both")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--layout", choices=["folders", "flat", "both"], default="folders",
                    help="Per-channel file output style.")

    args = ap.parse_args()
    if args.list:
        print(sd.query_devices())
        return

    # ------------------------------------------------------------------
    # Load user config BEFORE generating sweep
    # ------------------------------------------------------------------
    latest_meta = Path.home() / "measurely" / "measurements" / "latest" / "meta.json"
    if latest_meta.exists():
        print(f"[SWEEP] loading room config from {latest_meta}")
        user_meta = json.loads(latest_meta.read_text())
        room = user_meta.get("settings", {}).get("room", {})
        room_len = float(room.get("length_m", 4.0))
        speaker_key = room.get("speaker_key")
    else:
        print("[SWEEP] WARNING: no /latest/meta.json found — using defaults")
        room_len = 4.0
        speaker_key = None

    # Tailor sweep duration to room size
    args.dur = max(4.0, room_len * 1.2)

    # Tailor frequency limits to speaker profile
    from measurelyapp.speaker import load_target_curve
    if speaker_key:
        curve = load_target_curve(speaker_key)
        if curve is not None:
            args.f0 = float(curve.x[0])
            args.f1 = float(curve.x[-1])
            print(f"[SWEEP] using {speaker_key} limits {args.f0:.0f} Hz – {args.f1:.0f} Hz")

    # ------------------------------------------------------------------
    # Prepare session + sweep
    # ------------------------------------------------------------------
    fs = 48000
    sweep, inv = gen_log_sweep(fs, args.dur, args.f0, args.f1)
    print(f"[SWEEP] stimulus shape={sweep.shape}  max={sweep.max():.3f}  rms={np.sqrt(np.mean(sweep**2)):.3f}")

    outdir = session_dir()
    Path(outdir).mkdir(parents=True, exist_ok=True)

    write_log(outdir, [
        "IN_DEV_INFO:",  dev_info(args.in_dev, 'input'),
        "OUT_DEV_INFO:", dev_info(args.out_dev, 'output')
    ])

    # ------------------------------------------------------------------
    # Run sweeps
    # ------------------------------------------------------------------
    if args.mode in ("left", "both"):
        run_sweep(outdir, sweep, inv, fs, args, "left", route_to_left(sweep))

    if args.mode in ("right", "both"):
        run_sweep(outdir, sweep, inv, fs, args, "right", route_to_right(sweep))

    # ------------------------------------------------------------------
    # After both channels complete
    # ------------------------------------------------------------------
    try:
        update_status("Analysing results…", 80, True)
    except Exception:
        pass

    try:
        update_status("Sweep complete ✔", 100, False)
    except Exception:
        pass

    print("Saved:", outdir)

    # ------------------------------------------------------------------
    # Update latest/ symlink
    # ------------------------------------------------------------------
    measurements_dir = Path.home() / "measurely" / "measurements"
    latest = measurements_dir / "latest"

    try:
        if latest.exists() or latest.is_symlink():
            latest.unlink()
    except Exception as e:
        print(f"[SWEEP] Couldn't remove old latest symlink: {e}")

    try:
        latest.symlink_to(outdir)
        print(f"[SWEEP] Updated latest -> {outdir}")
    except Exception as e:
        print(f"[SWEEP] Couldn't create latest symlink: {e}")


if __name__ == "__main__":
    main()
