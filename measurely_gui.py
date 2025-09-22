import sys, subprocess, sounddevice as sd, tkinter as tk
from tkinter import messagebox, scrolledtext
import os

last_saved_dir = None

# --- Device pickers (prefer HiFiBerry HAT → Pulse/default → first available) ---
def pick_output_index():
    try:
        devs = sd.query_devices()
    except Exception as e:
        print("Device query failed:", e)
        return None, "unknown"

    hat_idx = pulse_idx = first_out = None
    hat_name = pulse_name = first_name = "unknown"

    for i, d in enumerate(devs):
        outs = d.get("max_output_channels", 0)
        name = d.get("name", "")
        lname = name.lower()
        if outs > 0 and first_out is None:
            first_out, first_name = i, name
        if outs > 0 and any(k in lname for k in ("hifiberry", "snd_rpi_hifiberry", "pcm512", "pcm510", "es9023", "i2s", "dac")):
            hat_idx, hat_name = i, name
        if outs > 0 and ("pulse" in lname or lname in ("default", "sysdefault")):
            pulse_idx, pulse_name = i, name

    if hat_idx is not None:
        return hat_idx, hat_name
    if pulse_idx is not None:
        return pulse_idx, pulse_name
    return first_out, first_name

def pick_input_index():
    try:
        devs = sd.query_devices()
    except Exception as e:
        print("Device query failed:", e)
        return None, "unknown"

    umik_idx = first_in = None
    umik_name = first_name = "unknown"

    for i, d in enumerate(devs):
        ins = d.get("max_input_channels", 0)
        name = d.get("name", "")
        if ins > 0 and first_in is None:
            first_in, first_name = i, name
        if ins > 0 and "umik" in name.lower():
            umik_idx, umik_name = i, name

    return (umik_idx, umik_name) if umik_idx is not None else (first_in, first_name)

def show_output_window(text):
    win = tk.Toplevel(root)
    win.title("Measurely – run output")
    win.geometry("900x500")
    box = scrolledtext.ScrolledText(win, wrap="word", font=("Courier New", 10))
    box.pack(fill="both", expand=True)
    box.insert("end", text if text else "(no output)")
    box.configure(state="disabled")

# --- Actions ---
def run_sweep():
    global last_saved_dir
    out_idx, out_name = pick_output_index()
    in_idx,  in_name  = pick_input_index()

    if out_idx is None:
        messagebox.showerror("Measurely", "No output device found."); return
    if in_idx is None:
        messagebox.showerror("Measurely", "No input (mic) found."); return

    status.set(f"Using IN {in_idx}: {in_name}  |  OUT {out_idx}: {out_name}")
    root.update_idletasks()

    btn.config(state="disabled"); status.set("Running sweep…"); root.update_idletasks()

    # Force verbose so the SSH/GUI user sees detailed steps.
    # You can also add --alsa-device hw:2,0 if you want to force a specific card.
    cmd = [
        sys.executable, "measurely_sweep.py",
        "--in", str(in_idx),
        "--out", str(out_idx),
        "--verbose",
        "--playback", "auto",
        "--prepad", "1.0",
        "--postpad", "1.5"
    ]

    try:
        out = subprocess.check_output(cmd, cwd=".", stderr=subprocess.STDOUT, text=True)
        # Show the captured console log in a window
        show_output_window(out)

        saved = None
        for line in out.splitlines():
            if line.startswith("Saved:"):
                saved = line.split("Saved:", 1)[1].strip()
                break
        if saved and os.path.isdir(saved):
            last_saved_dir = saved
            status.set(f"Saved: {saved}")
            open_btn.config(state="normal")
        else:
            status.set("Done, but couldn’t read save path.")
    except subprocess.CalledProcessError as e:
        print(e.output)
        show_output_window(e.output)
        status.set("Error. See output window.")
        messagebox.showerror("Measurely", "Sweep failed. See run output.")
    finally:
        btn.config(state="normal")

def open_last():
    if not last_saved_dir:
        messagebox.showinfo("Measurely", "No previous result yet."); return
    subprocess.Popen(["xdg-open", last_saved_dir])

# --- UI ---
root = tk.Tk()
root.title("Measurely")
root.geometry("900x360")

tk.Label(root, text="Measurely", font=("Arial", 28, "bold")).pack(pady=10)
status = tk.StringVar(value="Ready")
tk.Label(root, textvariable=status, font=("Arial", 12)).pack(pady=10)

btn = tk.Button(root, text="Run sweep", font=("Arial", 20, "bold"), command=run_sweep)
btn.pack(pady=6)

open_btn = tk.Button(root, text="Show last result", font=("Arial", 14), command=open_last, state="disabled")
open_btn.pack(pady=6)

root.mainloop()
