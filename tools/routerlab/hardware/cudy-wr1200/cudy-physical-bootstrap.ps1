param(
    [string]$RouterIp = '192.168.10.1',
    [switch]$ApplyAdminPassword,
    [string]$ExpectedHardware = 'WR1200 V2.1',
    [string]$ExpectedFirmware = '2.4.23-20251224-145945',
    [string]$ReportDir = "$env:TEMP\routerlab-cudy-physical"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Base = "http://$RouterIp"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$CookieJar = Join-Path $ReportDir 'cookies.txt'
$LoginBody = Join-Path $ReportDir 'login.body'
$LoginHeaders = Join-Path $ReportDir 'login.headers'
$SysauthFile = Join-Path $ReportDir 'sysauth.js'

function Write-SanitizedHeaders {
    param([string]$RawPath, [string]$SafePath)

    Get-Content $RawPath | ForEach-Object {
        $_ -replace '(?i)(Set-Cookie:\s*sysauth=)[^;]+', '$1<redacted>' -replace '(?i)(Cookie:\s*sysauth=)[^;]+', '$1<redacted>'
    } | Set-Content -Encoding UTF8 $SafePath

    Remove-Item -Force $RawPath -ErrorAction SilentlyContinue
}

function Invoke-RouterGet {
    param([string]$Path, [string]$BodyPath, [string]$HeaderPath)

    $rawHeaders = "$HeaderPath.raw"
    $args = @(
        '--silent','--show-error',
        '--max-time','10',
        '--connect-timeout','4',
        '-D',$rawHeaders,
        '-b',$CookieJar,
        '-c',$CookieJar,
        '-o',$BodyPath,
        '-w','%{http_code}',
        "$Base$Path"
    )

    $code = & curl.exe @args
    if ($LASTEXITCODE -ne 0) {
        throw "curl GET failed for $Path (rc=$LASTEXITCODE)"
    }

    Write-SanitizedHeaders -RawPath $rawHeaders -SafePath $HeaderPath
    return ($code | Out-String).Trim()
}

function Get-InputValue {
    param([string]$Html, [string]$Name)

    foreach ($m in [regex]::Matches($Html, '(?is)<input\b[^>]*>')) {
        $tag = $m.Value
        $nm = [regex]::Match($tag, '(?i)\bname=["'']([^"'']+)')
        if (-not $nm.Success -or $nm.Groups[1].Value -ne $Name) {
            continue
        }

        $vm = [regex]::Match($tag, '(?i)\bvalue=["'']([^"'']*)')
        if ($vm.Success) {
            return [System.Net.WebUtility]::HtmlDecode($vm.Groups[1].Value)
        }
        return ''
    }

    return $null
}

function Get-FormAction {
    param([string]$Html)

    $form = [regex]::Match($Html, '(?is)<form\b[^>]*>')
    if (-not $form.Success) { return $null }

    $action = [regex]::Match($form.Value, '(?i)\baction=["'']([^"'']+)')
    if (-not $action.Success) { return $null }

    return [System.Net.WebUtility]::HtmlDecode($action.Groups[1].Value)
}

function Get-SelectedLanguage {
    param([string]$Html)

    $select = [regex]::Match($Html, '(?is)<select\b[^>]*name=["'']luci_language["''][^>]*>(.*?)</select>')
    if (-not $select.Success) { return $null }

    $selected = [regex]::Match($select.Groups[1].Value, '(?is)<option\b[^>]*value=["'']([^"'']*)["''][^>]*selected')
    if ($selected.Success) {
        return [System.Net.WebUtility]::HtmlDecode($selected.Groups[1].Value)
    }

    $first = [regex]::Match($select.Groups[1].Value, '(?is)<option\b[^>]*value=["'']([^"'']*)')
    if ($first.Success) {
        return [System.Net.WebUtility]::HtmlDecode($first.Groups[1].Value)
    }

    return $null
}

function Get-Sha256Hex {
    param([string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-Fingerprint {
    param([string]$Html)

    $hw = $null
    $fw = $null

    $hm = [regex]::Match($Html, 'HW:\s*([^<]+)')
    if ($hm.Success) { $hw = $hm.Groups[1].Value.Trim() }

    $fm = [regex]::Match($Html, 'FW:\s*([^<]+)')
    if ($fm.Success) { $fw = $fm.Groups[1].Value.Trim() }

    return @{ Hardware = $hw; Firmware = $fw }
}

try {
    Remove-Item -Force $CookieJar -ErrorAction SilentlyContinue

    Write-Host '===== PHYSICAL CUDY PREFLIGHT ====='

    $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "$RouterIp/32" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $route) {
        $route = Get-NetRoute -AddressFamily IPv4 | Where-Object {
            $_.DestinationPrefix -eq '192.168.10.0/24' -or $_.NextHop -eq $RouterIp
        } | Select-Object -First 1
    }

    if ($route) { Write-Host "route_interface=$($route.InterfaceAlias)" }
    else { Write-Host 'route_interface=<not-resolved>' }

    $tcp = Test-NetConnection $RouterIp -Port 80 -WarningAction SilentlyContinue
    if (-not $tcp.TcpTestSucceeded) {
        throw "Router $RouterIp:80 is not reachable"
    }
    Write-Host "tcp80=PASS source=$($tcp.SourceAddress) interface=$($tcp.InterfaceAlias)"

    $code = Invoke-RouterGet -Path '/cgi-bin/luci' -BodyPath $LoginBody -HeaderPath $LoginHeaders
    $body = Get-Content $LoginBody -Raw

    $fingerprint = Get-Fingerprint -Html $body
    $action = Get-FormAction -Html $body
    $csrf = Get-InputValue -Html $body -Name '_csrf'
    $salt = Get-InputValue -Html $body -Name 'salt'
    $token = Get-InputValue -Html $body -Name 'token'
    $username = Get-InputValue -Html $body -Name 'luci_username'

    Write-Host "login_http=$code"
    Write-Host "hardware=$($fingerprint.Hardware)"
    Write-Host "firmware=$($fingerprint.Firmware)"
    Write-Host "form_action=$action"
    Write-Host "username=$username"
    Write-Host "csrf_present=$([bool]$csrf)"
    Write-Host "salt_present=$([bool]$salt)"
    Write-Host "token_present=$([bool]$token)"

    if ($fingerprint.Hardware -ne $ExpectedHardware) {
        throw "Unexpected hardware: '$($fingerprint.Hardware)' (expected '$ExpectedHardware')"
    }
    if ($fingerprint.Firmware -ne $ExpectedFirmware) {
        throw "Unexpected firmware: '$($fingerprint.Firmware)' (expected '$ExpectedFirmware')"
    }
    if ($action -ne '/cgi-bin/luci/') {
        throw "Unexpected stock form action: '$action'"
    }
    if ($username -ne 'admin' -or -not $csrf -or -not $salt -or -not $token) {
        throw 'Physical stock auth contract mismatch'
    }

    $sysauthSrc = [regex]::Match($body, '(?is)<script\b[^>]*src=["'']([^"'']*sysauth\.js[^"'']*)')
    if (-not $sysauthSrc.Success) {
        throw 'sysauth.js reference not found'
    }

    $sysauthUrl = [System.Net.WebUtility]::HtmlDecode($sysauthSrc.Groups[1].Value)
    $sysauthArgs = @(
        '--silent','--show-error',
        '--max-time','10',
        '--connect-timeout','4',
        '-o',$SysauthFile,
        '-w','%{http_code}',
        "$Base$sysauthUrl"
    )
    $sysauthCode = & curl.exe @sysauthArgs

    if ($LASTEXITCODE -ne 0 -or (($sysauthCode | Out-String).Trim() -ne '200')) {
        throw 'Unable to fetch stock sysauth.js'
    }

    $js = Get-Content $SysauthFile -Raw
    $jsPassword = $js -match 'luci_password2'
    $jsSha = $js -match 'sha256'
    $jsSalt = $js -match "input\[name='salt'\]"
    $jsToken = $js -match "input\[name='token'\]"

    if (-not ($jsPassword -and $jsSha -and $jsSalt -and $jsToken)) {
        throw 'Unexpected stock sysauth.js password contract'
    }

    Write-Host 'auth_contract=sha256(password+salt)->sha256(hash+token)'
    Write-Host 'PREFLIGHT=PASS'

    if (-not $ApplyAdminPassword) {
        Write-Host 'MUTATION=NO'
        Write-Host "REPORT_DIR=$ReportDir"
        exit 0
    }

    Write-Host ''
    Write-Host '===== ADMIN PASSWORD STOCK POST ====='
    Write-Host 'This step changes router state if it is still in factory/default-password mode.'

    $code = Invoke-RouterGet -Path '/cgi-bin/luci' -BodyPath $LoginBody -HeaderPath $LoginHeaders
    $body = Get-Content $LoginBody -Raw

    $action = Get-FormAction -Html $body
    $csrf = Get-InputValue -Html $body -Name '_csrf'
    $salt = Get-InputValue -Html $body -Name 'salt'
    $token = Get-InputValue -Html $body -Name 'token'
    $username = Get-InputValue -Html $body -Name 'luci_username'
    $zonename = Get-InputValue -Html $body -Name 'zonename'
    $language = Get-SelectedLanguage -Html $body

    if ($action -ne '/cgi-bin/luci/' -or $username -ne 'admin' -or -not $csrf -or -not $salt -or -not $token) {
        throw 'Fresh stock auth form changed before POST; refusing mutation'
    }

    $secure = Read-Host 'Введите новый admin-пароль Cudy (8-64 символа)' -AsSecureString
    $bstr = [IntPtr]::Zero
    $plain = $null

    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

        if ($plain.Length -lt 8 -or $plain.Length -gt 64) {
            throw 'Password length must be 8-64 characters'
        }

        $h1 = Get-Sha256Hex -Text ($plain + $salt)
        $passwordHash = Get-Sha256Hex -Text ($h1 + $token)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        $plain = $null
    }

    $postBody = Join-Path $ReportDir 'admin-post.body'
    $postHeaders = Join-Path $ReportDir 'admin-post.headers'
    $rawPostHeaders = "$postHeaders.raw"

    $curlArgs = @(
        '--silent','--show-error',
        '--max-time','15',
        '--connect-timeout','4',
        '-D',$rawPostHeaders,
        '-b',$CookieJar,
        '-c',$CookieJar,
        '-o',$postBody,
        '-w','%{http_code}',
        '-X','POST',
        "$Base$action",
        '--data-urlencode',"_csrf=$csrf",
        '--data-urlencode',"token=$token",
        '--data-urlencode',"salt=$salt",
        '--data-urlencode',"zonename=$zonename",
        '--data-urlencode',"timeclock=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())",
        '--data-urlencode',"luci_username=$username",
        '--data-urlencode',"luci_password=$passwordHash"
    )
    if ($language) {
        $curlArgs += @('--data-urlencode',"luci_language=$language")
    }

    $postCode = & curl.exe @curlArgs
    if ($LASTEXITCODE -ne 0) {
        throw "curl POST failed (rc=$LASTEXITCODE)"
    }
    $postCode = ($postCode | Out-String).Trim()

    $sessionIssued = Select-String -Path $rawPostHeaders -Pattern '(?i)^Set-Cookie:\s*sysauth=' -Quiet
    $locationLine = Select-String -Path $rawPostHeaders -Pattern '(?i)^Location:' | Select-Object -First 1
    if ($locationLine) {
        $location = ($locationLine.Line -replace '(?i)^Location:\s*', '').Trim()
    }
    else {
        $location = ''
    }

    Write-SanitizedHeaders -RawPath $rawPostHeaders -SafePath $postHeaders
    $h1 = $null
    $passwordHash = $null

    Write-Host "admin_post_http=$postCode"
    Write-Host "session_cookie_issued=$sessionIssued"
    Write-Host "location=$location"

    $verifyBody = Join-Path $ReportDir 'post-auth-guide.body'
    $verifyHeaders = Join-Path $ReportDir 'post-auth-guide.headers'
    $verifyCode = Invoke-RouterGet -Path '/cgi-bin/luci/admin/guide?step=0' -BodyPath $verifyBody -HeaderPath $verifyHeaders

    $verifyText = Get-Content $verifyBody -Raw
    $stillLogin = $verifyText -match 'id=["'']luci_password2["'']'

    Write-Host "post_auth_guide_http=$verifyCode"
    Write-Host "post_auth_still_login=$stillLogin"

    if (-not $sessionIssued) {
        throw 'Stock POST did not issue a sysauth session cookie'
    }
    if ($stillLogin) {
        throw 'Stock POST returned to login state'
    }
    if ($verifyCode -notin @('200','302')) {
        throw "Unexpected authenticated guide HTTP status: $verifyCode"
    }

    Write-Host 'ADMIN_BOOTSTRAP=PASS'
    Write-Host 'MUTATION=ADMIN_PASSWORD'
    Write-Host 'NEXT=inspect physical wizard before WAN/Wi-Fi mutation'
    Write-Host "REPORT_DIR=$ReportDir"
}
finally {
    Remove-Item -Force $CookieJar -ErrorAction SilentlyContinue
}
