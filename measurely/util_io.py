from pathlib import Path
import json, os, tempfile, logging

log = logging.getLogger("measurely")

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
    log.info("Wrote %s (%d bytes)", dest, len(text.encode("utf-8")))

def write_json_atomic(obj, dest: Path):
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    _atomic_write_bytes(payload, Path(dest))
    log.info("Wrote %s (%d bytes)", dest, len(payload))
