#!/usr/bin/env python3
"""Passive double-BACK watcher for LG remotes (BACK = key 412).
Does not grab input, modify HOME, or close foreground applications.

The remote's event node is not fixed: the TV lists several Magic Remote slots
(event3..event8 on webOS 11) plus the IR receiver, and the one in use changes
between boots and reconnects. So every keyboard node is watched, and the list
is refreshed every few seconds. LH_BACK_DEVICE pins one node instead.
"""
import errno
import fcntl
import os
import re
import select
import struct
import subprocess
import sys
import time

DEVICE = os.environ.get("LH_BACK_DEVICE", "")
KEY = 412
WINDOW = 0.65
COOLDOWN = 2.0
# The same press reported by two nodes arrives within a few ms; two real
# presses are never this close.
SAME_PRESS = 0.08
RESCAN = 5.0
APP = "org.webosbrew.lounge.launcher"
FLAG = "/tmp/launch-home-open-running-apps"
ENABLED = "/var/lib/webosbrew/launch-home-double-back-enabled"
PIDFILE = "/tmp/launch-home-back-watcher.pid"
LOCK = "/tmp/launch-home-back-watcher.lock"
EVENT = struct.Struct("llHHi")

def log(message):
    print(time.strftime("%H:%M:%S"), message, flush=True)

def keyboard_nodes():
    """Event nodes of every input device with a kbd handler (remotes, IR)."""
    if DEVICE:
        return [DEVICE]
    nodes = []
    try:
        with open("/proc/bus/input/devices") as f:
            for line in f:
                if line.startswith("H: Handlers=") and " kbd " in " " + line[12:] + " ":
                    for name in re.findall(r"\bevent\d+\b", line):
                        nodes.append("/dev/input/" + name)
    except OSError as e:
        log("cannot list input devices: %s" % e)
    return nodes or ["/dev/input/event3"]

def launch_switcher():
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

def main():
    lockfd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("already running")
        return 0
    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    poller = select.poll()
    fds = {}  # path -> fd

    def close(path):
        fd = fds.pop(path)
        try:
            poller.unregister(fd)
        except (KeyError, ValueError):
            pass
        os.close(fd)

    def refresh():
        wanted = keyboard_nodes()
        for path in list(fds):
            if path not in wanted:
                close(path)
        for path in wanted:
            if path in fds:
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError as e:
                log("cannot open %s: %s" % (path, e))
                continue
            fds[path] = fd
            poller.register(fd, select.POLLIN)
        log("watching %s code=%s" % (" ".join(sorted(fds)) or "nothing", KEY))

    try:
        refresh()
        last_scan = time.monotonic()
        last_press = 0.0
        last_seen = 0.0
        last_launch = 0.0
        while True:
            if time.monotonic() - last_scan >= RESCAN:
                last_scan = time.monotonic()
                if sorted(keyboard_nodes()) != sorted(fds):
                    refresh()
            by_fd = {fd: path for path, fd in fds.items()}
            for fd, flags in poller.poll(500):
                path = by_fd.get(fd)
                if path is None:
                    continue
                if flags & (select.POLLERR | select.POLLHUP | select.POLLNVAL):
                    # The remote disconnected; the next rescan picks it up again.
                    close(path)
                    continue
                try:
                    data = os.read(fd, EVENT.size * 64)
                except OSError as e:
                    if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                        continue
                    close(path)
                    continue
                for offset in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    sec, usec, typ, code, value = EVENT.unpack_from(data, offset)
                    if typ != 1 or code != KEY or value != 1:
                        continue
                    now = time.monotonic()
                    if now - last_seen < SAME_PRESS:
                        continue
                    last_seen = now
                    log("BACK key press detected (%s)" % os.path.basename(path))
                    if 0 < now - last_press <= WINDOW:
                        last_press = 0.0
                        if now - last_launch < COOLDOWN:
                            continue
                        if not os.path.isfile(ENABLED):
                            continue
                        last_launch = now
                        launch_switcher()
                    else:
                        last_press = now
    finally:
        for path in list(fds):
            close(path)
        try:
            os.unlink(PIDFILE)
        except OSError:
            pass
    return 0

if __name__ == "__main__":
    sys.exit(main())
