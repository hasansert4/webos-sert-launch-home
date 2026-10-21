#!/bin/sh

INIT=/var/lib/webosbrew/init.d

# Supprimer les hooks de démarrage automatique
rm -f "$INIT/50-launch-home-boot"
rm -f "$INIT/50-lounge-boot"
rm -f "$INIT/55-launch-home-power"

# Arrêter le watcher POWER
pkill -f '[p]ython3 -u .*power-watcher.py' 2>/dev/null || true

echo "disabled"
exit 0
