[CmdletBinding()]
param(
    [switch]$Fresh = $true,
    [int]$HttpPort = 18080,
    [int]$ProbeSeconds = 75
)

$ErrorActionPreference = 'Stop'

$scriptWindows = Join-Path $PSScriptRoot 'management-plane-rehost.sh'
if (-not (Test-Path -LiteralPath $scriptWindows)) {
    throw "management-plane-rehost.sh not found: $scriptWindows"
}

$scriptWsl = (& wsl -e wslpath -a $scriptWindows).Trim()
if (-not $scriptWsl) {
    throw 'Could not convert RouterLab rehost script path to WSL.'
}

$argsText = "--install-deps --http-port $HttpPort --probe-seconds $ProbeSeconds"
if ($Fresh) { $argsText += ' --fresh' }

Write-Host 'RouterLab: Xiaomi R4A exact stock management-plane rehost'
Write-Host 'Mode: qemu-user + PRoot; no FirmAE kernel/TAP/SoC emulation.'
Write-Host 'The extracted stock rootfs is never modified.'
Write-Host 'WSL may ask once for sudo if qemu-user-static/proot must be installed.'

& wsl -e bash -lc "bash '$scriptWsl' $argsText"
if ($LASTEXITCODE -ne 0) {
    throw "RouterLab rehost failed with exit code $LASTEXITCODE"
}
