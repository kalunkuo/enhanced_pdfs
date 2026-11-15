# Removes SmartMarkup from Acrobat's plug_ins folder. Run as administrator, with Acrobat closed.
param([string]$AcrobatDir = "C:\Program Files\Adobe\Acrobat DC\Acrobat")
$ErrorActionPreference = "Stop"

if (Get-Process -Name Acrobat -ErrorAction SilentlyContinue) { throw "Close Acrobat first." }
$target = Join-Path $AcrobatDir "plug_ins\SmartMarkup"
if (-not (Test-Path $target)) { Write-Host "Not installed."; return }

$item = Get-Item $target
if ($item.LinkType -eq "Junction") { $item.Delete() } else { Remove-Item $target -Recurse }
Write-Host "Removed $target"
