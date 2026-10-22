#!/usr/bin/env python3
import json
import subprocess
import time
import os

APP_ID = "org.webosbrew.lounge.launcher"
LOG = "/tmp/launch-home-power.log"
URI = "luna://com.webos.service.tvpower/power/getPowerState"

def log(message):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S") + " " + message + "\n")

def launch():
    time.sleep(1)
    try:
        result = subprocess.run(
            [
                "/usr/bin/luna-send", "-n", "1", "-f",
                "luna://com.webos.applicationManager/launch",
                json.dumps({"id": APP_ID})
            ],
            capture_output=True,
            text=True,
            timeout=12
        )
        log("launch: " + result.stdout.strip())
    except Exception as exc:
        log("launch error: " + str(exc))

def watch():
    log("power watcher started")
    standby_seen = False

    process = subprocess.Popen(
        ["/usr/bin/luna-send", "-i", "-f", URI, '{"subscribe":true}'],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1
    )

    buffer = ""
    depth = 0

    for line in process.stdout:
        for char in line:
            if char == "{":
                if depth == 0:
                    buffer = ""
                depth += 1

            if depth > 0:
                buffer += char

            if char == "}" and depth > 0:
                depth -= 1

                if depth == 0:
                    try:
                        event = json.loads(buffer)
                    except ValueError:
                        continue

                    state = event.get("state")
                    processing = event.get("processing")

                    if state == "Active Standby":
                        standby_seen = True
                        log("standby detected")

                    elif state == "Active" and standby_seen and not processing:
                        standby_seen = False
                        log("wake detected")
                        launch()

if __name__ == "__main__":
    while True:
        try:
            watch()
        except Exception as exc:
            log("watcher error: " + str(exc))

        time.sleep(3)
