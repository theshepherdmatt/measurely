# Measurely

Measurely is a simple audio measurement toolkit for Raspberry Pi.  
It runs a Flask web app for sweep measurements, analysis, and reporting.  
Results are stored under your home folder (`~/Measurely/measurements`) and shared on your network via Samba.

---

## Features

- Run sweep measurements using your Pi’s DAC + microphone
- Store each measurement session with summary and analysis
- Access results via web browser or Samba share
- Automatic hotspot setup for first-time configuration
- Services run automatically at boot (systemd)

---

## Requirements

- Raspberry Pi (Pi 4 or Pi 5 recommended) running Raspberry Pi OS Bookworm
- NetworkManager (comes by default on Bookworm)
- Internet connection for package installation
- Git

---

## Installation

1. Update your Pi and install `git`:

   ```bash
   sudo apt update
   sudo apt install -y git
````

2. Clone the repository:

   ```bash
   git clone https://github.com/theshepherdmatt/measurely.git
   cd measurely
   ```

3. Run the installer:

   ```bash
   chmod +x install.sh
   ./install.sh
   ```

   The script will:

   * Install system dependencies (`alsa-utils`, `portaudio`, `scipy/numpy` build libs, Samba, etc.)
   * Create a Python virtual environment and install pinned Python requirements
   * Install Measurely services and hotspot helpers
   * Configure Samba share for your measurement results
   * Enable and start Measurely at boot

---

## Usage

* **Web App**:
  After installation, open a browser and go to:

  ```
  http://<pi-ip>:8080/
  ```

  or if mDNS works on your network:

  ```
  http://measurely.local:8080/
  ```

* **Samba Share**:
  Your measurements are stored in:

  ```
  ~/Measurely/measurements
  ```

  and shared on the network as:

  ```
  \\<pi-hostname>\measurely
  ```

* **Systemd Services**:

  * Main service: `measurely.service`
  * Hotspot fallback: `measurely-onboarding.service`

  Check status:

  ```bash
  systemctl status measurely.service
  ```

  Logs:

  ```bash
  journalctl -u measurely.service -f
  ```

---

## First-time Setup (Hotspot)

If your Pi is not connected to Wi-Fi, the **onboarding service** will automatically start a hotspot:

* SSID: `Measurely-Setup`
* Password: `measurely123`

Connect to this hotspot with your laptop/phone, then visit `http://192.168.42.1:8080/` to complete Wi-Fi setup.

Once you enter valid Wi-Fi credentials in the web UI, the Pi will connect to your network and the hotspot will shut down.

---

## Development Notes

* Services and helpers are shipped in `systemd/` and `scripts/` inside the repo.
  The installer places them in the right system paths (`/usr/local/bin/`, `/etc/systemd/system/`).
* Python requirements are pinned in `requirements.txt` for reproducibility.
* Measurement results are always written to `~/Measurely/measurements` (capital **M**).

---

## Uninstall

To remove services:

```bash
sudo systemctl disable --now measurely.service measurely-onboarding.service
sudo rm /etc/systemd/system/measurely.service
sudo rm /etc/systemd/system/measurely-onboarding.service
sudo systemctl daemon-reload
```

To remove the repo and venv:

```bash
rm -rf ~/measurely ~/Measurely
```

To clean Samba share (optional):

```bash
sudo rm /etc/samba/measurely.conf
sudo systemctl restart smbd nmbd
```
