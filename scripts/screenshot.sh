#!/usr/bin/env bash
# Pořídí snímek obrazovky desky přes SSH a uloží ho do lokální složky.
# Spouští se na PC (Linux, macOS, WSL, Git Bash). Jedno SSH spojení = jedno heslo.
#
#   bash screenshot.sh                       # ha@10.0.0.34 -> ./screenshots/
#   bash screenshot.sh ha@10.0.0.34 ~/Obrázky/dum3d
#
# Na desce je potřeba jeden z nástrojů: scrot (doporučeno), xfce4-screenshooter,
# nebo import (ImageMagick). Instalace: ssh -t ha@10.0.0.34 'sudo apt install -y scrot'

set -euo pipefail

TARGET=${1:-ha@10.0.0.34}
OUT_DIR=${2:-./screenshots}
SSH=${SSH:-ssh}

mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/dum3d-$(date +%Y%m%d-%H%M%S).png"
TMP="$FILE.part"

# Vzdálený skript: snímek do dočasného souboru, obsah na stdout, úklid.
# Hlášky jdou na stderr, stdout patří jen obrázku.
REMOTE='
set -e
export DISPLAY=${DISPLAY:-:0}
f=$(mktemp --suffix=.png /tmp/dum3d-shot.XXXXXX)
trap "rm -f \"$f\"" EXIT
if command -v scrot >/dev/null 2>&1; then
  scrot -o "$f"
elif command -v xfce4-screenshooter >/dev/null 2>&1; then
  xfce4-screenshooter -f -s "$f"
elif command -v import >/dev/null 2>&1; then
  import -window root "$f"
else
  echo "Na desce chybí nástroj pro snímek. Nainstaluj: sudo apt install -y scrot" >&2
  exit 3
fi
cat "$f"
'

echo "Připojuji se k ${TARGET}…" >&2
if ! $SSH "$TARGET" 'bash -s' <<<"$REMOTE" >"$TMP"; then
  rm -f "$TMP"
  echo "Snímek se nepodařilo pořídit (viz hláška výše)." >&2
  exit 1
fi

# Kontrola, že přišel opravdu PNG (a ne třeba prázdný soubor)
if [ "$(head -c 4 "$TMP" | od -An -tx1 | tr -d ' \n')" != "89504e47" ]; then
  rm -f "$TMP"
  echo "Z desky nepřišel platný PNG soubor." >&2
  exit 1
fi

mv "$TMP" "$FILE"
echo "Uloženo: $FILE ($(wc -c <"$FILE" | tr -d ' ') B)"
