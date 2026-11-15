# Runs the plug-in's self-test inside a real PDF-XChange Editor and prints selftest.json.
#
#   .\Run-PxcSelfTest.ps1 -Pdf <file.pdf> -Out <dir> [-Steps ping,elementmap] [-TimeoutSeconds 120]
#
# The Editor must not already be running (a running instance would get the file without our env vars).
# It is closed GENTLY afterwards (CloseMainWindow); it is never force-killed. If it does not close within
# 30 s (e.g. a "save changes?" prompt), the script says so and leaves it for the user.
# Exit code 0 when selftest.json reports ok, 1 otherwise.
param(
    [Parameter(Mandatory)][string]$Pdf,
    [Parameter(Mandatory)][string]$Out,
    [string[]]$Steps = @(),
    [int]$TimeoutSeconds = 120,
    [string]$Editor = "C:\Program Files\Tracker Software\PDF Editor\PDFXEdit.exe"
)
$ErrorActionPreference = "Stop"

if (Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) { throw "Close PDF-XChange Editor first (self-test needs a fresh instance)." }

$Pdf = (Resolve-Path $Pdf).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$result = Join-Path $Out "selftest.json"
Remove-Item $result -ErrorAction SilentlyContinue

$env:SMARTMARKUP_SELFTEST = $Out
$env:SMARTMARKUP_SELFTEST_STEPS = ($Steps -join ",")
try {
    $process = Start-Process -FilePath $Editor -ArgumentList "`"$Pdf`"" -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path $result) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
} finally {
    Remove-Item Env:SMARTMARKUP_SELFTEST, Env:SMARTMARKUP_SELFTEST_STEPS -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    foreach ($p in Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) { [void]$p.CloseMainWindow() }
    $closeBy = (Get-Date).AddSeconds(30)
    while ((Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) -and (Get-Date) -lt $closeBy) { Start-Sleep -Milliseconds 500 }
    if (Get-Process -Name PDFXEdit -ErrorAction SilentlyContinue) {
        Write-Host "NOTE: PDF-XChange Editor did not close by itself; please close it manually."
    }
}

if (-not (Test-Path $result)) { Write-Host "TIMEOUT: no selftest.json after $TimeoutSeconds s"; exit 1 }
$json = Get-Content $result -Raw
Write-Host $json
if (($json | ConvertFrom-Json).ok) { exit 0 } else { exit 1 }
