#!/bin/sh
set -eu
DIR=/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher
WATCH="$DIR/back-watcher.py"
HOOK=/var/lib/webosbrew/init.d/45-launch-home-back-watcher
[ -f "$WATCH" ] || { echo missing_back_watcher; exit 1; }
mkdir -p /var/lib/webosbrew/init.d
touch /var/lib/webosbrew/launch-home-double-back-enabled
cat > "$HOOK" <<EOF
#!/bin/sh
# Independent of the HOME watcher.
nohup python3 -u "$WATCH" >>/tmp/launch-home-back-watcher.log 2>&1 </dev/null &
EOF
chmod 755 "$HOOK"
# Replace an older watcher process (including previous releases).
if [ -f /tmp/launch-home-back-watcher.pid ]; then
  oldpid=$(cat /tmp/launch-home-back-watcher.pid)
  case "$oldpid" in *[!0-9]*|'') ;; *) kill "$oldpid" 2>/dev/null || true ;; esac
  sleep 1
fi
# Lockfile prevents duplicate instances.
nohup python3 -u "$WATCH" >>/tmp/launch-home-back-watcher.log 2>&1 </dev/null &
sleep 1
if [ -f /tmp/launch-home-back-watcher.pid ]; then
  pid=$(cat /tmp/launch-home-back-watcher.pid)
  kill -0 "$pid" 2>/dev/null && { echo "enabled pid=$pid"; exit 0; }
fi
echo start_failed
tail -15 /tmp/launch-home-back-watcher.log 2>/dev/null || true
exit 1
