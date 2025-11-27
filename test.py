import RPi.GPIO as GPIO
import time

pins = [17, 27, 22]

GPIO.setmode(GPIO.BCM)
for p in pins:
    GPIO.setup(p, GPIO.OUT)

try:
    for p in pins:
        print(f"Testing GPIO {p}")
        GPIO.output(p, 1)
        time.sleep(2)
        GPIO.output(p, 0)
        time.sleep(1)

finally:
    GPIO.cleanup()
