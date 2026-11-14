# Installs SmartMarkup.api (+ duckdb.dll) into Acrobat's plug_ins folder. Run as administrator, with Acrobat closed.
#
#   Dev mode (default): plug_ins\SmartMarkup is a directory junction to the build output, so later
#                       rebuilds need no admin rights (close Acrobat before rebuilding).
#   -Copy:              copies the built files instead (what a contractor would get).
param(
    [string]$BuildDir = (Join-Path $PSScriptRoot "..\build\acrobat\Release"),
    [string]$AcrobatDir = "C:\Program Files\Adobe\Acrobat DC\Acrobat",
    [switch]$Copy
)
$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated (Run as administrator) PowerShell."
}
if (Get-Process -Name Acrobat -ErrorAction SilentlyContinue) { throw "Close Acrobat first." }

$BuildDir = (Resolve-Path $BuildDir).Path
foreach ($file in "SmartMarkup.api", "duckdb.dll") {
    if (-not (Test-Path (Join-Path $BuildDir $file))) { throw "Missing $file in $BuildDir - build first." }
}

$target = Join-Path $AcrobatDir "plug_ins\SmartMarkup"
if (Test-Path $target) {
    # Removes a junction without touching the build output it points to.
    (Get-Item $target).Delete()
}

if ($Copy) {
    New-Item -ItemType Directory -Path $target | Out-Null
    Copy-Item (Join-Path $BuildDir "SmartMarkup.api"), (Join-Path $BuildDir "duckdb.dll") $target
    Write-Host "Copied SmartMarkup into $target"
} else {
    New-Item -ItemType Junction -Path $target -Target $BuildDir | Out-Null
    Write-Host "Linked $target -> $BuildDir"
}
Write-Host "Start Acrobat; look for the 'Smart Markup' menu (in the new Acrobat UI: Menu > Plug-ins)."
Write-Host "If it is missing: Edit > Preferences > General > untick 'Use only certified plug-ins', then restart Acrobat."
