#!/usr/bin/env bash
# Snímek výkonu během běhu 3D: frekvence CPU/GPU, teploty, kompozitor, top procesy.
# Spouštět, když běží benchmark nebo appka. Nic nemění, jen čte.

set -u

section() { printf '\n== %s ==\n' "$1"; }
mhz() { echo $(( $1 / $2 )); }

section "CPU (frekvence / governor)"
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  f=$c/cpufreq
  [ -r "$f/scaling_cur_freq" ] || continue
  echo "$(basename "$c"): $(mhz "$(cat "$f/scaling_cur_freq")" 1000) MHz" \
       "(max $(mhz "$(cat "$f/scaling_max_freq")" 1000), governor $(cat "$f/scaling_governor"))"
done

section "GPU a další devfreq"
found=0
for d in /sys/class/devfreq/*; do
  [ -r "$d/cur_freq" ] || continue
  found=1
  echo "$(basename "$d"): $(mhz "$(cat "$d/cur_freq")" 1000000) MHz" \
       "(max $(mhz "$(cat "$d/max_freq")" 1000000), governor $(cat "$d/governor"))"
done
[ "$found" = 1 ] || echo "devfreq nenalezen"

section "Teploty"
for z in /sys/class/thermal/thermal_zone*; do
  [ -r "$z/temp" ] && echo "$(cat "$z/type"): $(( $(cat "$z/temp") / 1000 )) °C"
done

section "Kompozitor XFCE (xfwm4)"
xml=$HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml
if [ -r "$xml" ] && grep -q 'name="use_compositing"' "$xml"; then
  grep -o 'name="use_compositing"[^>]*' "$xml"
else
  echo "use_compositing není nastaveno -> výchozí (zapnuto)"
fi

section "Top procesy (měřeno 2 s)"
top -b -c -n 2 -d 2 -w 512 | awk '
  /^top -/ { n++ }
  n == 2 && /Cpu\(s\)/ { print }
  n == 2 && hdr {
    cmd = $12
    if (match($0, /--type=[a-z-]+/)) cmd = cmd " " substr($0, RSTART, RLENGTH)
    printf "%6s %%  %s\n", $9, cmd
    if (++k >= 10) exit
  }
  n == 2 && $1 == "PID" { hdr = 1 }'
