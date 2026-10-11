param(
    [string]$RouterIp = '192.168.10.1',
    [string]$ZoneName = 'Europe/Kyiv',
    [string]$ReportDir = "$env:TEMP\routerlab-cudy-configured-wan-dhcp",
    [switch]$ExerciseHostname,
    [string]$TestHostname = 'RouterLabCfgCheck'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Base = "http://$RouterIp"
$WanPath = '/cgi-bin/luci/admin/network/wan/config/detail?nomodal=&nextbtn=&proto=dhcp'

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$CookieJar = Join-Path $ReportDir 'cookies.txt'

function Get-InputValue {
    param([string]$Html, [string]$Name)

    $escaped = [regex]::Escape($Name)
    $tag = [regex]::Match($Html, "(?is)<input\b[^>]*name=['""]$escaped['""][^>]*>")
    if (-not $tag.Success) { return $null }

    $value = [regex]::Match($tag.Value, "(?is)\bvalue=['""]([^'""]*)['""]")
    if (-not $value.Success) { return '' }

    return [System.Net.WebUtility]::HtmlDecode($value.Groups[1].Value)
}

function Get-FormAction {
    param([string]$Html)

    $m = [regex]::Match($Html, '(?is)<form\b[^>]*action=["'']([^"'']+)')
    if (-not $m.Success) { return $null }
    return [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
}

function Get-Sha256Hex {
    param([string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Invoke-Get {
    param([string]$Path, [string]$BodyPath)

    $code = & curl.exe `
        --silent --show-error `
        --max-time 8 `
        --connect-timeout 3 `
        -b $CookieJar `
        -c $CookieJar `
        -o $BodyPath `
        -w '%{http_code}' `
        "$Base$Path"

    if ($LASTEXITCODE -ne 0) {
        throw "GET failed for $Path (rc=$LASTEXITCODE)"
    }

    return ($code | Out-String).Trim()
}

try {
    Remove-Item -Force $CookieJar -ErrorAction SilentlyContinue

    Write-Host '===== CONFIGURED STATE ====='

    $loginBody = Join-Path $ReportDir '01-login.body'
    $loginCode = Invoke-Get -Path '/cgi-bin/luci/' -BodyPath $loginBody
    $loginHtml = Get-Content $loginBody -Raw

    $factory = $loginHtml -match '(?i)Create an administrator password'
    $login = $loginHtml -match '(?i)>\s*Login\s*<'
    $action = Get-FormAction -Html $loginHtml

    $csrf = Get-InputValue -Html $loginHtml -Name '_csrf'
    $salt = Get-InputValue -Html $loginHtml -Name 'salt'
    $token = Get-InputValue -Html $loginHtml -Name 'token'
    $username = Get-InputValue -Html $loginHtml -Name 'luci_username'

    Write-Host "login_http=$loginCode"
    Write-Host "factory_form=$factory"
    Write-Host "login_form=$login"
    Write-Host "form_action=$action"
    Write-Host "csrf_present=$([bool]$csrf)"
    Write-Host "salt_present=$([bool]$salt)"
    Write-Host "token_present=$([bool]$token)"

    if ($factory -or -not $login -or $action -ne '/cgi-bin/luci/' -or $username -ne 'admin' -or -not $csrf -or -not $salt -or -not $token) {
        throw 'Router is not in the expected configured-login state'
    }

    Write-Host ''
    Write-Host '===== NORMAL ADMIN LOGIN ====='

    $secure = Read-Host 'Введите существующий ADMIN-пароль Cudy' -AsSecureString
    $bstr = [IntPtr]::Zero
    $plain = $null

    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

        $h1 = Get-Sha256Hex -Text ($plain + $salt)
        $passwordHash = Get-Sha256Hex -Text ($h1 + $token)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        $plain = $null
    }

    $authBody = Join-Path $ReportDir '02-auth.body'
    $authHeaders = Join-Path $ReportDir '02-auth.headers.raw'
    $timeclock = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    $authCode = & curl.exe `
        --silent --show-error `
        --max-time 8 `
        --connect-timeout 3 `
        -D $authHeaders `
        -b $CookieJar `
        -c $CookieJar `
        -o $authBody `
        -w '%{http_code}' `
        -X POST `
        "$Base/cgi-bin/luci/" `
        --data-urlencode "_csrf=$csrf" `
        --data-urlencode "token=$token" `
        --data-urlencode "salt=$salt" `
        --data-urlencode "zonename=$ZoneName" `
        --data-urlencode "timeclock=$timeclock" `
        --data-urlencode 'luci_username=admin' `
        --data-urlencode "luci_password=$passwordHash"

    if ($LASTEXITCODE -ne 0) {
        throw "Login POST failed (rc=$LASTEXITCODE)"
    }

    $authCode = ($authCode | Out-String).Trim()
    $sysauth = Select-String -Path $CookieJar -Pattern 'sysauth' -Quiet

    Remove-Item -Force $authHeaders -ErrorAction SilentlyContinue
    $h1 = $null
    $passwordHash = $null

    Write-Host "auth_http=$authCode"
    Write-Host "sysauth_cookie=$sysauth"

    if ($authCode -ne '302' -or -not $sysauth) {
        throw 'Configured admin login failed; WAN was not touched'
    }

    Write-Host ''
    Write-Host '===== READ WAN DHCP PAGE ====='

    $wanBody = Join-Path $ReportDir '03-wan-before.body'
    $wanCode = Invoke-Get -Path $WanPath -BodyPath $wanBody
    $wanHtml = Get-Content $wanBody -Raw

    $wanToken = Get-InputValue -Html $wanHtml -Name 'token'
    $wanTimeclock = Get-InputValue -Html $wanHtml -Name 'timeclock'
    $oldHostname = Get-InputValue -Html $wanHtml -Name 'cbid.network.wan.hostname'

    $hasProto = $wanHtml -match 'cbid\.network\.wan\.proto'
    $hasHostname = $wanHtml -match 'cbid\.network\.wan\.hostname'
    $hasProto2 = $wanHtml -match 'cbid\.network\.wan\._proto2_1'

    Write-Host "wan_http=$wanCode"
    Write-Host "wan_token_present=$([bool]$wanToken)"
    Write-Host "field_proto=$hasProto"
    Write-Host "field_hostname=$hasHostname"
    Write-Host "field_proto2=$hasProto2"
    Write-Host "current_hostname=$oldHostname"

    if ($wanCode -ne '200' -or -not $wanToken -or -not $hasProto -or -not $hasHostname -or -not $hasProto2) {
        throw 'Configured WAN DHCP page contract mismatch'
    }

    if (-not $ExerciseHostname) {
        Write-Host ''
        Write-Host 'CONFIGURED_WAN_READ_ONLY_PASS=True'
        Write-Host 'MUTATION=NO'
        exit 0
    }

    Write-Host ''
    Write-Host '===== TEMPORARY HOSTNAME WRITE ====='

    $changeBody = Join-Path $ReportDir '04-change.body'
    $changeCode = & curl.exe `
        --silent --show-error `
        --max-time 10 `
        --connect-timeout 3 `
        -b $CookieJar `
        -c $CookieJar `
        -o $changeBody `
        -w '%{http_code}' `
        -X POST `
        "$Base$WanPath" `
        --data-urlencode "token=$wanToken" `
        --data-urlencode "timeclock=$wanTimeclock" `
        --data-urlencode 'cbi.submit=1' `
        --data-urlencode 'cbid.network.wan.proto=dhcp' `
        --data-urlencode "cbid.network.wan.hostname=$TestHostname" `
        --data-urlencode 'cbid.network.wan._proto2_1=none'

    if ($LASTEXITCODE -ne 0) {
        throw "WAN change POST failed (rc=$LASTEXITCODE)"
    }

    $changeCode = ($changeCode | Out-String).Trim()
    Write-Host "change_post_http=$changeCode"
    if ($changeCode -ne '200') {
        throw 'WAN change POST was not accepted'
    }

    $changeHtml = Get-Content $changeBody -Raw
    $restartPath = [regex]::Match($changeHtml, '/cgi-bin/luci/admin/servicectl/restart/[A-Za-z0-9_,.-]+')
    Write-Host "restart_path_rendered=$($restartPath.Success)"

    $verifyBody = Join-Path $ReportDir '05-verify-change.body'
    $verifyCode = Invoke-Get -Path $WanPath -BodyPath $verifyBody
    $verifyHtml = Get-Content $verifyBody -Raw
    $hostnameAfter = Get-InputValue -Html $verifyHtml -Name 'cbid.network.wan.hostname'
    $changed = ($hostnameAfter -eq $TestHostname)

    Write-Host "verify_http=$verifyCode"
    Write-Host "hostname_after_change=$hostnameAfter"
    Write-Host "change_confirmed=$changed"

    if (-not $changed) {
        throw 'Temporary WAN hostname was not read back'
    }

    Write-Host ''
    Write-Host '===== RESTORE ORIGINAL HOSTNAME ====='

    $restoreToken = Get-InputValue -Html $verifyHtml -Name 'token'
    $restoreTimeclock = Get-InputValue -Html $verifyHtml -Name 'timeclock'
    $restoreBody = Join-Path $ReportDir '06-restore.body'

    $restoreCode = & curl.exe `
        --silent --show-error `
        --max-time 10 `
        --connect-timeout 3 `
        -b $CookieJar `
        -c $CookieJar `
        -o $restoreBody `
        -w '%{http_code}' `
        -X POST `
        "$Base$WanPath" `
        --data-urlencode "token=$restoreToken" `
        --data-urlencode "timeclock=$restoreTimeclock" `
        --data-urlencode 'cbi.submit=1' `
        --data-urlencode 'cbid.network.wan.proto=dhcp' `
        --data-urlencode "cbid.network.wan.hostname=$oldHostname" `
        --data-urlencode 'cbid.network.wan._proto2_1=none'

    if ($LASTEXITCODE -ne 0) {
        throw "WAN restore POST failed (rc=$LASTEXITCODE)"
    }

    $restoreCode = ($restoreCode | Out-String).Trim()
    Write-Host "restore_post_http=$restoreCode"

    if ($restoreCode -ne '200') {
        throw 'Original WAN hostname restore POST was not accepted'
    }

    $finalBody = Join-Path $ReportDir '07-final.body'
    $finalCode = Invoke-Get -Path $WanPath -BodyPath $finalBody
    $finalHtml = Get-Content $finalBody -Raw
    $finalHostname = Get-InputValue -Html $finalHtml -Name 'cbid.network.wan.hostname'
    $restored = ($finalHostname -eq $oldHostname)

    Write-Host "final_http=$finalCode"
    Write-Host "final_hostname=$finalHostname"
    Write-Host "original_restored=$restored"

    if (-not $restored) {
        throw 'Original WAN hostname was not restored'
    }

    Write-Host ''
    Write-Host 'CONFIGURED_WAN_HOSTNAME_ROUNDTRIP_PASS=True'
}
finally {
    Remove-Item -Force $CookieJar -ErrorAction SilentlyContinue
}
