#!/usr/bin/env bash
set -euo pipefail

echo ">>> Measurely install (no re-clone, stable service)"

# --- must NOT run as root
if [[ $EUID -eq 0 ]]; then
  echo "Run as a normal user; the script will sudo when needed."
  exit 1
fi

USER_NAME="$USER"
HOME_DIR="$HOME"
REPO_DIR="$(pwd)"
REPO_NAME="$(basename "$REPO_DIR")"
if [[ "$REPO_NAME" != "measurely" ]]; then
  echo "ERROR: run from your cloned repo folder named 'measurely' (you are in '$REPO_NAME')."
  exit 1
fi

# --- paths from repo
CFG_DIR="$HOME_DIR/.config/measurely"
BIN_DIR="$REPO_DIR/bin"
VENV_DIR="$REPO_DIR/.venv"

UNIT_SRC="$REPO_DIR/systemd/measurely.service"           # optional (if you ship one)
UNIT_DST="/etc/systemd/system/measurely.service"

ONBRD_SRC="$REPO_DIR/systemd/measurely-onboarding.service"
ONBRD_DST="/etc/systemd/system/measurely-onboarding.service"

SMB_SRC="$REPO_DIR/samba/measurely.conf"
SMB_INC="/etc/samba/measurely.conf"
SMB_MAIN="/etc/samba/smb.conf"

echo ">>> Installing APT dependencies..."
sudo apt update
sudo apt install -y \
  python3 python3-venv python3-pip python3-dev \
  git rsync build-essential pkg-config gfortran libatlas-base-dev \
  portaudio19-dev libportaudio2 libsndfile1 alsa-utils ffmpeg \
  samba samba-common-bin network-manager rfkill avahi-daemon

# --- data + config dirs
mkdir -p "$HOME_DIR/Measurely/measurements"
mkdir -p "$CFG_DIR" "$BIN_DIR"

# --- Python venv + requirements
echo ">>> Creating virtualenv and installing Python packages..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip wheel setuptools
if [[ -f "$REPO_DIR/requirements.txt" ]]; then
  pip install --no-cache-dir -r "$REPO_DIR/requirements.txt"
else
  echo "ERROR: requirements.txt missing"; exit 1
fi
# ensure waitress present for the service
pip install --no-cache-dir waitress

# --- ship your small launchers into bin/
for f in measurely-server measurely-main measurely-sweep measurely-analyse; do
  if [[ -f "$REPO_DIR/scripts/$f" ]]; then
    install -m 0755 "$REPO_DIR/scripts/$f" "$BIN_DIR/$f"
  fi
done

# --- hotspot/onboarding helpers
if [[ -f "$REPO_DIR/scripts/measurely-hotspot.sh" ]]; then
  echo ">>> Installing hotspot helper..."
  sudo install -m 0755 "$REPO_DIR/scripts/measurely-hotspot.sh" /usr/local/bin/measurely-hotspot.sh
fi
if [[ -f "$REPO_DIR/scripts/measurely-onboarding.sh" ]]; then
  echo ">>> Installing onboarding helper..."
  sudo install -m 0755 "$REPO_DIR/scripts/measurely-onboarding.sh" /usr/local/bin/measurely-onboarding.sh
fi

# --- write ENV defaults (users can edit later)
printf "HOST=0.0.0.0\nPORT=8080\n" > "$CFG_DIR/env"

# --- systemd (write a stable unit with absolute paths + --call + --listen)
echo ">>> Installing systemd service..."
sudo tee "$UNIT_DST" >/dev/null <<EOF
[Unit]
Description=Measurely Flask server
After=network-online.target
Wants=network-online.target

[Service]
User=${USER_NAME}
WorkingDirectory=/home/${USER_NAME}/measurely
ExecStart=/bin/bash -lc 'exec /home/${USER_NAME}/measurely/.venv/bin/waitress-serve --listen="*:8080" --call measurely.server:create_app'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# (Optional) If you really want to use a repo unit, ignore the one above and copy yours verbatim:
# if [[ -f "$UNIT_SRC" ]]; then sudo install -m 0644 "$UNIT_SRC" "$UNIT_DST"; fi

sudo systemctl daemon-reload
sudo systemctl unmask measurely.service 2>/dev/null || true
sudo systemctl enable --now measurely.service || true

# --- onboarding service (optional + safe)
if [[ -f "$ONBRD_SRC" ]]; then
  echo ">>> Installing onboarding systemd service..."
  # NOTE: keep absolute paths in your shipped unit; avoid %h/%u templating
  sudo install -m 0644 "$ONBRD_SRC" "$ONBRD_DST"
  sudo systemctl daemon-reload
  sudo systemctl unmask measurely-onboarding.service 2>/dev/null || true
  sudo systemctl enable --now measurely-onboarding.service || true
fi

# --- Samba: write with absolute home path (Samba's %h ≠ home dir!)
if [[ -f "$SMB_SRC" ]]; then
  echo ">>> Configuring Samba share..."
  SHARE_PATH="/home/${USER_NAME}/Measurely/measurements"
  sudo bash -c "sed -E 's#path *=.*#path = '"$SHARE_PATH"'#' '$SMB_SRC' > '$SMB_INC'"
  if ! grep -qF "include = $SMB_INC" "$SMB_MAIN"; then
    echo "include = $SMB_INC" | sudo tee -a "$SMB_MAIN" >/dev/null
  fi
  sudo testparm -s >/dev/null
  sudo systemctl enable --now smbd nmbd
else
  echo "WARN: $SMB_SRC not found; skipping Samba config."
fi

echo ">>> Done."
echo "Service: sudo systemctl status measurely.service --no-pager --full"
echo "Logs:    journalctl -u measurely.service -f"
echo "Web:     http://<pi-ip>:8080/"
echo "Share:   \\\\<pi-hostname>\\measurely  -> /home/${USER_NAME}/Measurely/measurements"