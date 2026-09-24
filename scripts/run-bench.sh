#!/usr/bin/env bash
# Spustí 3D benchmark v kiosku s vlastním (čistým) profilem, během testu udělá
# perf snímek, výsledky vypíše do terminálu a po sobě uklidí.
#
#   bash scripts/run-bench.sh              # bez vsync = skutečný strop výkonu
#   VSYNC=1 bash scripts/run-bench.sh      # s vsync = jak poběží appka
#   bash scripts/run-bench.sh '?aa=1'      # parametry pro bench/index.html
#
# Proměnné: DISPLAY (výchozí :0), PORT (8000), TIMEOUT (90 s),
#           CHROMIUM (příkaz prohlížeče), EXTRA_FLAGS (další přepínače).

set -u
cd "$(dirname "$0")/.."

export DISPLAY=${DISPLAY:-:0}
PORT=${PORT:-8000}
TIMEOUT=${TIMEOUT:-90}
QUERY=${1:-}
read -ra BROWSER_CMD <<< "${CHROMIUM:-chromium}"
read -ra EXTRA <<< "${EXTRA_FLAGS:-}"

WORK=$(mktemp -d /tmp/dum3d-bench.XXXXXX)
LOG=$WORK/chromium.log
SERVER=
BROWSER=

cleanup() {
  [ -n "$BROWSER" ] && kill "$BROWSER" 2>/dev/null
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

port_busy() { ss -ltn 2>/dev/null | grep -q "[:.]$PORT "; }

# Stará instance by si nový test „převzala“ a ignorovala přepínače
if pgrep -x chromium >/dev/null; then
  echo "Ukončuji běžící Chromium…"
  pkill -x chromium
  sleep 2
fi
if port_busy; then
  echo "Port $PORT je obsazený, ukončuji starý http.server…"
  pkill -f "http.server $PORT"
  sleep 1
  port_busy && { echo "Port $PORT je pořád obsazený jiným programem. Zkus PORT=8010 bash $0"; exit 1; }
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
sleep 1
kill -0 "$SERVER" 2>/dev/null || { echo "http.server na portu $PORT nenaběhl."; exit 1; }

FLAGS=(--kiosk --no-first-run --no-default-browser-check --noerrdialogs --use-angle=gles
       --user-data-dir="$WORK/profile" --enable-logging=stderr --v=0)
if [ "${VSYNC:-0}" = 1 ]; then
  MODE="s vsync"
else
  MODE="bez vsync"
  FLAGS+=(--disable-gpu-vsync --disable-frame-rate-limit)
fi

echo "Spouštím benchmark ($MODE), na monitoru poběží ~35 s…"
"${BROWSER_CMD[@]}" "${FLAGS[@]}" "${EXTRA[@]}" "http://localhost:$PORT/bench/$QUERY" >/dev/null 2>"$LOG" &
BROWSER=$!

sleep 15
if ! kill -0 "$BROWSER" 2>/dev/null; then
  echo "Chromium skončil předčasně. Konec jeho logu:"
  tail -n 20 "$LOG"
  exit 1
fi
bash scripts/perf-snapshot.sh

case "$QUERY" in
  *scale=*)
    echo
    read -r -p "Pevné rozlišení = volný běh bez tabulky. Enter test ukončí… " _
    exit 0 ;;
esac

echo
echo "Čekám na výsledky…"
for ((i = 0; i < TIMEOUT; i++)); do
  [ "$(grep -c '"bench {' "$LOG")" -ge 3 ] && break
  grep -q 'context lost' "$LOG" && break
  sleep 1
done

python3 - "$LOG" "$MODE" <<'PY'
import json, re, sys

log, mode = open(sys.argv[1], errors="replace").read(), sys.argv[2]
gpu = re.search(r'"bench-gpu (.*?)", source', log)
rows = [json.loads(m) for m in re.findall(r'"bench (\{.*?\})", source', log)]

print("\n== Výsledky benchmarku (%s) ==" % mode)
print("GPU: " + (gpu.group(1) if gpu else "?"))
if not rows:
    console = re.findall(r'INFO:CONSOLE[^\]]*\] "(.*?)", source', log)
    print("Žádné výsledky. Hlášky stránky:" if console else "Žádné výsledky ani hlášky stránky. Konec logu:")
    print("\n".join(console[-10:] or log.splitlines()[-15:]))
for r in rows:
    print("scale %.2f  %10s  %6.1f fps  p95 %6.1f ms" % (r["scale"], r["res"], r["fps"], r["p95"]))
PY
