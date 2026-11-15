# One-time install of SmartMarkup.pvp (+ duckdb.dll) into PDF-XChange Editor. Run as administrator,
# with the Editor closed. Also grants the current user Modify on THOSE TWO FILES ONLY, so later
# rebuilds can be copied with Update-PxcPlugin.ps1 without admin rights.
param(
    [string]$BuildDir = (Join-Path $PSScriptRoot "..\build\pdfxchange\Release"),
    [string]$PluginsDir = "C:\Program Files\Tracker Software\PDF Editor\Plugins.x64",
    # The DESKTOP user (owner of explorer.exe), not the elevated identity: with a separate admin account
    # (e.g. DOMAIN\user.b) the elevated identity is the wrong one to grant.
    [string]$User = ""
)
$ErrorActionPreference = "Stop"
if (-not $User) {
    # Only the desktop shell in THIS session; anything ambiguous must be stated explicitly with -User.
    $session = (Get-Process -Id $PID).SessionId
    $shells = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe' AND SessionId=$session")
    if ($shells.Count -ne 1) { throw "Found $($shells.Count) desktop shells in session $session; pass -User DOMAIN\name." }
    $owner = Invoke-CimMethod -InputObject $shells[0] -MethodName GetOwner
    $User = "$($owner.Domain)\$($owner.User)"
}
Write-Host "Granting Modify on the two plug-in files to: $User"
$answer = Read-Host "Continue? (y/n)"
if ($answer -ne "y") { throw "Cancelled." }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated (Run as administrator) PowerShell."
}
if (Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) { throw "Close PDF-XChange Editor first." }

$BuildDir = (Resolve-Path $BuildDir).Path
$spike = Join-Path $PluginsDir "SmartMarkupSpike.pvp"
if (Test-Path $spike) { Remove-Item $spike; Write-Host "Removed the earlier spike plug-in." }

foreach ($file in "SmartMarkup.pvp", "duckdb.dll") {
    $source = Join-Path $BuildDir $file
    if (-not (Test-Path $source)) { throw "Missing $source - build first." }
    $target = Join-Path $PluginsDir $file
    Copy-Item $source $target -Force
    & icacls $target /grant "${User}:(M)" | Out-Null
    Write-Host "Installed $target (Modify granted to $User)"
}
Write-Host "Start PDF-XChange Editor; Ctrl+K > Plugins should list 'Smart Markup'."
