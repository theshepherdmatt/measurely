# Measurely

Measurely is a simple audio measurement toolkit for Raspberry Pi.  
It provides a Flask-based web app for sweep measurements, analysis, and reporting.  
Results are stored under your home folder (`~/Measurely/measurements`) and shared over the network via Samba.

---

## Features

- Run sweep measurements using your Pi’s DAC and a microphone
- Store measurement sessions with summaries and analysis
- Access results via web browser or Samba file share
- Automatic hotspot setup for first-time Wi-Fi configuration
- Systemd services for automatic startup at boot

---

## Requirements

- Raspberry Pi (Pi 4 or Pi 5 recommended) running **Raspberry Pi OS Bookworm**
- **NetworkManager** (enabled by default on Bookworm)
- Internet connection for installing packages
- `git`

---

## Installation

1. Update your system and install `git`:

   ```bash
   sudo apt update
   sudo apt install -y git
   ```

2. Clone the Measurely repository:
