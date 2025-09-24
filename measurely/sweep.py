#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Measurely – headless sweep runner (SSH-friendly, atomic writes)

- Records slightly BEFORE playback to avoid missing the sweep start.
- Detects true sweep onset via cross-correlation; trims pre-roll.
- Deconvolves to impulse response; derives magnitude response.
- Very verbose console logging for SSH runs (use --verbose).
- Saves a complete artefact set (wav, csv, pngs, json) per run.
- All artefacts are written ATOMICALLY to avoid 0-byte files.
"""

import os, sys, json, uuid, argparse, subprocess, shutil, tempfile, signal, time
from datetime import datetime
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf
from scipy.signal import fftconvolve

# Headless-safe plotting (works over SSH)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ---------------------- utils / logging ----------------------
def session_dir() -> str:
    root = Path.home() / "Measurely" / "measurements"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    return str(root / stamp)

def write_log(outdir, lines):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / "debug.txt"
    text = ""
    if isinstance(lines, (list, tuple)):
        for ln in lines:
            text += f"{str(ln).rstrip()}\n"
    else:
        text = f"{str(lines).rstrip()}\n"
    # append is fine for a log; if it fails we don't crash the run
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)
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


# ---------------------- atomic I/O helpers ----------------------
def _atomic_write_bytes(data: bytes, dest: Path):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=str(dest.parent), delete=False) as tf:
        tf.write(data)
        tf.flush()
        os.fsync(tf.fileno())
        tmp = tf.name
    os.replace(tmp, dest)

def write_text_atomic(text: str, dest: Path):
    _atomic_write_bytes(text.encode("utf-8"), Path(dest))

def write_json_atomic(obj, dest: Path):
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    _atomic_write_bytes(payload, Path(dest))

def savefig_atomic(fig, dest: Path, **kwargs):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # save to tmp then atomically replace
    with tempfile.NamedTemporaryFile(dir=str(dest.parent), suffix=dest.suffix, delete=False) as tf:
        tmp = tf.name
    try:
        fig.savefig(tmp, **kwargs)
        # fsync written bytes
        with open(tmp, "rb") as rf:
            os.fsync(rf.fileno())
        os.replace(tmp, dest)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        plt.close(fig)

def write_wav_atomic(dest: Path, data, fs: int):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=str(dest.parent), suffix=".wav", delete=False) as tf:
        tmp = tf.name
    try:
        sf.write(tmp, data, fs)
        with open(tmp, "rb") as rf:
            os.fsync(rf.fileno())
        os.replace(tmp, dest)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


# graceful Ctrl+C / kill -TERM
def _graceful_stop(sig, _frame):
    try:
        sd.stop()
    finally:
        code = 130 if sig == signal.SIGINT else 143
        sys.exit(code)

signal.signal(signal.SIGINT, _graceful_stop)
signal.signal(signal.SIGTERM, _graceful_stop)


# ---------------------- sweep / DSP ----------------------
def gen_log_sweep(fs=48000, dur=8.0, f0=20.0, f1=20000.0):
    """
    Generate an exponential (log) sweep and its inverse per Farina.
    """
    t = np.linspace(0, dur, int(fs * dur), endpoint=False, dtype=np.float64)
    K = dur / np.log(f1 / f0)
    # phase(t) = 2π f0 K (e^{t/K} - 1)
    phase = 2.0 * np.pi * f0 * K * (np.exp(t / K) - 1.0)
    sweep = np.sin(phase).astype(np.float32)
    sweep /= np.max(np.abs(sweep)) + 1e-12
    sweep *= 0.7  # headroom

    # Inverse filter for deconvolution (time-reverse + amplitude weighting)
    inv = sweep[::-1].astype(np.float64)
    w = np.exp(t / K)  # amplitude correction
    inv = (inv / w).astype(np.float32)
    return sweep, inv

def xcorr_peak_index(rec, ref):
    """
    Find the start of 'ref' (sweep) inside 'rec' using FFT cross-correlation.
    Returns index in 'rec' where the best alignment occurs (>=0).
    """
    c = fftconvolve(rec, ref[::-1], mode="full")
    k = int(np.argmax(np.abs(c)))
    start_idx = k - (len(ref) - 1)
    return max(0, start_idx)

def deconvolve(y, inv):
    """
    Recover impulse response from recording 'y' and inverse filter 'inv'.
    """
    ir = fftconvolve(y, inv, mode="full")
    p = int(np.argmax(np.abs(ir)))
    s = max(p - 2048, 0)                # back up before peak
    ir = ir[s : s + len(y)]             # window to length of input
    peak = np.max(np.abs(ir)) + 1e-12
    ir = (ir / peak).astype(np.float32) # normalise
    return ir

def mag_response(ir, fs):
    """Magnitude response (dB) from impulse response."""
    L = int(len(ir))
    if L < 8 or not np.isfinite(ir).any():
        return np.array([]), np.array([])
    n = 1
    while n < L:
        n <<= 1
    F = np.fft.rfft(ir, n=n)
    A = np.abs(F).astype(np.float64)
    A[~np.isfinite(A)] = 0.0
    mag = 20.0 * np.log10(np.maximum(A, 1e-12))
    freqs = np.fft.rfftfreq(n, 1.0 / float(fs))
    if freqs.size > 1:
        freqs = freqs[1:]
        mag   = mag[1:]
    m = np.isfinite(freqs) & np.isfinite(mag)
    return freqs[m], mag[m]


# ---------------------- robust playback ----------------------
def write_temp_wav(stereo, fs):
    td = tempfile.TemporaryDirectory()
    p = os.path.join(td.name, "sweep.wav")
    sf.write(p, stereo, fs, subtype="PCM_16")
    return td, p

def play_via_aplay(stereo, fs, alsa_device=None):
    """
    Play using 'aplay' to let ALSA/Pulse do routing/resampling. Blocks until done.
    """
    td, path = write_temp_wav(stereo, fs)
    try:
        cmd = ["aplay", "-q"]
        if alsa_device:
            cmd += ["-D", alsa_device]
        cmd += [path]
        subprocess.run(cmd, check=True)
    finally:
        td.cleanup()

def play_via_portaudio(stereo, fs, out_dev=None):
    sd.play(stereo.astype(np.float32, copy=False), fs, device=out_dev, blocking=True)

def make_stereo(x):
    return np.column_stack([x, x]) if x.ndim == 1 else x[:, :2]


# ---------------------- saving / plotting ----------------------
def save_all(outdir, fs, sweep, rec_raw, rec_used, ir, freqs, mag, meta):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

    # WAVs
    write_wav_atomic(out / "sweep.wav", sweep, fs)
    write_wav_atomic(out / "mic_recording_raw.wav", rec_raw, fs)
    write_wav_atomic(out / "mic_recording_used.wav", rec_used, fs)
    write_wav_atomic(out / "impulse.wav", ir, fs)

    # CSV (always at least a header)
    lines = ["freq_hz,mag_db\n"]
    if freqs.size and mag.size:
        n = int(min(freqs.size, mag.size))
        for fr, db in zip(freqs[:n], mag[:n]):
            lines.append(f"{float(fr):.6f},{float(db):.2f}\n")
    write_text_atomic("".join(lines), out / "response.csv")

    # 1) Impulse response plot
    try:
        t = np.arange(len(ir)) / float(fs) if len(ir) else np.array([0.0, 1.0])
        fig = plt.figure(figsize=(9, 4))
        ax = fig.add_subplot(111)
        if len(ir):
            ax.plot(t, ir)
        else:
            ax.text(0.5, 0.5, "No IR data", ha="center", va="center", transform=ax.transAxes)
        ax.set_xlabel("Time (s)"); ax.set_ylabel("Amplitude")
        ax.set_title("Measurely – Impulse Response"); ax.grid(True, ls=":")
        fig.tight_layout()
        savefig_atomic(fig, out / "impulse_response.png", dpi=150)
    except Exception as e:
        write_log(outdir, f"Plot IR failed: {e}")

    # 2) Frequency response plot
    try:
        nyq = max(1.0, fs/2.0)
        fl  = 20.0 if nyq >= 40.0 else max(0.5, nyq/10.0)

        msk_all = (freqs > 0) & np.isfinite(freqs) & np.isfinite(mag)
        fx_all, mx_all = freqs[msk_all], mag[msk_all]
        msk = msk_all & (freqs >= fl) & (freqs <= nyq)
        fx, mx = freqs[msk], mag[msk]

        fig = plt.figure(figsize=(9, 5))
        ax = fig.add_subplot(111)
        if fx.size > 0:
            ax.semilogx(fx, mx)
            lo, hi = np.percentile(mx, [5, 95])
            pad = max(3.0, 0.1*(hi-lo))
            ax.set_ylim(lo - pad, hi + pad)
            ax.set_xlim(fl, nyq)
        elif fx_all.size > 0:
            ax.semilogx(fx_all, mx_all)
            ax.set_xlim(max(0.5, float(fx_all.min())), float(fx_all.max()))
        else:
            ax.text(0.5, 0.5, "No finite data to plot", ha="center", va="center", transform=ax.transAxes)
        ax.grid(True, which="both", ls=":")
        ax.set_xlabel("Frequency (Hz)"); ax.set_ylabel("Magnitude (dB)")
        ax.set_title("Measurely – Frequency Response")
        fig.tight_layout()
        savefig_atomic(fig, out / "response.png", dpi=150)
    except Exception as e:
        write_log(outdir, f"Plot FR failed: {e}")

    # Meta + debug JSON (atomic)
    write_json_atomic(meta, out / "meta.json")

    dbg = {
        "fs": fs,
        "nyquist": float(fs/2.0),
        "rec_raw_len": int(len(rec_raw)),
        "rec_used_len": int(len(rec_used)),
        "rec_raw_rms": float(np.sqrt(np.mean(rec_raw**2))) if rec_raw.size else None,
        "rec_used_rms": float(np.sqrt(np.mean(rec_used**2))) if rec_used.size else None,
        "ir_len": int(len(ir)),
        "ir_peak": float(np.max(np.abs(ir))) if ir.size else None,
        "freq_points": int(int(np.isfinite(freqs).sum()) if freqs.size else 0),
        "low_cut_used_hz": float(20.0 if (fs/2.0) >= 40.0 else max(0.5, (fs/2.0)/10.0)),
        "freq_min": float(np.nanmin(freqs)) if freqs.size else None,
        "freq_max": float(np.nanmax(freqs)) if freqs.size else None,
    }
    write_json_atomic(dbg, out / "debug_stats.json")


# ---------------------- CLI ----------------------
def main():
    ap = argparse.ArgumentParser(description="Measurely: simple room sweep → response (SSH-friendly)")
    ap.add_argument("--fs", type=int, default=48000)
    ap.add_argument("--dur", type=float, default=8.0)
    ap.add_argument("--f0", type=float, default=20.0)
    ap.add_argument("--f1", type=float, default=20000.0)
    ap.add_argument("--in", dest="in_dev", type=int, default=None, help="Input device index")
    ap.add_argument("--out", dest="out_dev", type=int, default=None, help="Output device index")
    ap.add_argument("--list", action="store_true", help="List audio devices and exit")

    # Headless control / capture windows
    ap.add_argument("--prepad", type=float, default=1.0, help="Seconds to record before sweep (safety pre-roll)")
    ap.add_argument("--postpad", type=float, default=1.5, help="Seconds to record after sweep (tail for IR)")

    # Playback routing
    ap.add_argument("--playback", choices=["auto", "aplay", "pa"], default="auto",
                    help="auto: prefer aplay if available, else PortAudio; 'aplay' or 'pa' to force")
    ap.add_argument("--alsa-device", default=None,
                    help="e.g. hw:2,0 for aplay (if omitted, aplay's default)")

    # Verbose console
    ap.add_argument("--verbose", action="store_true", help="Print detailed progress to stdout")

    args = ap.parse_args()

    if args.list:
        print(sd.query_devices())
        sys.exit(0)

    # For typical UMIK-1 flows; DAC can resample.
    fs = 48000 if not args.fs else int(args.fs)
    fs = 48000  # harden to 48k to reduce surprises on RPi + UMIK-1

    sweep, inv = gen_log_sweep(fs, args.dur, args.f0, args.f1)

    outdir = session_dir()
    Path(outdir).mkdir(parents=True, exist_ok=True)
    log_print(outdir, "=== Measurely run start ===", verbose=args.verbose)
    log_print(outdir, f"Outdir: {outdir}", verbose=args.verbose)
    log_print(outdir, f"Params: fs={fs} dur={args.dur} f0={args.f0} f1={args.f1}", verbose=args.verbose)
    log_print(outdir, f"Devices: in={args.in_dev} out={args.out_dev}", verbose=args.verbose)
    write_log(outdir, ["IN_DEV_INFO:", dev_info(args.in_dev, 'input'),
                       "OUT_DEV_INFO:", dev_info(args.out_dev, 'output')])

    try:
        sd.default.samplerate = fs

        total_rec_s = float(args.prepad + args.dur + args.postpad)
        total_frames = int(fs * total_rec_s)
        log_print(outdir, f"Recording window: {total_rec_s:.2f}s ({total_frames} frames)", verbose=args.verbose)

        # Start recording FIRST (non-blocking) to capture any playback start latency.
        rec = sd.rec(total_frames, channels=1, dtype="float32",
                     device=args.in_dev, blocking=False)
        log_print(outdir, "Recording started...", verbose=args.verbose)

        # Play the sweep (blocking) while recording runs in background.
        stereo = make_stereo(sweep)

        use_aplay = (args.playback == "aplay") or (args.playback == "auto" and shutil.which("aplay") is not None)
        t0 = time.time()
        if use_aplay:
            log_print(outdir, "Playback via aplay...", verbose=args.verbose)
            try:
                play_via_aplay(stereo, fs, args.alsa_device)
            except Exception as e:
                log_print(outdir, f"aplay failed ({e}); falling back to PortAudio.", verbose=args.verbose)
                play_via_portaudio(stereo, fs, args.out_dev)
        else:
            log_print(outdir, "Playback via PortAudio...", verbose=args.verbose)
            play_via_portaudio(stereo, fs, args.out_dev)
        t1 = time.time()
        log_print(outdir, f"Playback done in {t1 - t0:.3f}s", verbose=args.verbose)

        # Wait for the recording to finish capturing the post-roll
        sd.wait()
        log_print(outdir, "Recording finished.", verbose=args.verbose)

        # Sanitize any junk values from the driver
        rec_raw = np.asarray(rec, dtype=np.float32).flatten()
        rec_raw = np.nan_to_num(rec_raw, nan=0.0, posinf=0.0, neginf=0.0)

        # Bail if effectively silent
        rms = float(np.sqrt(np.mean(rec_raw**2))) if rec_raw.size else 0.0
        log_print(outdir, f"Raw recording RMS: {rms:.6e}", verbose=args.verbose)
        if rms < 1e-6:
            raise RuntimeError("Recording silent (RMS < 1e-6). Check mic index, gain, or amp volume.")

        # Align and trim: find where the sweep actually starts in the raw capture
        start_idx = xcorr_peak_index(rec_raw, sweep)
        log_print(outdir, f"Sweep onset estimated at frame {start_idx} (~{start_idx/fs:.3f}s)", verbose=args.verbose)
        use_len = len(sweep) + int(fs * args.postpad)
        end_idx = min(start_idx + use_len, len(rec_raw))
        rec_used = rec_raw[start_idx:end_idx].copy()

        # Process & save
        ir = deconvolve(rec_used, inv)
        freqs, mag = mag_response(ir, fs)
        write_log(outdir, [f"ir_len={len(ir)}",
                           f"ir_peak={float(np.max(np.abs(ir))) if ir.size else None}",
                           f"freq_pts={len(freqs)}",
                           f"freq_min={float(freqs.min()) if len(freqs) else None}",
                           f"freq_max={float(freqs.max()) if len(freqs) else None}"])

        meta = dict(
            fs=fs, dur=args.dur, f0=args.f0, f1=args.f1,
            in_dev=args.in_dev, out_dev=args.out_dev,
            prepad=args.prepad, postpad=args.postpad,
            playback=("aplay" if use_aplay else "portaudio"),
            alsa_device=args.alsa_device,
            sweep_onset_frame=int(start_idx),
            timestamp=datetime.now().isoformat()
        )

        save_all(outdir, fs, sweep, rec_raw, rec_used, ir, freqs, mag, meta)
        log_print(outdir, "Saved artefacts.", verbose=args.verbose)

        # GUI watches stdout for this exact line:
        print("Saved:", outdir)

        log_print(outdir, "=== Measurely run end ===", verbose=args.verbose)

    except Exception as e:
        fail(outdir, e, where="main")


if __name__ == "__main__":
    main()
