$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Enter router administrator password (input hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:ROUTERLAB_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    node (Join-Path $PSScriptRoot 'physical-read.cjs')
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:ROUTERLAB_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
