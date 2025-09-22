#!/usr/bin/env python3
import sys, os, subprocess, threading, queue, sounddevice as sd, tkinter as tk
from tkinter import ttk, messagebox, scrolledtext, filedialog

APP_TITLE = "Measurely"
DEFAULT_ALSA = "hw:2,0"   # Force HiFiBerry by default
DEFAULT_BACKEND = "aplay" # or "pa"

# ---------------- Device helpers ----------------
def list_devices_safe():
    try:
        return sd.query_devices()
    except Exception as e:
        print("Device query failed:", e)
        return []

def pick_input_index():
    devs = list_devices_safe()
    umik_idx = first_in = None
    umik_name = first_name = "unknown"
    for i, d in enumerate(devs):
        ins = d.get("max_input_channels", 0) or 0
        name = (d.get("name") or "")
        if ins > 0 and first_in is None:
            first_in, first_name = i, name
        if ins > 0 and "umik" in name.lower():
            umik_idx, umik_name = i, name
    return (umik_idx if umik_idx is not None else first_in,
            umik_name if umik_idx is not None else first_name)

def pick_output_index():
    devs = list_devices_safe()
    hat_idx = pulse_idx = first_out = None
    hat_name = pulse_name = first_name = "unknown"
    for i, d in enumerate(devs):
        outs = d.get("max_output_channels", 0) or 0
        name = (d.get("name") or "")
        lname = name.lower()
        if outs > 0 and first_out is None:
            first_out, first_name = i, name
        if outs > 0 and any(k in lname for k in ("hifiberry","snd_rpi_hifiberry","pcm512","pcm510","es9023","i2s","dac")):
            hat_idx, hat_name = i, name
        if outs > 0 and ("pulse" in lname or lname in ("default","sysdefault")):
            pulse_idx, pulse_name = i, name
    if hat_idx is not None:  return hat_idx, hat_name
    if pulse_idx is not None: return pulse_idx, pulse_name
    return first_out, first_name

def detect_hifiberry_alsa_fallback():
    """Return ALSA device string like 'hw:2,0' if HiFiBerry is present, else DEFAULT_ALSA."""
    try:
        out = subprocess.check_output(["aplay","-l"], text=True, stderr=subprocess.STDOUT)
        # Find a line like: card 2: sndrpihifiberry [...], device 0:
        card = dev = None
        for ln in out.splitlines():
            ln = ln.strip()
            if "sndrpihifiberry" in ln or "HifiBerry" in ln or "hifiberry" in ln.lower():
                # parse numbers
                parts = ln.split()
                # "card", "2:", ..., "device", "0:"
                for i,p in enumerate(parts):
                    if p == "card" and i+1 < len(parts):
                        try: card = int(parts[i+1].rstrip(":"))
                        except: pass
                    if p == "device" and i+1 < len(parts):
                        try: dev = int(parts[i+1].rstrip(":"))
                        except: pass
                break
        if card is not None and dev is not None:
            return f"hw:{card},{dev}"
    except Exception:
        pass
    return DEFAULT_ALSA

# ---------------- UI helpers ----------------
class RunWorker(threading.Thread):
    def __init__(self, cmd, cwd, line_queue):
        super().__init__(daemon=True)
        self.cmd = cmd
        self.cwd = cwd
        self.q = line_queue
        self.proc = None
        self.rc = None

    def run(self):
        try:
            self.proc = subprocess.Popen(self.cmd, cwd=self.cwd, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True)
            for line in self.proc.stdout:
                self.q.put(line.rstrip("\n"))
            self.proc.stdout.close()
            self.rc = self.proc.wait()
        except Exception as e:
            self.q.put(f"[ERROR] {e}")
            self.rc = -1
        finally:
            self.q.put(None)  # sentinel

