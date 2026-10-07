[CmdletBinding()]
param(
    [ValidateSet('List','Info','Start','Stop','Restart','Status','Reset','Inspect','FirstRun','Service','Configure')]
    [string]$Action = 'List',

    [string]$Device = 'xiaomi-r4a-3.0.24-int',

    [ValidateSet('Factory','Configured')]
    [string]$Profile = 'Factory',

    [int]$HttpPort = 18090,

    [string[]]$ClientArgs = @()
)

$ErrorActionPreference = 'Stop'
$cliWindows = Join-Path $PSScriptRoot 'routerlab.py'
if (-not (Test-Path -LiteralPath $cliWindows)) {
    throw "routerlab.py not found: $cliWindows"
}
$cliWsl = (& wsl -e wslpath -a $cliWindows).Trim()
if (-not $cliWsl) {
    throw 'Could not convert Laboratory Hub launcher path to WSL.'
}

$argsList = @()
switch ($Action) {
    'List' { $argsList = @('list') }
    'Info' { $argsList = @('info','--device',$Device) }
    { $_ -in @('Start','Stop','Restart','Status','Reset') } {
        $argsList = @($Action.ToLowerInvariant(),'--device',$Device,'--profile',$Profile.ToLowerInvariant(),'--port',"$HttpPort")
    }
    default {
        $argsList = @($Action.ToLowerInvariant(),'--device',$Device,'--base-url',"http://127.0.0.1:$HttpPort")
        if ($ClientArgs.Count -gt 0) {
            $argsList += '--'
            $argsList += $ClientArgs
        }
    }
}

& wsl -e python3 $cliWsl @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Laboratory Hub failed with exit code $LASTEXITCODE"
}
