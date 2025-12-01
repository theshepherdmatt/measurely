import json
from measurelyapp.buddy import ask_buddy

ana = json.load(open("/home/matt/measurely/measurements/Sweep6/analysis.json"))

scores = ana["scores"]
room   = ana["room"]
full   = ana

headline, actions = ask_buddy([], scores, room, full)

print("=== DAVE SAYS ===")
print(headline)
print("")
print("=== ACTIONS ===")
for a in actions:
    print("-", a)
