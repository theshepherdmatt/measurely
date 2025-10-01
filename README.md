````markdown
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

   ```bash
   git clone https://github.com/theshepherdmatt/measurely.git
   cd measurely
   ```

3. Run the installer:

   ```bash
   chmod +x install.sh
   ./install.sh
   ```

   The installer will:

   * Install system dependencies (`alsa-utils`, `portaudio`, `scipy/numpy` build libraries, Samba, etc.)
   * Create a Python virtual environment and install pinned requirements
   * Install Measurely services and hotspot helper scripts
   * Configure a Samba share for your measurement results
   * Enable and start Measurely automatically at boot

---

## Usage

### Web App

After installation, open a browser and go to:

```
http://<pi-ip>:8080/
```

Or if mDNS is available:

```
http://measurely.local:8080/
```

### Samba Share

Measurement results are stored in:

```
~/Measurely/measurements
```

and are available on the network as:

```
\\<pi-hostname>\measurely
```

### Systemd Services

* Main service: `measurely.service`
* Hotspot fallback: `measurely-onboarding.service`

Check service status:

```bash
systemctl status measurely.service
```

View logs:

```bash
journalctl -u measurely.service -f
```

---

## First-time Setup (Hotspot)

If your Pi is not yet connected to Wi-Fi, the **onboarding service** will start a hotspot automatically:

* **SSID**: `Measurely-Setup`
* **Password**: `measurely123`

Connect to this hotspot with your laptop or phone, then visit:

```
http://192.168.42.1:8080/
```

to complete Wi-Fi setup.
Once valid Wi-Fi credentials are entered, the Pi will join your network and the hotspot will shut down.

---

## Development Notes

* Services and helper scripts are shipped in the `systemd/` and `scripts/` folders.
  The installer places them in the correct system paths (`/usr/local/bin/`, `/etc/systemd/system/`).
* Python requirements are pinned in `requirements.txt` for reproducibility.
* Measurement results are always written to `~/Measurely/measurements` (capital **M**).

---

## Uninstall

To remove the services:

```bash
sudo systemctl disable --now measurely.service measurely-onboarding.service
sudo rm /etc/systemd/system/measurely.service
sudo rm /etc/systemd/system/measurely-onboarding.service
sudo systemctl daemon-reload
```

To remove the repository and virtual environment:

```bash
rm -rf ~/measurely ~/Measurely
```

To remove the Samba share (optional):

```bash
sudo rm /etc/samba/measurely.conf
sudo systemctl restart smbd nmbd
```

``
