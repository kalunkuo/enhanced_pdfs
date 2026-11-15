# Downloads the DuckDB C library (headers, import lib, DLL) into plugin/third_party/duckdb.
param([string]$Version = "1.1.3")
$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot "..\third_party\duckdb"
if (Test-Path (Join-Path $target "duckdb.dll")) {
    Write-Host "DuckDB already present in $target"
    return
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

$zip = Join-Path ([IO.Path]::GetTempPath()) "libduckdb-windows-amd64-$Version.zip"
$url = "https://github.com/duckdb/duckdb/releases/download/v$Version/libduckdb-windows-amd64.zip"
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $target -Force
Remove-Item $zip
Get-ChildItem $target | ForEach-Object { Write-Host "  $($_.Name)" }
