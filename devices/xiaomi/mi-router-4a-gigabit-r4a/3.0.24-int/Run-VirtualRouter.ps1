[CmdletBinding()]
param(
    [ValidateSet('Start','Stop','Restart','Status','Reset')]
    [string]$Action = 'Status',

    [int]$HttpPort = 18090,

    [ValidateSet('Factory','Configured')]
    [string]$Profile = 'Factory',

    [switch]$InstallDeps = $true
)

$ErrorActionPreference = 'Stop'

$scriptWindows = Join-Path $PSScriptRoot 'virtual-router.sh'
if (-not (Test-Path -LiteralPath $scriptWindows)) {
    throw "virtual-router.sh not found: $scriptWindows"
}

$scriptWsl = (& wsl -e wslpath -a $scriptWindows).Trim()
if (-not $scriptWsl) {
    throw 'Could not convert RouterLab virtual router script path to WSL.'
}

$actionLower = $Action.ToLowerInvariant()
$profileLower = $Profile.ToLowerInvariant()
$argsText = "$actionLower --port $HttpPort --profile $profileLower"
if ($InstallDeps) {
    $argsText += ' --install-deps'
}

Write-Host "RouterLab Xiaomi R4A virtual router: $Action"
Write-Host "Mode: exact stock LuCI/API + persistent UCI state; no RF/PHY/ASIC emulation."
Write-Host "Profile: $Profile"

& wsl -e bash -lc "bash '$scriptWsl' $argsText"
if ($LASTEXITCODE -ne 0) {
    throw "RouterLab virtual router failed with exit code $LASTEXITCODE"
}
