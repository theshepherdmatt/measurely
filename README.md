© 2025 Matt Shepherd. All rights reserved.

Measurely is an original work created and maintained by Matt Shepherd.
This repository contains proprietary configuration, DSP presets, analysis
logic, UI design, and supporting assets that represent significant original
development work. While the core code is licensed under the MIT Licence, all
rights in brand identity, naming, artwork, icons, and documentation remain
with the author.

# Measurely  
**Speaker & room measurement toolkit** – head-less Raspberry Pi edition  

## What it does  
- Generates **log-sweep test signals** and records room response  
- Calculates frequency/phase response, distortion, RT60, etc.  
- Serves a **web dashboard** (Flask) on port **5000** – no GUI needed  
- **One-command installer** – flash SD, boot, browse, measure  

## Flash-and-go install (Raspberry Pi OS 64-bit)  
```bash
sudo apt update && sudo apt -y install git
git clone https://github.com/theshepherdmatt/measurely.git
cd measurely
sudo ./install.sh
sudo reboot
```  
Browse to `http://<pi-ip>:5000` and start measuring.

## First-contact Wi-Fi setup (no keyboard/monitor)  
1. Power-on the Pi **without Ethernet/Wi-Fi**  
2. Connect phone/PC to **“measurely-setup”** AP  
3. Portal pops up → enter your SSID/password → Pi reboots and joins  
4. Browse to `http://<new-ip>:5001` – done.

## Web UI quick tour  
- **Sweep**: set length, level, click **Run**  
- **Results**: frequency response, THD, RT60, waterfall  
- **Export**: CSV, PNG, or JSON for further analysis  

## CLI (optional)  
```bash
/opt/measurely/venv/bin/python -m measurely.sweep --help
```

## Hardware  
- Raspberry Pi 3/4/5 + any USB audio interface  
- Powered speaker & microphone (or loop-back cable)  

## Repo structure  
```
install.sh          # one-command head-less installer
onboard/            # Wi-Fi captive-portal code
measurely/          # Flask web server + sweep engine
web/                # static HTML/CSS/JS front-end
```

## Tags  
`git tag` – ready-made releases for clone-and-go deployments.

Enjoy **infinite head-less measurements** – just flash, boot, browse.
