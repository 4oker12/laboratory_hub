/* RouterLab Archer C20 v5 / 200821 - cautious same-origin iOS read-only pilot.
 * Stock TP-Link encrypted login is invoked through its own visible form.
 * No invented /cgi_gdpr packets, write requests, saved credentials, or retry loops.
 */
(() => {
  'use strict';
  if (window.__RouterLabC20Pilot || !document.body) return;
  const text = () => (document.title + ' ' + (document.body?.innerText || '').slice(0,12000));
  const visible = el => !!el && !el.disabled && el.getClientRects().length > 0;
  const validStack = x => /^\d+(?:,\d+){5}$/.test(String(x || ''));
  let busy = false, unlocked = false, mounted = false, reported = false, clickOnce = false;
  let stage = 'PROBING', lastRead = null, logoutLocked = false;
  const logs = [];
  const host = document.createElement('div');
  host.id = 'routerlab-tplink-c20-ios';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:0;width:100vw;height:100dvh;min-height:100vh;background:#f3f7fa;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML =
    '<style>:host{color-scheme:light}*{box-sizing:border-box}' +
    '.panel{background:#f3f7fa;color:#14212d;height:100dvh;min-height:100vh;display:flex;flex-direction:column}' +
    '.top{background:#132b42;color:white;padding:17px 16px;font-size:16px;font-weight:700}' +
    '.content{padding:16px;overflow-y:auto;flex:1}.muted{color:#52687d;font-size:12px;line-height:1.6}' +
    '#status{font-size:17px;font-weight:650;line-height:1.45;margin:12px 0}' +
    '.card,form{background:white;border:1px solid #dbe4ec;border-radius:14px;padding:16px;margin:12px 0}' +
    '.card span{color:#62768b;font-size:12px;display:block;margin-bottom:8px}' +
    '.card strong{font-size:17px;overflow-wrap:anywhere}.card small{color:#62768b;font-size:12px;display:block;margin-top:8px}' +
    'label{font-size:13px;font-weight:600;display:block;margin:10px 0}' +
    'input{width:100%;font-size:16px;padding:12px;border:1px solid #a8b8c6;border-radius:9px}' +
    'button{background:#11639c;color:white;border:0;border-radius:9px;padding:11px 13px;font-weight:650;font-size:13px;margin:5px}' +
    'button:disabled{opacity:.5}.secondary{background:#e1eaf2;color:#17364e}' +
    '#auth,#dashboard{display:none}.error{color:#ae2934;font-size:13px}' +
    'pre{font-size:11px;max-height:170px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '</style><div class="panel"><div class="top">RouterLab · TP-Link Archer C20</div>' +
    '<div class="content"><p id="status" role="status">Определяем TP-Link…</p>' +
    '<p id="info" class="muted">Считывание через оригинальную сессию TP-Link. Запись конфигурации отключена.</p>' +
    '<form id="auth" autocomplete="off"><strong>Пароль администратора TP-Link</strong>' +
    '<p class="muted">Для входа используется штатный механизм авторизации Archer C20. Не пароль Wi-Fi.</p>' +
    '<label for="admin-pass">Пароль администратора</label><input id="admin-pass" type="password" required autocomplete="current-password">' +
    '<button type="submit" id="login-submit">Войти</button><p id="auth-error" class="error" role="alert"></p></form>' +
    '<div id="dashboard"><div class="card"><span>Устройство</span><strong>TP-Link Archer C20</strong>' +
    '<small id="device-extra">Прошивка требует подтверждения</small></div>' +
    '<div class="card"><span>WAN</span><strong id="wan-type">Нет данных</strong></div>' +
    '<div class="card"><span>Wi-Fi 2,4 ГГц</span><strong id="ssid24">Нет данных</strong>' +
    '<small id="extra24"></small></div>' +
    '<div class="card"><span>Wi-Fi 5 ГГц</span><strong id="ssid5">Нет данных</strong>' +
    '<small id="extra5"></small></div>' +
    '<button type="button" id="lock" class="secondary">Закрыть управление</button></div>' +
    '<button type="button" id="refresh" class="secondary">Проверить состояние</button>' +
    '<details><summary class="muted">Диагностика</summary><pre id="log"></pre></details>' +
    '</div></div>';
  const el = id => shadow.getElementById(id);
  const show = (id, yes) => { el(id).style.display = yes ? 'block' : 'none'; };
  const status = s => { el('status').textContent = s; note(s); };
  function note(s) {
    logs.push(String(s).slice(0,130));
    if (logs.length > 20) logs.shift();
    el('log').textContent = logs.join('\n');
  }
  function bridge(type, data={}) {
    try { window.webkit?.messageHandlers?.routerlab?.postMessage({type,...data}); }
    catch (_) { /* browser mock has no native bridge */ }
  }
  function getLoginForm() {
    const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
      .filter(e => !host.contains(e));
    const buttons = [...document.querySelectorAll('button,input[type=submit],a[role=button]')]
      .filter(visible).filter(e => !host.contains(e))
      .filter(e => /^(?:вход|войти|log\s*in|login|sign\s*in)$/i.test(
        (e.innerText || e.value || '').trim()));
    if (passwords.length !== 1 || buttons.length !== 1) return null;
    return {field:passwords[0],button:buttons[0]};
  }
  function lockout() {
    // Ignore the text of RouterLab's own panel; only inspect the stock page.
    const t = text();
    return /(?:слишком много попыток|too many (?:login )?attempts|exceeded (?:the )?(?:maximum|five|5) login attempts)/i.test(t);
  }
  function readRows(object, attrs) {
    const vendor = window.$;
    if (typeof vendor?.act !== 'function' || typeof vendor?.exe !== 'function')
      throw Error('STOCK_API_NOT_READY');
    if (vendor.as?.length || vendor.ds?.length) throw Error('VENDOR_QUEUE_BUSY');
    const rows = vendor.act(typeof window.ACT_GL === 'number' ? window.ACT_GL : 5,
      object, '0,0,0,0,0,0', '0,0,0,0,0,0', attrs);
    if (!Array.isArray(rows)) throw Error('VENDOR_ROWS_UNAVAILABLE');
    if (vendor.exe() !== 0) throw Error('VENDOR_READ_REJECTED');
    return rows;
  }
  function band(rows,re) {
    const candidates = rows.filter(x => re.test(String(x?.X_TP_Band || '')));
    if (candidates.length !== 1 || typeof candidates[0].SSID !== 'string' ||
        !candidates[0].SSID || !validStack(candidates[0].__stack)) return null;
    return candidates[0];
  }
  function enabled(value) {
    if (String(value) === '1') return 'включён';
    if (String(value) === '0') return 'выключен';
    return 'нет данных';
  }
  function readProtected() {
    // The *real* vendor API must respond to both dynamic WLAN objects.
    // A successful HTML page or HTTP 200 is never treated as authenticated.
    const rows = readRows('LAN_WLAN',
      ['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']);
    const a = band(rows, /2[.,]?4\s*(?:g|ghz)?/i);
    const b = band(rows, /(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i);
    if (!a || !b || a.__stack === b.__stack) throw Error('WLAN_PROTECTED_READ_UNCONFIRMED');
    lastRead = {a,b};
    el('ssid24').textContent = a.SSID;
    el('ssid5').textContent = b.SSID;
    el('extra24').textContent = 'Радиомодуль ' + enabled(a.Enable);
    el('extra5').textContent = 'Радиомодуль ' + enabled(b.Enable);
    // WAN is an independent optional read: do not misreport it as DHCP.
    try {
      const wan = readRows('WAN_IP_CONN',
        ['enable','name','addressingType','X_TP_IPv4Enabled']);
      const active = wan.filter(x => String(x?.enable) === '1' &&
        String(x?.X_TP_IPv4Enabled) === '1');
      el('wan-type').textContent = active.length === 1
        ? (active[0].addressingType || 'Нет данных') : 'Нет данных';
    } catch (_) {
      el('wan-type').textContent = 'Нет данных';
      note('WAN_READ_UNCONFIRMED');
    }
    show('dashboard',true);
    show('auth',false);
    unlocked = true;
    status('Авторизация подтверждена защищённым чтением Wi-Fi.');
    return true;
  }
  function interfaceState() {
    if (lockout()) return 'LOGIN_LOCKED';
    const p = [...document.querySelectorAll('input[type=password]')]
      .filter(visible).filter(e=>!host.contains(e));
    if (p.length >= 2) return 'FACTORY_PASSWORD';
    if (getLoginForm()) return 'LOGIN_FORM';
    return 'POSSIBLY_AUTHENTICATED';
  }
  async function check() {
    if (busy || logoutLocked) return;
    busy = true;
    el('refresh').disabled = true;
    try {
      const state = interfaceState();
      stage = state;
      if (state === 'LOGIN_LOCKED') {
        show('dashboard',false);show('auth',false);
        status('TP-Link ограничил попытки входа. Дождитесь снятия блокировки.');
      } else if (state === 'FACTORY_PASSWORD') {
        show('dashboard',false);show('auth',false);
        status('Обнаружена первичная настройка TP-Link. Автозапись не поддерживается.');
      } else if (state === 'LOGIN_FORM' && !clickOnce) {
        show('auth',true);show('dashboard',false);
        status('Archer C20 обнаружен. Введите пароль администратора.');
      } else {
        try { readProtected(); }
        catch (e) {
          unlocked = false;
          show('dashboard',false);
          const form = getLoginForm();
          show('auth',!!form && !clickOnce);
          status('Чтение Wi-Fi пока не подтверждено: ' + String(e.message || e).slice(0,80) +
            '. Повторное введение пароля автоматически не выполняется.');
        }
      }
    } finally { busy=false;el('refresh').disabled=false; }
  }
  async function login(event) {
    event.preventDefault();
    if (busy || clickOnce || stage !== 'LOGIN_FORM' || lockout()) return;
    const form = getLoginForm();
    const input = el('admin-pass');
    const password = input.value;
    if (!form || !password) {
      el('auth-error').textContent = 'Не удалось подтвердить штатную форму входа.';
      return;
    }
    // The firmware itself creates its encrypted RSA/AES login packet.
    // The candidate model AND GDPR signature were checked before mounting.
    busy=true;clickOnce=true;input.value='';show('auth',false);
    status('Вход отправлен через штатную форму. Проверяем сессию без повторной отправки…');
    try {
      form.field.value=password;
      form.field.dispatchEvent(new Event('input',{bubbles:true}));
      form.field.dispatchEvent(new Event('change',{bubbles:true}));
      form.button.click(); // Exactly one explicit user-requested stock login.
      form.field.value='';
      setTimeout(()=>{busy=false;check();},2200);
    } catch (_) {
      form.field.value='';
      busy=false;
      status('Штатный вход не был выполнен. Повтор заблокирован до перезагрузки страницы.');
    }
  }
  function logout() {
    unlocked=false;logoutLocked=true;
    show('dashboard',false);show('auth',false);
    status('Управление RouterLab закрыто. Это не выход из сессии самого TP-Link.');
  }
  async function validateFingerprint() {
    // Safe pre-auth request; no password, no configuration write.
    let xhr;
    try {
      xhr = await new Promise((resolve,reject)=>{
        const req = new XMLHttpRequest();
        req.open('POST',location.origin+'/cgi/getGDPRParm',true);
        req.timeout=4500;
        req.onload=()=>resolve(req);
        req.onerror=()=>reject(Error('NETWORK_ERROR'));
        req.ontimeout=()=>reject(Error('TIMEOUT'));
        req.send(null);
      });
    } catch (_) { return false; }
    const t=String(xhr.responseText||'');
    const val=k=>t.match(new RegExp('(?:^|[;\\s,{])(?:var\\s+)?'+k+'\\s*[:=]\\s*["\\x27]?([0-9a-fA-F]+)','im'))?.[1]||'';
    return xhr.status===200 && /^[0-9a-f]{128}$/i.test(val('nn')) &&
      /^[0-9a-f]{1,8}$/i.test(val('ee')) && /^\d+$/.test(val('seq'));
  }
  (async()=>{
    // TP-Link renders some login pages after document end. Allow the stock
    // model label to appear before probing, without a host-wide IP sweep.
    for (let i=0; i<25 && !/\bArcher\s*C20\b/i.test(text()); i++) {
      await new Promise(resolve=>setTimeout(resolve,240));
    }
    if (!/\bArcher\s*C20\b/i.test(text())) return;
    if (!await validateFingerprint()) return;
    mounted=true;
    document.body.appendChild(host);
    if (!reported) {
      reported=true;
      bridge('tplinkProbe',{supported:true,model:'Archer C20',firmwareConfirmed:false});
    }
    await check();
  })().catch(()=>{});
  el('auth').addEventListener('submit',login);
  el('refresh').addEventListener('click',()=>{clickOnce=false;check();});
  el('lock').addEventListener('click',logout);
  window.__RouterLabC20Pilot=Object.freeze({check});
})();
