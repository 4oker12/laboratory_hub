[CmdletBinding()]
param(
    [ValidateSet('Inspect','FirstRun','Service')]
    [string]$Action = 'Inspect',

    [string]$BaseUrl = 'http://127.0.0.1:18090',

    [string]$RouterName = 'RouterLab',

    [string]$Ssid = 'RouterLab',

    [string]$Ssid24 = 'RouterLab24',

    [string]$Ssid5 = 'RouterLab5G',

    [string]$WifiPassword = 'RouterLabWifi88',

    [string]$AdminPassword = 'RouterLabAdmin88'
)

$ErrorActionPreference = 'Stop'

$clientWindows = Join-Path $PSScriptRoot 'router-client.py'
if (-not (Test-Path -LiteralPath $clientWindows)) {
    throw "router-client.py not found: $clientWindows"
}

$clientWsl = (& wsl -e wslpath -a $clientWindows).Trim()
if (-not $clientWsl) {
    throw 'Could not convert RouterLab client path to WSL.'
}

$argsList = @('--base-url', $BaseUrl)

switch ($Action) {
    'Inspect' {
        $argsList += @('inspect')
        if ($AdminPassword) {
            $argsList += @('--admin-password', $AdminPassword)
        }
    }
    'FirstRun' {
        $argsList += @(
            'first-run',
            '--router-name', $RouterName,
            '--ssid', $Ssid,
            '--wifi-password', $WifiPassword,
            '--admin-password', $AdminPassword
        )
    }
    'Service' {
        $argsList += @(
            'service',
            '--admin-password', $AdminPassword,
            '--wan-type', 'dhcp',
            '--ssid-24', $Ssid24,
            '--ssid-5', $Ssid5,
            '--wifi-password', $WifiPassword
        )
    }
}

Write-Host "RouterLab Xiaomi R4A scenario: $Action"
Write-Host "Target: $BaseUrl"
Write-Host "WAN: DHCP"

& wsl -e python3 $clientWsl @argsList
if ($LASTEXITCODE -ne 0) {
    throw "RouterLab scenario failed with exit code $LASTEXITCODE"
}
