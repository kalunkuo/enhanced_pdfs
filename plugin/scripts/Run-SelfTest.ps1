# Runs the plug-in's self-test inside a real Acrobat and prints selftest.json.
#
#   .\Run-SelfTest.ps1 -Pdf <file.pdf> -Out <dir> [-Steps ping,elementmap] [-TimeoutSeconds 120]
#
# Acrobat must not already be running (a running instance would receive the file without our env vars).
# Exit code 0 when selftest.json reports ok, 1 otherwise.
param(
    [Parameter(Mandatory)][string]$Pdf,
    [Parameter(Mandatory)][string]$Out,
    [string[]]$Steps = @(),
    [int]$TimeoutSeconds = 120,
    [string]$Acrobat = "C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe"
)
$ErrorActionPreference = "Stop"

if (Get-Process -Name Acrobat -ErrorAction SilentlyContinue) { throw "Close Acrobat first (self-test needs a fresh instance)." }

$Pdf = (Resolve-Path $Pdf).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$result = Join-Path $Out "selftest.json"
Remove-Item $result -ErrorAction SilentlyContinue

$env:SMARTMARKUP_SELFTEST = $Out
$env:SMARTMARKUP_SELFTEST_STEPS = ($Steps -join ",")
try {
    $process = Start-Process -FilePath $Acrobat -ArgumentList "`"$Pdf`"" -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path $result) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
} finally {
    Remove-Item Env:SMARTMARKUP_SELFTEST, Env:SMARTMARKUP_SELFTEST_STEPS -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Get-Process -Name Acrobat -ErrorAction SilentlyContinue | Stop-Process -Force
}

if (-not (Test-Path $result)) { Write-Host "TIMEOUT: no selftest.json after $TimeoutSeconds s"; exit 1 }
$json = Get-Content $result -Raw
Write-Host $json
if (($json | ConvertFrom-Json).ok) { exit 0 } else { exit 1 }
