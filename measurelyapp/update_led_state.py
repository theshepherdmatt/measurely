#!/usr/bin/env python3
import json
import sys

STATUS_FILE = "/tmp/measurely_status.json"

def update(state):
    try:
        with open(STATUS_FILE, "w") as f:
            json.dump({"state": state}, f)
    except Exception as e:
        print(f"Failed to write LED state: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        update(sys.argv[1])
    else:
        print("Usage: update_led_state.py <state>")
