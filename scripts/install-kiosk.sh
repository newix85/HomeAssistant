#!/usr/bin/env bash
# Nastaví desku jako kiosk pro appku Dům 3D (spouštět jako uživatel desky, ne root):
#  - autostart kiosku po přihlášení do XFCE (~/.config/autostart/dum3d.desktop)
#  - vypne autostart klávesnice Onboard (původní soubory zálohuje)
#  - vypne zhasínání obrazovky a šetřič v XFCE, vypne kompozitor (měřeno: 2× rychlejší)
#
#   bash scripts/install-kiosk.sh            # nastavit
#   bash scripts/install-kiosk.sh --remove   # vrátit autostart a Onboard do původního stavu

set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
AUTOSTART=$HOME/.config/autostart
MARKER="# dum3d-kiosk"
ONBOARD_FILES=(onboard-autostart.desktop dotpo-onboard.desktop)
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}

if [ "$(id -u)" = 0 ]; then
  echo "Spusť jako běžný uživatel desky (ne přes sudo), nastavení je per uživatel."
  exit 1
fi

# Nastaví vlastnost XFCE; když ještě neexistuje, vytvoří ji
xfset() {
  local channel=$1 prop=$2 type=$3 value=$4
  if ! command -v xfconf-query >/dev/null 2>&1; then
    echo "  – xfconf-query chybí, přeskakuji $channel $prop"
    return
  fi
  xfconf-query -c "$channel" -p "$prop" -s "$value" 2>/dev/null \
    || xfconf-query -c "$channel" -p "$prop" -n -t "$type" -s "$value" 2>/dev/null \
    || { echo "  – nelze nastavit $channel $prop"; return; }
  echo "  ✓ $channel $prop = $value"
}

install() {
  mkdir -p "$AUTOSTART"

  echo "Autostart kiosku:"
  cat >"$AUTOSTART/dum3d.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Dům 3D kiosk
Comment=Spouští appku Dům 3D přes celou obrazovku
Exec=bash $REPO/scripts/kiosk.sh
X-GNOME-Autostart-enabled=true
$MARKER
EOF
  echo "  ✓ $AUTOSTART/dum3d.desktop"

  echo "Klávesnice Onboard:"
  for name in "${ONBOARD_FILES[@]}"; do
    local file=$AUTOSTART/$name
    if [ -f "$file" ] && grep -q "$MARKER" "$file"; then
      echo "  ✓ $name už je vypnutý"
    elif [ -f "$file" ]; then
      # Soubor přímo v uživatelském autostartu: záloha a Hidden=true do [Desktop Entry]
      cp "$file" "$file.dum3d-backup"
      sed -i '/^Hidden=/d; /^\[Desktop Entry\]/a Hidden=true' "$file"
      echo "$MARKER" >>"$file"
      echo "  ✓ $name vypnut (záloha $name.dum3d-backup)"
    else
      # Systémový autostart (/etc/xdg/autostart) přebije soubor se stejným jménem v ~/.config
      printf '[Desktop Entry]\nType=Application\nName=Onboard (vypnuto pro kiosk)\nHidden=true\n%s\n' \
        "$MARKER" >"$file"
      echo "  ✓ $name vypnut (uživatelské přebití systémového autostartu)"
    fi
  done

  echo "Obrazovka, šetřič a kompozitor:"
  xfset xfce4-power-manager /xfce4-power-manager/dpms-enabled bool false
  xfset xfce4-power-manager /xfce4-power-manager/blank-on-ac int 0
  xfset xfce4-power-manager /xfce4-power-manager/blank-on-battery int 0
  xfset xfce4-screensaver /saver/enabled bool false
  xfset xfce4-screensaver /lock/enabled bool false
  xfset xfwm4 /general/use_compositing bool false

  echo "Automatické přihlášení (aby kiosk naběhl i po restartu bez klávesnice):"
  local autologin
  autologin=$(grep -rhs '^autologin-user=' /etc/lightdm/lightdm.conf /etc/lightdm/lightdm.conf.d/ 2>/dev/null | tail -n1)
  if [ -n "$autologin" ]; then
    echo "  ✓ zapnuto ($autologin)"
  else
    echo "  ! nenalezeno v /etc/lightdm – po restartu se bude muset někdo přihlásit"
  fi

  echo
  echo "Hotovo. Kiosk se spustí při dalším přihlášení/restartu."
  echo "Hned teď ho spustíš:  nohup bash $REPO/scripts/kiosk.sh >/dev/null 2>&1 &"
}

remove() {
  echo "Odebírám nastavení kiosku:"
  rm -f "$AUTOSTART/dum3d.desktop" && echo "  ✓ autostart kiosku odebrán"
  for name in "${ONBOARD_FILES[@]}"; do
    local file=$AUTOSTART/$name
    if [ -f "$file.dum3d-backup" ]; then
      mv -f "$file.dum3d-backup" "$file"
      echo "  ✓ $name obnoven ze zálohy"
    elif [ -f "$file" ] && grep -q "$MARKER" "$file"; then
      rm -f "$file"
      echo "  ✓ $name: přebití odebráno (platí zase systémový autostart)"
    fi
  done
  echo "Nastavení zhasínání a kompozitoru zůstalo; v XFCE ho změníš v Nastavení → Správce napájení / Vyladění správce oken."
}

case "${1:-}" in
  --remove) remove ;;
  "") install ;;
  *) echo "Použití: $0 [--remove]"; exit 1 ;;
esac
