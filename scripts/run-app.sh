#!/usr/bin/env bash
# Spustí appku v kiosku na desce: lokální server + Chromium s ověřenými přepínači.
# Hlášky stránky (console) vypisuje do terminálu; Ctrl+C appku ukončí.
#
#   bash scripts/run-app.sh
#
# Proměnné: DISPLAY (výchozí :0), PORT (8080), CHROMIUM (příkaz prohlížeče),
#           EXTRA_FLAGS (další přepínače), PROFILE_DIR (profil Chromia).

set -u
cd "$(dirname "$0")/.."

export DISPLAY=${DISPLAY:-:0}
PORT=${PORT:-8080}
PROFILE_DIR=${PROFILE_DIR:-$HOME/.local/share/dum3d/chromium}
read -ra BROWSER_CMD <<< "${CHROMIUM:-chromium}"
read -ra EXTRA <<< "${EXTRA_FLAGS:-}"

if [ ! -f app/config.json ]; then
  echo "Chybí app/config.json. Vytvoř ho:"
  echo "  cp app/config.example.json app/config.json && nano app/config.json"
  exit 1
fi

# Kompozitor XFCE stojí ~polovinu výkonu (měřeno, docs/platform.md)
comp=$(DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus} \
       xfconf-query -c xfwm4 -p /general/use_compositing 2>/dev/null)
[ "$comp" = "true" ] && echo "Pozor: kompozitor XFCE je zapnutý, appka poběží pomaleji."

LOG=$(dirname "$PROFILE_DIR")/chromium.log
SERVER=
BROWSER=
TAIL=
cleanup() {
  [ -n "$TAIL" ] && kill "$TAIL" 2>/dev/null
  pkill -P $$ -x tail 2>/dev/null
  [ -n "$BROWSER" ] && kill "$BROWSER" 2>/dev/null
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if pgrep -x chromium >/dev/null; then
  echo "Ukončuji běžící Chromium…"
  pkill -x chromium
  sleep 2
fi
if ss -ltn 2>/dev/null | grep -q "[:.]$PORT "; then
  pkill -f "http.server $PORT"
  sleep 1
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory app >/dev/null 2>&1 &
SERVER=$!
sleep 1
kill -0 "$SERVER" 2>/dev/null || { echo "http.server na portu $PORT nenaběhl."; exit 1; }

mkdir -p "$PROFILE_DIR"
FLAGS=(--kiosk --no-first-run --no-default-browser-check --noerrdialogs
       --disable-session-crashed-bubble --disable-infobars --use-angle=gles
       --user-data-dir="$PROFILE_DIR" --enable-logging=stderr --v=0)

echo "Spouštím appku (http://localhost:$PORT), Ctrl+C ukončí. Hlášky stránky:"
"${BROWSER_CMD[@]}" "${FLAGS[@]}" "${EXTRA[@]}" "http://localhost:$PORT/" >/dev/null 2>"$LOG" &
BROWSER=$!
tail -n +1 -F "$LOG" 2>/dev/null \
  | sed -un 's/.*INFO:CONSOLE[^]]*\] "\(.*\)", source: \(.*\)/  [stránka] \1  (\2)/p' &
TAIL=$!
wait "$BROWSER"
echo "Chromium skončil (log: $LOG)."
