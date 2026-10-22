#!/bin/sh

APP=/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher
INIT=/var/lib/webosbrew/init.d
BOOT="$APP/boot-launch.sh"
POWER="$APP/power-watcher.py"

if [ ! -f "$BOOT" ] || [ ! -f "$POWER" ]; then
    echo "missing_boot_or_power_script"
    exit 1
fi

mkdir -p "$INIT"
chmod 755 "$BOOT" "$POWER"
rm -f "$INIT/50-lounge-boot"

cat > "$INIT/50-launch-home-boot" <<EOF
#!/bin/sh
setsid nohup "$BOOT" >>/tmp/launch-home-boot.log 2>&1 </dev/null &
exit 0
EOF

cat > "$INIT/55-launch-home-power" <<EOF
#!/bin/sh
if ! pgrep -f '[p]ython3 -u .*power-watcher.py' >/dev/null 2>&1; then
    setsid nohup /usr/bin/python3 -u "$POWER" \
        >>/tmp/launch-home-power-stdout.log 2>&1 </dev/null &
fi
exit 0
EOF

chmod 755 "$INIT/50-launch-home-boot"
chmod 755 "$INIT/55-launch-home-power"

# Activer immédiatement la surveillance POWER
sh "$INIT/55-launch-home-power"

echo "enabled"
exit 0
