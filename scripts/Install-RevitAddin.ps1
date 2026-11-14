[CmdletBinding()]
param(
    [string]$RevitPath = (Join-Path $env:ProgramW6432 'Autodesk\Revit 2025'),
    [string]$BuildDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (Get-Process Revit -ErrorAction SilentlyContinue) {
    throw 'Close Revit before installing so it can load the new add-in on startup.'
}
if (-not (Test-Path -LiteralPath (Join-Path $RevitPath 'Revit.exe'))) {
    throw "Revit 2025 was not found in '$RevitPath'."
}

if (-not $BuildDirectory) {
    $project = Join-Path $PSScriptRoot '..\src\EnhancedPdfs\EnhancedPdfs.csproj'
    & dotnet build $project -c Release "-p:RevitPath=$RevitPath" -p:RestoreLockedMode=true
    if ($LASTEXITCODE -ne 0) { throw 'The add-in build failed.' }
    $BuildDirectory = Join-Path $PSScriptRoot '..\src\EnhancedPdfs\bin\Release\net8.0-windows'
}
if (-not (Test-Path -LiteralPath (Join-Path $BuildDirectory 'EnhancedPdfs.dll'))) {
    throw "EnhancedPdfs.dll was not found in '$BuildDirectory'."
}

$payloadRoot = Join-Path $env:LOCALAPPDATA 'EnhancedPdfs\Revit2025'
$payload = Join-Path $payloadRoot ([guid]::NewGuid().ToString('N'))
$manifestFolder = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2025'
New-Item -ItemType Directory -Path $payload,$manifestFolder -Force | Out-Null

$manifest = Join-Path $manifestFolder 'EnhancedPdfs.addin'
$stagedManifest = "$manifest.$([guid]::NewGuid().ToString('N')).tmp"
$backupManifest = "$stagedManifest.bak"
try {
    Get-ChildItem -LiteralPath $BuildDirectory | Where-Object {
        $_.PSIsContainer -or $_.Extension -in '.dll','.json','.pdb'
    } | Copy-Item -Destination $payload -Recurse
    $assembly = [System.Security.SecurityElement]::Escape((Join-Path $payload 'EnhancedPdfs.dll'))
    [IO.File]::WriteAllText($stagedManifest, @"
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>Enhanced PDFs</Name>
    <Assembly>$assembly</Assembly>
    <AddInId>8E9DF5DA-C2C1-44D3-BF0B-1460737851E8</AddInId>
    <FullClassName>EnhancedPdfs.ExportApplication</FullClassName>
    <VendorId>EPDF</VendorId>
    <VendorDescription>Enhanced PDFs</VendorDescription>
  </AddIn>
</RevitAddIns>
"@)
    if (Test-Path -LiteralPath $manifest) {
        [IO.File]::Replace($stagedManifest, $manifest, $backupManifest)
    } else {
        [IO.File]::Move($stagedManifest, $manifest)
    }
} catch {
    Remove-Item -LiteralPath $payload -Recurse -Force -ErrorAction SilentlyContinue
    throw
} finally {
    Remove-Item -LiteralPath $stagedManifest,$backupManifest -Force -ErrorAction SilentlyContinue
}

Get-ChildItem -LiteralPath $payloadRoot -Directory | Where-Object {
    $_.Name -match '^[0-9a-f]{32}$' -and $_.FullName -ne $payload
} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "Installed Enhanced PDFs for Revit 2025 at $manifest."
