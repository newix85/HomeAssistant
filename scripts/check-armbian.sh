#!/usr/bin/env bash
# Rychlá kontrola, zda je zařízení s Armbianem připravené na 3D v Chromiu.
# Spouštět v XFCE session (kvůli DISPLAY). Nic neinstaluje, jen čte.

set -u

section() { printf '\n== %s ==\n' "$1"; }

section "Systém"
. /etc/os-release 2>/dev/null && echo "OS: ${PRETTY_NAME:-?}"
echo "Kernel: $(uname -r)  Arch: $(uname -m)"
[ -r /proc/device-tree/model ] && echo "Deska: $(tr -d '\0' < /proc/device-tree/model)"
free -h | awk '/^Mem:/ {print "RAM: " $2 " (volno " $7 ")"}'

section "Session"
echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-?}  DISPLAY=${DISPLAY:-<nenastaveno>}"

section "GPU ovladač (kernel)"
drivers=$(for d in /sys/class/drm/card*/device/driver; do [ -e "$d" ] && basename "$(readlink -f "$d")"; done | sort -u)
echo "${drivers:-žádný DRM ovladač nenalezen}"
case "$drivers" in
  *panthor*|*panfrost*) echo "-> Mali G-series: WebGL 2 by měl fungovat." ;;
  *lima*)               echo "-> Mali-400/450: jen WebGL 1, scéna musí být velmi lehká." ;;
  *)                    echo "-> Neznámý/žádný GPU ovladač: riziko softwarového renderingu." ;;
esac

section "OpenGL (Mesa)"
if command -v glxinfo >/dev/null 2>&1; then
  glxinfo -B 2>/dev/null | grep -E 'OpenGL (renderer|version|ES profile version)|Accelerated' \
    || echo "glxinfo selhal (běží X a je nastaven DISPLAY?)"
else
  echo "glxinfo chybí: sudo apt install mesa-utils"
fi

section "Prohlížeč"
for b in chromium chromium-browser firefox-esr; do
  command -v "$b" >/dev/null 2>&1 && echo "$b: $("$b" --version 2>/dev/null | head -n1)"
done
echo
echo "Ověř v Chromiu: chrome://gpu -> 'WebGL2: Hardware accelerated'."
