# Copies a rebuilt SmartMarkup.pvp (+ duckdb.dll) over the installed files. No admin needed after
# Install-PxcPlugin.ps1 has run once. The Editor must be closed (it locks loaded plug-ins).
param(
    [string]$BuildDir = (Join-Path $PSScriptRoot "..\build\pdfxchange\Release"),
    [string]$PluginsDir = "C:\Program Files\Tracker Software\PDF Editor\Plugins.x64"
)
$ErrorActionPreference = "Stop"
if (Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) { throw "Close PDF-XChange Editor first." }
foreach ($file in "SmartMarkup.pvp", "duckdb.dll") {
    $source = Join-Path (Resolve-Path $BuildDir).Path $file
    $target = Join-Path $PluginsDir $file
    if ((Test-Path $target) -and ((Get-FileHash $source).Hash -eq (Get-FileHash $target).Hash)) { continue }
    Copy-Item $source $target -Force
    Write-Host "Updated $target"
}
