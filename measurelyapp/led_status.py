import RPi.GPIO as GPIO
import time
import json
import os

# GPIO pins
RED = 17
GREEN = 27
BLUE = 22

STATUS_FILE = "/tmp/measurely_status.json"

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
# BASIC SETTERS
# -----------------------------------------------------------------------------

def set_colour(r, g, b):
    _init_gpio()         # <-- FIX: initialise only when needed
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
    """Slow pulsing effect without blocking."""
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
# STATUS READER
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
# MAIN LOOP (LED DAEMON)
# -----------------------------------------------------------------------------

def run():
    _init_gpio()      # <-- FIX: safe initialisation here

    try:
        while True:
            state = read_status()

            if state == "boot":
                blink_nonblocking((1,0,0), interval=0.2)

            elif state == "ap_starting":
                blink_nonblocking((1,1,0), interval=0.2)

            elif state == "ap_ready":
                pulse_nonblocking((0,0,1), speed=0.01)

            elif state == "client_connected":
                set_colour(0,1,0)

            elif state == "sweep_running":
                blink_nonblocking((0,0,1), interval=0.1)

            elif state == "sweep_complete":
                set_colour(1,1,1)

            else:
                set_colour(0,0,0)

            time.sleep(0.02)

    finally:
        GPIO.cleanup()


# -----------------------------------------------------------------------------

if __name__ == "__main__":
    run()
