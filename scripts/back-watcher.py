#!/usr/bin/env python3
"""Passive double-BACK watcher for LG Magic Remote (tested event2/key412).
Does not grab input, modify HOME, or close foreground applications.
"""
import fcntl
import os
import select
import struct
import subprocess
import sys
import time

DEVICE = os.environ.get("LH_BACK_DEVICE", "/dev/input/event2")
KEY = 412
WINDOW = 0.45
COOLDOWN = 2.0
APP = "org.webosbrew.lounge.launcher"
FLAG = "/tmp/launch-home-open-running-apps"
ENABLED = "/var/lib/webosbrew/launch-home-double-back-enabled"
PIDFILE = "/tmp/launch-home-back-watcher.pid"
LOCK = "/tmp/launch-home-back-watcher.lock"
EVENT = struct.Struct("llHHi")

def log(message):
    print(time.strftime("%H:%M:%S"), message, flush=True)

def main():
    lockfd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("already running")
        return 0
    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    fd = None
    try:
        fd = os.open(DEVICE, os.O_RDONLY | os.O_NONBLOCK)
        poller = select.poll()
        poller.register(fd, select.POLLIN)
        last_press = 0.0
        last_launch = 0.0
        log("watching %s code=%s" % (DEVICE, KEY))
        while True:
            for _, flags in poller.poll(500):
                if not (flags & select.POLLIN):
                    continue
                try:
                    data = os.read(fd, EVENT.size * 64)
                except BlockingIOError:
                    continue
                # Use kernel timestamps, not processing time: Luna launches can
                # block and leave queued presses waiting to be read.
                for offset in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    sec, usec, typ, code, value = EVENT.unpack_from(data, offset)
                    if typ != 1 or code != KEY or value != 1:
                        continue
                    event_time = sec + usec / 1000000.0
                    now = time.monotonic()
                    if now - event_time > 1.5:
                        continue
                    if 0 < event_time - last_press <= WINDOW:
                        last_press = 0.0
                        if now - last_launch < COOLDOWN:
                            continue
                        if not os.path.isfile(ENABLED):
                            continue
                        last_launch = now
                        # Root-only flag is consumed by Launch Home via hbchannel.
                        with open(FLAG, "w") as f:
                            f.write(str(time.time()))
                        log("double BACK: launching task switcher")
                        try:
                            result = subprocess.run([
                                "luna-send", "-n", "1", "-f",
                                "luna://com.webos.applicationManager/launch",
                                '{"id":"' + APP + '","params":{"openRunningApps":true}}'
                            ], capture_output=True, text=True, timeout=5)
                            log("launch: " + (result.stdout.strip() or result.stderr.strip() or "no output"))
                        except Exception as e:
                            log("launch error: %s" % e)
                    else:
                        last_press = event_time
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(PIDFILE)
        except OSError:
            pass
    return 0

if __name__ == "__main__":
    sys.exit(main())
