#!/usr/bin/env python3

import RPi.GPIO as GPIO
import time
import json
import os
import colorsys   # <-- REQUIRED for rainbow spectrum

# -----------------------------------------------------------------------------
# GPIO PINS (BCM)
# -----------------------------------------------------------------------------
RED = 17
GREEN = 27
BLUE = 22

STATUS_FILE = "/tmp/measurely_status.json"


# -----------------------------------------------------------------------------
# STATUS WRITER
# -----------------------------------------------------------------------------
def update_led_state(state: str):
    """Write the LED state to the shared JSON file."""
    try:
        with open(STATUS_FILE, "w") as f:
            json.dump({"state": state}, f)
    except Exception as e:
        print("LED status write error:", e)


# -----------------------------------------------------------------------------
# GPIO INIT (LAZY)
# -----------------------------------------------------------------------------
_gpio_initialised = False

def _init_gpio():
    global _gpio_initialised
    if _gpio_initialised:
        return

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(RED, GPIO.OUT)
    GPIO.setup(GREEN, GPIO.OUT)
    GPIO.setup(BLUE, GPIO.OUT)

    _gpio_initialised = True


# -----------------------------------------------------------------------------
# BASIC COLOUR SETTER
# -----------------------------------------------------------------------------
def set_colour(r, g, b):
    """Set LED channels. r/g/b are 0 or 1."""
    _init_gpio()
    GPIO.output(RED, r)
    GPIO.output(GREEN, g)
    GPIO.output(BLUE, b)


# -----------------------------------------------------------------------------
# NON-BLOCKING BLINK
# -----------------------------------------------------------------------------
last_blink = 0
blink_state = False

def blink_nonblocking(colour, interval=0.2):
    """Blink without blocking the main loop."""
    global last_blink, blink_state
    now = time.time()

    if now - last_blink >= interval:
        blink_state = not blink_state
        last_blink = now

    if blink_state:
        set_colour(*colour)
    else:
        set_colour(0, 0, 0)


# -----------------------------------------------------------------------------
# NON-BLOCKING PULSE
# -----------------------------------------------------------------------------
pulse_level = 0
pulse_direction = 1
last_pulse = 0

def pulse_nonblocking(colour, speed=0.01):
    """Slow pulsing effect."""
    global pulse_level, pulse_direction, last_pulse
    now = time.time()

    if now - last_pulse < speed:
        return
    last_pulse = now

    pulse_level += pulse_direction * 5

    if pulse_level >= 100:
        pulse_direction = -1
        pulse_level = 100
    elif pulse_level <= 0:
        pulse_direction = 1
        pulse_level = 0

    r = colour[0] and pulse_level > 50
    g = colour[1] and pulse_level > 50
    b = colour[2] and pulse_level > 50
    set_colour(r, g, b)


# -----------------------------------------------------------------------------
# STATUS FILE READER
# -----------------------------------------------------------------------------
def read_status():
    if not os.path.exists(STATUS_FILE):
        return "boot"
    try:
        with open(STATUS_FILE, "r") as f:
            data = json.load(f)
            return data.get("state", "unknown")
    except Exception:
        return "unknown"


# -----------------------------------------------------------------------------
# MAIN LOOP
# -----------------------------------------------------------------------------
def run():
    _init_gpio()

    try:
        while True:
            state = read_status()

            # -----------------------------------------------------------------
            # Rainbow boot animation
            # -----------------------------------------------------------------
            if state == "boot":
                for hue in range(0, 360, 4):
                    # hsv_to_rgb returns floats 0–1
                    r, g, b = colorsys.hsv_to_rgb(hue / 360, 1.0, 1.0)

                    # Convert to ON/OFF for simple GPIO LED
                    set_colour(
                        1 if r > 0.2 else 0,
                        1 if g > 0.2 else 0,
                        1 if b > 0.2 else 0
                    )

                    time.sleep(0.03)

                continue

            # -----------------------------------------------------------------
            # AP STARTING → QUICK YELLOW BLINK
            # -----------------------------------------------------------------
            elif state == "ap_starting":
                blink_nonblocking((1, 1, 0), interval=0.2)

            # -----------------------------------------------------------------
            # AP READY → PURPLE PULSE
            # -----------------------------------------------------------------
            elif state == "ap_ready":
                pulse_nonblocking((1, 0, 1), speed=0.01)

            # -----------------------------------------------------------------
            # CLIENT CONNECTED → SOLID GREEN
            # -----------------------------------------------------------------
            elif state == "client_connected":
                set_colour(0, 1, 0)

            # -----------------------------------------------------------------
            # SWEEP RUNNING → FAST BLUE BLINK
            # -----------------------------------------------------------------
            elif state == "sweep_running":
                blink_nonblocking((0, 0, 1), interval=0.1)

            # -----------------------------------------------------------------
            # SWEEP COMPLETE → SOLID WHITE
            # -----------------------------------------------------------------
            elif state == "sweep_complete":
                set_colour(1, 1, 1)

            # -----------------------------------------------------------------
            # UNKNOWN → LED OFF
            # -----------------------------------------------------------------
            else:
                set_colour(0, 0, 0)

            time.sleep(0.02)

    finally:
        GPIO.cleanup()


# -----------------------------------------------------------------------------
# ENTRY POINT
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    run()
