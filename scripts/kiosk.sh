#!/usr/bin/env bash
# Spouští appku v kiosku po přihlášení do XFCE a hlídá ji: po pádu ji znovu spustí.
# Spouští ho autostart (~/.config/autostart/dum3d.desktop, viz install-kiosk.sh).
# Log: ~/.cache/dum3d/kiosk.log (při > 5 MB se odsune do kiosk.log.1)

set -u
cd "$(dirname "$0")/.."

LOG_DIR=$HOME/.cache/dum3d
LOG=$LOG_DIR/kiosk.log
mkdir -p "$LOG_DIR"
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi
exec >>"$LOG" 2>&1

echo "=== $(date '+%F %T') start kiosku"

# Obrazovka nezhasíná (X11 šetřič a DPMS; nastavení XFCE řeší install-kiosk.sh)
xset s off -dpms s noblank 2>/dev/null || echo "xset nelze nastavit"

# Klávesnice na obrazovce by překrývala appku
pkill -f /usr/bin/onboard 2>/dev/null || true

while true; do
  bash scripts/run-app.sh
  echo "=== $(date '+%F %T') appka skončila (kód $?), restart za 5 s"
  sleep 5
done
