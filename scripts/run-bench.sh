#!/usr/bin/env bash
# Spustí 3D benchmark v kiosku s vlastním (čistým) profilem, během testu udělá
# perf snímek, výsledky vypíše do terminálu a po sobě uklidí.
#
#   bash scripts/run-bench.sh              # MODE=vsync: výchozí chování Chromia
#   MODE=paced bash scripts/run-bench.sh   # GPU bez vsync, Chromium dál časuje snímky
#   MODE=unlimited bash scripts/run-bench.sh
#       # bez jakéhokoli omezení: fps pak měří jen odesílání příkazů, fronta GPU
#       # roste a při změně rozlišení se stránka na sekundy zasekne. Jen diagnostika.
#   bash scripts/run-bench.sh '?aa=1'      # parametry pro bench/index.html
#   SNAP_AT=5 bash scripts/run-bench.sh '?steps=0.5,1,0.75'
#
# Proměnné: DISPLAY (výchozí :0), PORT (8000), TIMEOUT (90 s),
#           SNAP_AT (za kolik s od startu udělat perf snímek, 15),
#           CHROMIUM (příkaz prohlížeče), EXTRA_FLAGS (další přepínače).

set -u
cd "$(dirname "$0")/.."

export DISPLAY=${DISPLAY:-:0}
PORT=${PORT:-8000}
TIMEOUT=${TIMEOUT:-90}
SNAP_AT=${SNAP_AT:-15}
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
  # podprocesy Chromia mohou do profilu chvíli ještě zapisovat
  for _ in 1 2 3 4 5; do rm -rf "$WORK" 2>/dev/null && break; sleep 1; done
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
MODE=${MODE:-vsync}
case "$MODE" in
  vsync) ;;
  paced) FLAGS+=(--disable-gpu-vsync) ;;
  unlimited) FLAGS+=(--disable-gpu-vsync --disable-frame-rate-limit) ;;
  *) echo "Neznámý MODE=$MODE (vsync | paced | unlimited)"; exit 1 ;;
esac

echo "Spouštím benchmark (MODE=$MODE), na monitoru poběží ~35 s…"
"${BROWSER_CMD[@]}" "${FLAGS[@]}" "${EXTRA[@]}" "http://localhost:$PORT/bench/$QUERY" >/dev/null 2>"$LOG" &
BROWSER=$!

sleep "$SNAP_AT"
if ! kill -0 "$BROWSER" 2>/dev/null; then
  echo "Chromium skončil předčasně. Konec jeho logu:"
  tail -n 20 "$LOG"
  exit 1
fi
SNAP_START=$(date +%s%3N)
bash scripts/perf-snapshot.sh
SNAP_END=$(date +%s%3N)

case "$QUERY" in
  *scale=*)
    echo
    read -r -p "Pevné rozlišení = volný běh bez tabulky. Enter test ukončí… " _
    exit 0 ;;
esac

echo
echo "Čekám na výsledky…"
steps=3
if [[ $QUERY =~ steps=([0-9.,]+) ]]; then
  list=${BASH_REMATCH[1]//[^,]/}
  steps=$(( ${#list} + 1 ))
fi
for ((i = 0; i < TIMEOUT; i++)); do
  [ "$(grep -c '"bench {' "$LOG")" -ge "$steps" ] && break
  grep -q 'context lost' "$LOG" && break
  sleep 1
done

python3 - "$LOG" "$MODE" "$SNAP_START" "$SNAP_END" "$QUERY" <<'PY'
import json, re, sys

log, mode = open(sys.argv[1], errors="replace").read(), sys.argv[2]
snap_start, snap_end, query = int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
gpu = re.search(r'"bench-gpu (.*?)", source', log)
rows = [json.loads(m) for m in re.findall(r'"bench (\{.*?\})", source', log)]

print("\n== Výsledky benchmarku (%s%s) ==" % (mode, ", " + query if query else ""))
print("GPU: " + (gpu.group(1) if gpu else "?"))
attrs = re.search(r'"bench-attrs (\{.*?\})", source', log)
if attrs:
    a = json.loads(attrs.group(1))
    print("Kontext: antialias=%s, desynchronized=%s" % (a.get("antialias"), a.get("desynchronized")))
if not rows:
    console = re.findall(r'INFO:CONSOLE[^\]]*\] "(.*?)", source', log)
    print("Žádné výsledky. Hlášky stránky:" if console else "Žádné výsledky ani hlášky stránky. Konec logu:")
    print("\n".join(console[-10:] or log.splitlines()[-15:]))
for r in rows:
    gpu_ms = "n/a" if r.get("gpuMs") is None else "%.1f ms" % r["gpuMs"]
    print("scale %.2f  %10s  %6.1f fps  p95 %6.1f ms  GPU %s" % (r["scale"], r["res"], r["fps"], r["p95"], gpu_ms))
if rows:
    print("(GPU = medián času kreslení naší scény na GPU; n/a = prohlížeč/ovladač neměří)")

stalls = [json.loads(m) for m in re.findall(r'"bench-stall (\{.*?\})", source', log)]
if stalls:
    print("\nZaseknutí (> 0,5 s):")
    for st in stalls:
        start, end = st["wall"] - st["dt"], st["wall"]
        overlap = start < snap_end and end > snap_start
        print("  krok %d (scale %.2f): %.1f s, %s" % (
            st["step"], st["scale"], st["dt"] / 1000,
            "PŘEKRÝVÁ se s perf snímkem" if overlap else
            "%+.1f s od začátku perf snímku" % ((start - snap_start) / 1000)))
else:
    print("\nŽádné zaseknutí delší než 0,5 s.")
PY
