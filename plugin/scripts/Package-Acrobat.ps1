# Builds a self-contained zip for testing the Acrobat plug-in on another machine (Acrobat Pro/Standard).
#
#   .\Package-Acrobat.ps1 [-OutZip <path>] [-TestPdf <enhanced.pdf>]
#
# Contents: SmartMarkup.api, duckdb.dll, Install/Uninstall/Run-SelfTest scripts, TESTING.md, and (optional)
# a clean enhanced test PDF. Build first (Release, with -DACROBAT_SDK).
param(
    [string]$BuildDir = (Join-Path $PSScriptRoot "..\build\acrobat\Release"),
    [string]$OutZip = (Join-Path $PSScriptRoot "..\build\SmartMarkup-Acrobat-test.zip"),
    [string]$TestPdf = ""
)
$ErrorActionPreference = "Stop"

$BuildDir = (Resolve-Path $BuildDir).Path
$stage = Join-Path ([IO.Path]::GetTempPath()) ("SmartMarkup-Acrobat-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    foreach ($file in "SmartMarkup.api", "duckdb.dll") {
        $source = Join-Path $BuildDir $file
        if (-not (Test-Path $source)) { throw "Missing $source - build the Acrobat adapter first." }
        Copy-Item $source $stage
    }
    foreach ($script in "Install-Plugin.ps1", "Uninstall-Plugin.ps1", "Run-SelfTest.ps1") {
        Copy-Item (Join-Path $PSScriptRoot $script) $stage
    }
    Copy-Item (Join-Path $PSScriptRoot "..\acrobat\TESTING.md") $stage
    if ($TestPdf) { Copy-Item $TestPdf (Join-Path $stage "snowdon-a101-enhanced.pdf") }

    if (Test-Path $OutZip) { Remove-Item $OutZip }
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $OutZip
    Write-Host "Package: $OutZip"
    Get-ChildItem $stage | ForEach-Object { Write-Host ("  {0,-34} {1,10:N0} bytes" -f $_.Name, $_.Length) }
} finally {
    Remove-Item $stage -Recurse -Force
}