# ---------------- GUI ----------------
class MeasurelyGUI:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("980x620")

        self.in_idx, self.in_name = pick_input_index()
        self.out_idx, self.out_name = pick_output_index()
        self.alsa_dev = detect_hifiberry_alsa_fallback()
        self.backend = tk.StringVar(value=DEFAULT_BACKEND)
        self.prepad  = tk.StringVar(value="0.5")
        self.postpad = tk.StringVar(value="1.0")
        self.fs      = tk.StringVar(value="48000")
        self.dur     = tk.StringVar(value="8.0")

        self.last_saved_dir = None

        # Header
        hdr = ttk.Frame(root)
        hdr.pack(fill="x", padx=12, pady=8)
        ttk.Label(hdr, text="Measurely", font=("Arial", 24, "bold")).pack(side="left")
        self.status = tk.StringVar(value="Ready")
        ttk.Label(hdr, textvariable=self.status).pack(side="right")

        # Settings frame
        settings = ttk.LabelFrame(root, text="Settings")
        settings.pack(fill="x", padx=12, pady=6)

        def add_row(r, lbl, widget):
            ttk.Label(settings, text=lbl).grid(row=r, column=0, sticky="w", padx=6, pady=4)
            widget.grid(row=r, column=1, sticky="we", padx=6, pady=4)

        self.in_lbl  = ttk.Label(settings, text=f"{self.in_idx} – {self.in_name}")
        self.out_lbl = ttk.Label(settings, text=f"{self.out_idx} – {self.out_name}")
        add_row(0, "Input (mic):", self.in_lbl)
        add_row(1, "Output (DAC):", self.out_lbl)

        self.alsa_entry = ttk.Entry(settings)
        self.alsa_entry.insert(0, self.alsa_dev)
        add_row(2, "ALSA device:", self.alsa_entry)

        self.backend_cb = ttk.Combobox(settings, textvariable=self.backend, values=["aplay", "pa"], state="readonly", width=10)
        add_row(3, "Playback backend:", self.backend_cb)

        grids = [
            ("Sample rate (Hz):", self.fs),
            ("Sweep duration (s):", self.dur),
            ("Prepad (s):", self.prepad),
            ("Postpad (s):", self.postpad),
        ]
        for i,(label,var) in enumerate(grids, start=4):
            e = ttk.Entry(settings, textvariable=var, width=10)
            add_row(i, label, e)

        settings.columnconfigure(1, weight=1)

        # Buttons
        btns = ttk.Frame(root)
        btns.pack(fill="x", padx=12, pady=6)
        self.run_btn   = ttk.Button(btns, text="Run sweep + analyse", command=self.on_run)
        self.open_btn  = ttk.Button(btns, text="Open last session folder", command=self.open_last, state="disabled")
        self.sum_btn   = ttk.Button(btns, text="Open last summary", command=self.open_summary, state="disabled")
        self.run_btn.pack(side="left", padx=4)
        self.open_btn.pack(side="left", padx=4)
        self.sum_btn.pack(side="left", padx=4)

        # Output area
        self.out_box = scrolledtext.ScrolledText(root, wrap="word", font=("Courier New", 10))
        self.out_box.pack(fill="both", expand=True, padx=12, pady=8)
        self.out_box.insert("end", "Logs will appear here...\n")
        self.out_box.configure(state="disabled")

        # Footer
        foot = ttk.Frame(root)
        foot.pack(fill="x", padx=12, pady=6)
        ttk.Button(foot, text="Rescan devices", command=self.rescan).pack(side="left")

        # Async line queue
        self.line_q = queue.Queue()
        self.worker = None
        self.root.after(100, self.drain_lines)

    def append_log(self, line):
        self.out_box.configure(state="normal")
        self.out_box.insert("end", line + "\n")
        self.out_box.see("end")
        self.out_box.configure(state="disabled")

    def rescan(self):
        self.in_idx, self.in_name = pick_input_index()
        self.out_idx, self.out_name = pick_output_index()
        self.in_lbl.config(text=f"{self.in_idx} – {self.in_name}")
        self.out_lbl.config(text=f"{self.out_idx} – {self.out_name}")
        self.alsa_dev = detect_hifiberry_alsa_fallback()
        self.alsa_entry.delete(0, "end")
        self.alsa_entry.insert(0, self.alsa_dev)
        self.append_log("[info] Devices rescanned.")

    def build_cmd(self):
        # Always call the orchestrator so we get analysis + summary
        cmd = [
            sys.executable, "measurely_main.py",
            "--backend", self.backend.get()
        ]
        if self.in_idx is not None:
            cmd += ["--in", str(self.in_idx)]
        if self.out_idx is not None:
            cmd += ["--out", str(self.out_idx)]
        # Pass core params through; orchestrator forwards to sweep
        cmd += ["--prepad", self.prepad.get(), "--postpad", self.postpad.get(), "--dur", self.dur.get(), "--fs", self.fs.get()]

        # If using aplay, include ALSA device
        if self.backend.get() == "aplay":
            alsa = self.alsa_entry.get().strip() or DEFAULT_ALSA
            cmd += ["--alsa-device", alsa]
        return cmd

    def on_run(self):
        if self.worker and self.worker.is_alive():
            messagebox.showinfo(APP_TITLE, "A run is already in progress.")
            return
        self.status.set("Running…")
        self.run_btn.config(state="disabled")
        self.out_box.configure(state="normal")
        self.out_box.delete("1.0", "end")
        self.out_box.configure(state="disabled")

        cmd = self.build_cmd()
        self.append_log(f"[cmd] {' '.join(cmd)}")
        self.worker = RunWorker(cmd, os.getcwd(), self.line_q)
        self.worker.start()

    def drain_lines(self):
        try:
            while True:
                item = self.line_q.get_nowait()
                if item is None:
                    # process ended
                    rc = self.worker.rc if self.worker else -1
                    self.status.set("Done" if rc == 0 else f"Error (rc={rc})")
                    self.run_btn.config(state="normal")
                    # parse Saved: path from the captured output in the box
                    text = self.out_box.get("1.0", "end")
                    saved = None
                    for ln in text.splitlines():
                        if ln.startswith("Saved:"):
                            saved = ln.split("Saved:",1)[1].strip()
                    if saved and os.path.isdir(saved):
                        self.last_saved_dir = saved
                        self.open_btn.config(state="normal")
                        # summary present?
                        if os.path.isfile(os.path.join(saved, "summary.txt")):
                            self.sum_btn.config(state="normal")
                    break
                else:
                    self.append_log(item)
        except queue.Empty:
            pass
        finally:
            self.root.after(100, self.drain_lines)

    def open_last(self):
        if not self.last_saved_dir:
            messagebox.showinfo(APP_TITLE, "No session yet.")
            return
        try:
            subprocess.Popen(["xdg-open", self.last_saved_dir])
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Failed to open folder:\n{e}")

    def open_summary(self):
        if not self.last_saved_dir:
            messagebox.showinfo(APP_TITLE, "No session yet.")
            return
        path = os.path.join(self.last_saved_dir, "summary.txt")
        if not os.path.isfile(path):
            messagebox.showinfo(APP_TITLE, "summary.txt not found.")
            return
        try:
            subprocess.Popen(["xdg-open", path])
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Failed to open summary:\n{e}")

# ---------------- main ----------------
if __name__ == "__main__":
    root = tk.Tk()
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass
    app = MeasurelyGUI(root)
    root.mainloop()
