#!/bin/sh
#
# install.sh — Install or update Launch Home on a rooted LG webOS TV.
#
# Runs ON the TV, as root. From a computer on the same network:
#
#   ssh root@TV_IP "curl -fsSL https://raw.githubusercontent.com/hasansert4/webos-sert-launch-home/main/install.sh | sh"
#
# Downloads the latest release IPK from GitHub, installs it with the TV's own
# app installer and opens Launch Home. Your Launch Home settings are kept.
#
# Environment:
#   REPO   GitHub repository to install from (default: hasansert4/webos-sert-launch-home)
#   IPK    Local IPK path or URL to install instead of the latest release
#   LAUNCH Open Launch Home afterwards: 1 or 0 (default: 1)

set -eu

REPO="${REPO:-hasansert4/webos-sert-launch-home}"
LAUNCH="${LAUNCH:-1}"
APP_ID="org.webosbrew.lounge.launcher"
TMP_DIR="/media/developer/temp"
LOG="/tmp/launch-home-install.log"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root on the TV (rooted TV with Homebrew Channel)"
command -v luna-send >/dev/null 2>&1 || die "luna-send not found: this does not look like a webOS TV"

fetch() { # fetch URL OUTPUT
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL -o "$2" "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$2" "$1"
	else
		die "neither curl nor wget is available"
	fi
}

mkdir -p "$TMP_DIR"
chmod 777 "$TMP_DIR"
PKG="$TMP_DIR/launch-home.ipk"
rm -f "$PKG"

IPK="${IPK:-}"
if [ -z "$IPK" ]; then
	say "Looking up the latest release of $REPO"
	fetch "https://api.github.com/repos/$REPO/releases/latest" /tmp/launch-home-release.json \
		|| die "could not reach GitHub (is the TV online?)"
	IPK=$(tr ',' '\n' </tmp/launch-home-release.json \
		| sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\.ipk\)".*/\1/p' \
		| grep "/${APP_ID}_" | head -n 1)
	rm -f /tmp/launch-home-release.json
	[ -n "$IPK" ] || die "no Launch Home IPK in the latest release of $REPO"
fi

case "$IPK" in
	http://*|https://*)
		say "Downloading $(basename "$IPK")"
		fetch "$IPK" "$PKG" || die "download failed: $IPK"
		;;
	*)
		[ -f "$IPK" ] || die "no such file: $IPK"
		cp "$IPK" "$PKG"
		;;
esac

say "Installing"
luna-send -n 1 -w 8000 -f luna://com.webos.applicationManager/closeByAppId \
	"{\"id\":\"$APP_ID\"}" >/dev/null 2>&1 || true
rm -f "$LOG"
luna-send -i luna://com.webos.appInstallService/dev/install \
	"{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$PKG\",\"subscribe\":true}" >"$LOG" 2>&1 &
pid=$!
state=""
n=0
while [ "$n" -lt 120 ]; do
	state=$(grep -oE '"state": ?"(installed|failed)"' "$LOG" 2>/dev/null | tail -n 1 | sed 's/.*"\([a-z]*\)"$/\1/')
	[ -n "$state" ] && break
	sleep 1
	n=$((n + 1))
done
kill "$pid" 2>/dev/null || true
rm -f "$PKG"

[ "$state" = installed ] || die "install did not finish (state: ${state:-timeout}); see $LOG"
# Let the system pick up the app's root service files.
/usr/sbin/ls-control scan-services >/dev/null 2>&1 || true
say "Launch Home installed"

# Root for the app list, Home button and boot hooks (README: Running elevated
# as root). An existing startup.sh is never replaced.
HBC_SERVICE=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service
if [ -x "$HBC_SERVICE/elevate-service" ]; then
	say "Elevating the Homebrew Channel service"
	"$HBC_SERVICE/elevate-service" >/dev/null 2>&1 || true
	if [ ! -f /var/lib/webosbrew/startup.sh ] && [ -f "$HBC_SERVICE/startup.sh" ]; then
		cp "$HBC_SERVICE/startup.sh" /var/lib/webosbrew/startup.sh
	fi
else
	say "Homebrew Channel not found: root features (app list, Home button, boot) will not work"
fi

# Let Launch Home call the Homebrew Channel root service. On recent webOS the
# permissions a developer install generates leave out the "public" group that
# service is in. These files grant it; their manifest version stays above any
# release, so the file each install generates never takes over again.
LS2=/var/luna-service2
MANIFEST="$LS2/manifests.d/$APP_ID.json"
if [ -f "$MANIFEST" ]; then
	sed -i 's/"version": *"[^"]*"/"version": "999.0.0"/' "$MANIFEST"
else
	mkdir -p "$LS2/manifests.d" "$LS2/roles.d" "$LS2/client-permissions.d"
	cat >"$LS2/roles.d/$APP_ID.app.json" <<EOF
{
  "appId": "$APP_ID",
  "type": "regular",
  "allowedNames": ["$APP_ID-*"],
  "trustLevel": "public",
  "permissions": [
    {
      "service": "$APP_ID-*",
      "outbound": ["org.webosbrew.hbchannel.service", "com.webos.applicationManager"]
    }
  ]
}
EOF
	cat >"$LS2/client-permissions.d/$APP_ID.json" <<EOF
{
  "$APP_ID-*": ["public", "application.query", "application.launcher"]
}
EOF
	cat >"$MANIFEST" <<EOF
{
  "version": "999.0.0",
  "id": "$APP_ID",
  "roleFiles": ["$LS2/roles.d/$APP_ID.app.json"],
  "clientPermissionFiles": ["$LS2/client-permissions.d/$APP_ID.json"]
}
EOF
fi
/usr/sbin/ls-control scan-services >/dev/null 2>&1 || true

if [ "$LAUNCH" = 1 ]; then
	luna-send -n 1 -w 15000 -f luna://com.webos.applicationManager/launch \
		"{\"id\":\"$APP_ID\"}" >/dev/null 2>&1 || true
fi

cat <<'EOF'

Next, on the TV (Launch Home → Settings):
  • System → Launch on Home button, Boot on TV start
  • Privacy → block the microphones and LG tracking (optional)
  • Look → Language
EOF
