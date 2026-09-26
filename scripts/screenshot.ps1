# Pořídí snímek obrazovky desky přes SSH a uloží ho do lokální složky (Windows).
# Používá vestavěný OpenSSH klient (ssh, scp). Bez SSH klíče se heslo zadává dvakrát.
#
#   powershell -ExecutionPolicy Bypass -File screenshot.ps1
#   powershell -ExecutionPolicy Bypass -File screenshot.ps1 -Target ha@10.0.0.34 -OutDir C:\Temp\dum3d
#
# Na desce je potřeba scrot (doporučeno), xfce4-screenshooter, nebo import (ImageMagick):
#   ssh -t ha@10.0.0.34 "sudo apt install -y scrot"

param(
  [string]$Target = "ha@10.0.0.34",
  [string]$OutDir = ".\screenshots"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$file = Join-Path $OutDir ("dum3d-{0}.png" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$remoteFile = "/tmp/dum3d-shot.png"

# Binární data přes stdout PowerShell 5 poškodí, proto: snímek do souboru na desce, pak scp
$remote = "export DISPLAY=`${DISPLAY:-:0}; " +
  "if command -v scrot >/dev/null 2>&1; then scrot -o $remoteFile; " +
  "elif command -v xfce4-screenshooter >/dev/null 2>&1; then xfce4-screenshooter -f -s $remoteFile; " +
  "elif command -v import >/dev/null 2>&1; then import -window root $remoteFile; " +
  "else echo 'Na desce chybí nástroj pro snímek. Nainstaluj: sudo apt install -y scrot' >&2; exit 3; fi"

Write-Host "Připojuji se k $Target…"
ssh $Target $remote
if ($LASTEXITCODE -ne 0) { throw "Snímek se nepodařilo pořídit (viz hláška výše)." }

scp "${Target}:$remoteFile" $file
if ($LASTEXITCODE -ne 0) { throw "Stažení snímku selhalo." }
ssh $Target "rm -f $remoteFile" | Out-Null

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file))
if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50) {
  Remove-Item $file
  throw "Z desky nepřišel platný PNG soubor."
}
Write-Host ("Uloženo: {0} ({1} B)" -f $file, $bytes.Length)
