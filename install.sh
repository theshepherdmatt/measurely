#!/usr/bin/env bash
set -euo pipefail

echo ">>> Measurely install (no re-clone, non-templated service)"

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

UNIT_SRC="$REPO_DIR/systemd/measurely.service"
UNIT_DST="/etc/systemd/system/measurely.service"

ONBRD_SRC="$REPO_DIR/systemd/measurely-onboarding.service"
ONBRD_DST="/etc/systemd/system/measurely-onboarding.service"

SMB_SRC="$REPO_DIR/samba/measurely.conf"
SMB_INC="/etc/samba/measurely.conf"
SMB_MAIN="/etc/samba/smb.conf"

# --- APT deps used by your stack (audio + numpy/scipy + hotspot + samba)
echo ">>> Installing APT dependencies..."
sudo apt update
sudo apt install -y \
  python3 python3-venv python3-pip python3-dev \
  git rsync build-essential pkg-config gfortran libatlas-base-dev \
  portaudio19-dev libportaudio2 libsndfile1 alsa-utils ffmpeg \
  samba samba-common-bin network-manager rfkill

# --- create data dir EXACTLY as your code expects (capital M)
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

# --- install launchers you already ship (keep your own)
# If you want to use your existing small launchers in scripts/, just drop them into bin/
for f in measurely-server measurely-main measurely-sweep measurely-analyse; do
  if [[ -f "$REPO_DIR/scripts/$f" ]]; then
    install -m 0755 "$REPO_DIR/scripts/$f" "$BIN_DIR/$f"
  fi
done

# --- hotspot/onboarding helpers (use your actual files from scripts/)
if [[ -f "$REPO_DIR/scripts/measurely-hotspot.sh" ]]; then
  echo ">>> Installing hotspot helper..."
  sudo install -m 0755 "$REPO_DIR/scripts/measurely-hotspot.sh" /usr/local/bin/measurely-hotspot.sh
fi
if [[ -f "$REPO_DIR/scripts/measurely-onboarding.sh" ]]; then
  echo ">>> Installing onboarding helper..."
  sudo install -m 0755 "$REPO_DIR/scripts/measurely-onboarding.sh" /usr/local/bin/measurely-onboarding.sh
fi

# --- systemd (plain service; user-agnostic via %h; user set to current user)
if [[ -f "$UNIT_SRC" ]]; then
  echo ">>> Installing systemd service..."
  sudo bash -c "sed -E 's#^User=.*#User=${USER_NAME}#; s#/home/[^/ ]+#%h#g' '$UNIT_SRC' > '$UNIT_DST'"
  sudo systemctl daemon-reload
  sudo systemctl enable --now measurely.service || true
else
  echo "WARN: $UNIT_SRC not found; skipping service install."
fi

# --- onboarding service (optional)
if [[ -f "$ONBRD_SRC" ]]; then
  echo ">>> Installing onboarding systemd service..."
  # Substitute any hardcoded /home/<user> with %h for portability
  sudo bash -c "sed -E 's#/home/[^/ ]+#%h#g' '$ONBRD_SRC' > '$ONBRD_DST'"
  sudo systemctl daemon-reload
  sudo systemctl enable --now measurely-onboarding.service || true
fi

# --- Samba: ship your harvested share and include it
if [[ -f "$SMB_SRC" ]]; then
  echo ">>> Configuring Samba share..."
  # Make the path user-agnostic by replacing hardcoded /home/<user> with %h
  sudo bash -c "sed -E 's#/home/[^/ ]+#%h#g' '$SMB_SRC' > '$SMB_INC'"
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
echo "Web:     http://<pi-ip>:8080/   (or whatever your launcher uses)"
echo "Share:   \\\\<pi-hostname>\\measurely  -> %h/Measurely/measurements"
