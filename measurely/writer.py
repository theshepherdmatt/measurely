"""Atomic file writes + Camilla-DSP YAML."""
import tempfile, os, json, textwrap
from pathlib import Path

__all__ = ["_atomic_write", "write_text_summary", "yaml_camilla"]

def _atomic_write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
        tmp = Path(f.name)
    tmp.replace(path)
    print(f"saved  {path}  ({len(text.encode())} bytes)")

def plain_summary(res: dict) -> tuple[str, list[str]]:
    bands = res.get("band_levels_db", {})
    one, fix = "All good. Nothing scary showed up.", []

    if (bands.get("bass_20_200", 0) - bands.get("mid_200_2k", 0)) > 4:
        one, fix = "Bass strong vs mids", ["Pull speakers 10-20 cm from wall"]

    if res.get("reflections_ms"):
        one, fix = "Early reflections detected", ["Add rug / side-wall panels"]

    if (res.get("rt60_s") or 0) > 0.6:
        one = "Room a bit echoey"

    return one, fix[:3]

def write_text_summary(outdir: Path, res):
    one, fix = plain_summary(res)
    lines = ["Simple result", "-------------", one, ""]
    if fix:
        lines += ["What to do next", "---------------"] + [f"- {f}" for f in fix] + [""]
    lines += [f"Bandwidth  : {res['scores']['bandwidth']}/10",
              f"Balance    : {res['scores']['balance']}/10",
              f"Peaks/Dips : {res['scores']['peaks_dips']}/10",
              f"Smoothness : {res['scores']['smoothness']}/10",
              f"Reflections: {res['scores']['reflections']}/10",
              f"Reverb     : {res['scores']['reverb']}/10",
              f"Overall    : {res['scores']['overall']}/10", ""]
    _atomic_write(outdir / "summary.txt", "\n".join(lines))

def peq_bands(res, max_bands=4):
    bands = []
    for m in sorted(res["modes"], key=lambda x: -abs(x["delta_db"]))[:max_bands*2]:
        f = m["freq_hz"]
        if f < 15 or f > 500:
            continue
        gain = -m["delta_db"]
        gain = max(-6, min(6, gain))
        q = 5 if f < 150 else 3.5
        bands.append({"f": round(f, 1), "q": round(q, 2), "gain": round(gain, 2)})
        if len(bands) >= max_bands:
            break
    return bands or [{"f": 100, "q": 1, "gain": 0}]

def yaml_camilla(res, target="moode", fs=48000):
    bands = peq_bands(res)
    names = ", ".join([f"peq{i+1}" for i in range(len(bands))])
    filt_lines = "\n".join([
        f"  peq{i+1}:\n    type: Biquad\n    parameters:\n"
        f"      type: Peaking\n      freq: {b['f']}\n      Q: {b['q']}\n      gain: {b['gain']}"
        for i, b in enumerate(bands)
    ])
    pre = -4 if target == "moode" else -5
    return textwrap.dedent(f"""\
        title: Measurely auto-peq
        devices:
          samplerate: {fs}
          capture:
            type: Stdin
            channels: 2
            format: S24LE
          playback:
            type: Alsa
            channels: 2
            device: hw:0,0
            format: S24LE
        filters:
          pre:
            type: Gain
            parameters: {{gain: {pre}}}
        {filt_lines}
        pipeline:
          - type: Filter
            channels: [0,1]
            names: [pre]
          - type: Filter
            channels: [0]
            names: [{names}]
          - type: Filter
            channels: [1]
            names: [{names}]
    """)
