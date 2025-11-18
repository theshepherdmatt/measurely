"""Load CSV / WAV / session folder."""
from pathlib import Path
import csv, soundfile as sf, numpy as np

__all__ = ["load_response_csv", "load_ir", "load_session"]

def load_response_csv(p: Path):
    freq, mag = [], []
    for row in csv.reader(p.read_text().splitlines()):
        if len(row) >= 2:
            try:
                freq.append(float(row[0]))
                mag.append(float(row[1]))
            except ValueError:
                pass
    freq, mag = np.asarray(freq, dtype=float), np.asarray(mag, dtype=float)
    ok = np.isfinite(freq) & np.isfinite(mag) & (freq > 0)
    return freq[ok], mag[ok]

def load_ir(p: Path):
    ir, fs = sf.read(p, dtype="float32", always_2d=False)
    if ir.ndim > 1:
        ir = ir[:, 0]
    ir = np.nan_to_num(ir, nan=0.0, posinf=0.0, neginf=0.0)
    return ir, fs

def load_session(session_dir: Path):
    """Return freq, mag, ir, fs, label  (label='root'|'left'|'right'|'merged')."""
    resp = session_dir / "response.csv"
    imp  = session_dir / "impulse.wav"
    if resp.exists() and imp.exists():
        return *load_response_csv(resp), *load_ir(imp), "root"

    chans = {}
    for ch in ("left", "right"):
        r = session_dir / ch / "response.csv"
        i = session_dir / ch / "impulse.wav"
        if r.exists() and i.exists():
            chans[ch] = (r, i)
    if not chans:
        raise FileNotFoundError("No response.csv + impulse.wav found")

    if len(chans) == 1:
        ch, (rr, ii) = next(iter(chans.items()))
        return *load_response_csv(rr), *load_ir(ii), ch

    # average response, keep left IR
    fl, ml = load_response_csv(chans["left"][0])
    fr, mr = load_response_csv(chans["right"][0])
    common = np.intersect1d(np.round(fl, 2), np.round(fr, 2))
    if common.size == 0:                      # grids differ – fallback to left
        return fl, ml, *load_ir(chans["left"][1]), "left"
    idx_l = {f: i for i, f in enumerate(np.round(fl, 2))}
    idx_r = {f: i for i, f in enumerate(np.round(fr, 2))}
    f_out, m_out = [], []
    for f in common:
        f_out.append(fl[idx_l[f]])
        m_out.append((ml[idx_l[f]] + mr[idx_r[f]]) / 2.0)
    return np.array(f_out), np.array(m_out), *load_ir(chans["left"][1]), "merged"
