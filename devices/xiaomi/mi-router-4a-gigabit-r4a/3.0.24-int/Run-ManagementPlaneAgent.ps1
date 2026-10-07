[CmdletBinding()]
param(
    [switch]$Fresh,
    [int]$Iid = 1,
    [int]$BootWait = 120,
    [int]$RunSeconds = 180
)

$ErrorActionPreference = 'Stop'

$scriptWindows = Join-Path $PSScriptRoot 'management-plane-agent.sh'
if (-not (Test-Path -LiteralPath $scriptWindows)) {
    throw "management-plane-agent.sh not found: $scriptWindows"
}

$scriptWsl = (& wsl -e wslpath -a $scriptWindows).Trim()
if (-not $scriptWsl) {
    throw 'Could not convert the RouterLab script path to WSL.'
}

$argsText = "--iid $Iid --boot-wait $BootWait --run-seconds $RunSeconds"
if ($Fresh) { $argsText += ' --fresh' }

Write-Host 'RouterLab: Xiaomi R4A stock management-plane agent'
Write-Host 'The original FirmAE image will not be modified.'
Write-Host 'One sudo password prompt from WSL may appear.'

$cmd = "bash '$scriptWsl' $argsText"
& wsl -e bash -lc $cmd
if ($LASTEXITCODE -ne 0) {
    throw "RouterLab agent failed with exit code $LASTEXITCODE"
}
