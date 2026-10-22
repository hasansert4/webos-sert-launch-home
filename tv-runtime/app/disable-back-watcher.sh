#!/bin/sh
rm -f /var/lib/webosbrew/launch-home-double-back-enabled
rm -f /var/lib/webosbrew/init.d/45-launch-home-back-watcher
if [ -f /tmp/launch-home-back-watcher.pid ]; then
  pid=$(cat /tmp/launch-home-back-watcher.pid)
  case "$pid" in *[!0-9]*|'') ;; *) kill "$pid" 2>/dev/null || true ;; esac
fi
rm -f /tmp/launch-home-open-running-apps
echo disabled
