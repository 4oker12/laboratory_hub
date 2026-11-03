/* RouterLab Archer C20 v5 / 200821 - cautious same-origin iOS read-only pilot.
 * Stock TP-Link encrypted login is invoked through its own visible form.
 * No invented /cgi_gdpr packets, write requests, saved credentials, or retry loops.
 */
(() => {
  'use strict';
  if (window.__RouterLabC20Pilot || !document.body) return;
  const text = () => (document.title + ' ' + (document.body?.innerText || '').slice(0,12000));
  // Diagnostic values are fixed codes only: never credentials, tokens, SSIDs,
  // URLs with query strings, cookies, raw HTML or router responses.
  const TRACE_KEY = 'routerlab_c20_trace_v2';
  const STOCK_KEY = 'routerlab_c20_stock_flow_v2';
  const FINGERPRINT_KEY = 'routerlab_c20_origin_fingerprint_v2';
  const MAX_AGE = 15 * 60 * 1000;
  function readStamp(key) {
    try {
      const data = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (data && Number.isFinite(data.at) && Date.now()-data.at < MAX_AGE && data.at <= Date.now())
        return true;
    } catch (_) {}
    return false;
  }
  function writeStamp(key) {
    try { sessionStorage.setItem(key,JSON.stringify({at:Date.now()})); }
    catch (_) { /* session storage disabled - do not assume persistence */ }
  }
  const resumedStockFlow = readStamp(STOCK_KEY);
  const previouslyVerifiedOrigin = readStamp(FINGERPRINT_KEY);
  const visible = el => !!el && !el.disabled && el.getClientRects().length > 0;
  const validStack = x => /^\d+(?:,\d+){5}$/.test(String(x || ''));
  let busy = false, unlocked = false, mounted = false, reported = false, clickOnce = resumedStockFlow;
  let stage = 'PROBING', lastRead = null, logoutLocked = false;
  let logs = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]');
    if (Array.isArray(saved)) logs = saved.filter(x =>
      typeof x === 'string' && /^\d\d:\d\d:\d\d [A-Z0-9_]{3,60}$/.test(x)).slice(-40);
  } catch (_) {}

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
    '.diag{background:#e7eef6;border:1px solid #b7c8da;border-radius:12px;padding:12px;margin-top:13px}' +
    '.diag pre{user-select:text;-webkit-user-select:text;min-height:84px;max-height:320px}' +
    'pre{font-size:11px;max-height:170px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '</style><div class="panel"><div class="top">RouterLab · TP-Link Archer C20</div>' +
    '<div class="content"><p id="status" role="status">Определяем TP-Link…</p>' +
    '<p id="info" class="muted">Режим проверки: изменение настроек Wi-Fi/WAN отключено. На авторизацию это не влияет.</p>' +
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
    '<button type="button" id="stock-auth" class="secondary">Открыть штатный вход TP-Link</button>' +
    '<details id="diagnostics" class="diag"><summary>Диагностика RouterLab · журнал событий</summary>' +
    '<p class="muted">Коды состояния без паролей, cookies, токенов и содержимого ответов.</p>' +
    '<button type="button" id="copy-log" class="secondary">Скопировать логи</button>' +
    '<pre id="log"></pre></details>' +
    '</div></div>';
  const restore = document.createElement('button');
  restore.id = 'routerlab-c20-restore';
  restore.textContent = 'Проверить RouterLab после штатного входа';
  restore.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;left:12px;right:12px;' +
    'display:none;padding:14px;border:0;border-radius:12px;color:white;background:#11639c;' +
    'font:600 14px -apple-system,BlinkMacSystemFont,Arial,sans-serif;box-shadow:0 4px 18px #0006;';
  const el = id => shadow.getElementById(id);
  const show = (id, yes) => { el(id).style.display = yes ? 'block' : 'none'; };
  const status = s => { el('status').textContent = s; };
  function note(code) {
    // Restrict to internal constant event IDs. Only safe metadata persists.
    if (typeof code !== 'string' || !/^[A-Z0-9_]{3,60}$/.test(code)) return;
    const time = new Date();
    const stamp = [time.getHours(),time.getMinutes(),time.getSeconds()]
      .map(n => String(n).padStart(2,'0')).join(':');
    logs.push(stamp + ' ' + code);
    if (logs.length > 40) logs = logs.slice(-40);
    try { sessionStorage.setItem(TRACE_KEY, JSON.stringify(logs)); } catch (_) {}
    el('log').textContent = logs.join('\n');
    bridge('tplinkDiagnostic',{code});
  }
  el('log').textContent = logs.join('\n');
  function bridge(type, data={}) {
    try { window.webkit?.messageHandlers?.routerlab?.postMessage({type,...data}); }
    catch (_) { /* browser mock has no native bridge */ }
  }
  // Passive vendor network observation. It does not modify XHR, cookies,
  // headers, password input, response bodies or stock login handlers.
  // Only path-specific fixed codes are saved, never the resource URL itself.
  function observeStockResourceTiming() {
    if (typeof PerformanceObserver !== 'function') {
      note('STOCK_RESOURCE_OBSERVER_UNAVAILABLE');
      return;
    }
    let logged=0;
    const counts = new Map();
    const kind = name => {
      try {
        const url = new URL(name, location.href);
        if (url.origin !== location.origin) return '';
        if (url.pathname === '/cgi_gdpr') return 'STOCK_CGI_GDPR_OBSERVED';
        if (url.pathname === '/cgi/getBusy') return 'STOCK_BUSY_RESOURCE_OBSERVED';
        if (url.pathname === '/cgi/login') return 'STOCK_LOGIN_RESOURCE_OBSERVED';
        return '';
      } catch (_) { return ''; }
    };
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (logged >= 16 || entry.entryType !== 'resource') continue;
          const code=kind(entry.name);
          if (!code || (counts.get(code)||0)>=6) continue;
          counts.set(code,(counts.get(code)||0)+1);
          logged++;
          // Resource timing only proves the browser observed a request.
          // This does NOT establish HTTP success or authenticated session.
          note(code);
        }
      });
      observer.observe({entryTypes:['resource']});
      note('STOCK_RESOURCE_OBSERVER_READY');
    } catch (_) { note('STOCK_RESOURCE_OBSERVER_UNAVAILABLE'); }
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
    if (typeof vendor?.act !== 'function' || typeof vendor?.exe !== 'function') {
      note('VENDOR_API_NOT_READY');
      return Promise.reject(Error('STOCK_API_NOT_READY'));
    }
    if (vendor.as?.length || vendor.ds?.length) {
      note('VENDOR_QUEUE_BUSY');
      return Promise.reject(Error('VENDOR_QUEUE_BUSY'));
    }
    const objectLabel = object === 'LAN_WLAN' ? 'WLAN' : 'WAN';
    note(objectLabel + '_VENDOR_QUEUE_START');
    // Stock TP-Link's $.act() queues an operation; $.exe(callback) completes
    // it asynchronously. An immediate zero return is only a queue ACK.
    // Never interpret the rows before the vendor completion callback.
    return new Promise((resolve,reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        note(objectLabel + '_VENDOR_CALLBACK_TIMEOUT');
        finish(Error('VENDOR_READ_TIMEOUT'));
      }, 7000);
      function finish(error, rows) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(rows);
      }
      let rows;
      try {
        rows = vendor.act(typeof window.ACT_GL === 'number' ? window.ACT_GL : 5,
          object, '0,0,0,0,0,0', '0,0,0,0,0,0', attrs);
        if (!Array.isArray(rows)) return finish(Error('VENDOR_ROWS_UNAVAILABLE'));
        const acknowledgement = vendor.exe(error => {
          if (error && error !== 0) {
            note(objectLabel + '_VENDOR_CALLBACK_ERROR');
            return finish(Error('VENDOR_CGI_READ_ERROR'));
          }
          note(objectLabel + '_VENDOR_CALLBACK_OK');
          finish(null, rows);
        });
        if (acknowledgement !== 0 && acknowledgement !== undefined)
          finish(Error('VENDOR_READ_REJECTED'));
        note(objectLabel + '_VENDOR_EXEC_ACCEPTED');
      } catch (_) { finish(Error('VENDOR_READ_EXCEPTION')); }
    });
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
  async function readProtected() {
    // The *real* vendor API must respond to both dynamic WLAN objects.
    // A successful HTML page or HTTP 200 is never treated as authenticated.
    note('WLAN_READ_STARTED');
    const rows = await readRows('LAN_WLAN',
      ['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']);
    const a = band(rows, /2[.,]?4\s*(?:g|ghz)?/i);
    const b = band(rows, /(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i);
    if (!a || !b || a.__stack === b.__stack) throw Error('WLAN_PROTECTED_READ_UNCONFIRMED');
    lastRead = {a,b};
    note('WLAN_PROTECTED_24_5_VERIFIED');
    el('ssid24').textContent = a.SSID;
    el('ssid5').textContent = b.SSID;
    el('extra24').textContent = 'Радиомодуль ' + enabled(a.Enable);
    el('extra5').textContent = 'Радиомодуль ' + enabled(b.Enable);
    // WAN is an independent optional read: do not misreport it as DHCP.
    try {
      note('WAN_READ_STARTED');
      const wan = await readRows('WAN_IP_CONN',
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
    note('SESSION_READBACK_VERIFIED');
    try { sessionStorage.removeItem(STOCK_KEY); } catch (_) {}
    status('Сессия подтверждена защищённым чтением Wi-Fi.');
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
      note('STATE_' + state);
      if (state === 'LOGIN_LOCKED') {
        show('dashboard',false);show('auth',false);
        status('TP-Link ограничил попытки входа. Дождитесь снятия блокировки.');
      } else if (state === 'FACTORY_PASSWORD') {
        show('dashboard',false);show('auth',false);
        status('Обнаружена первичная настройка TP-Link. Автозапись не поддерживается.');
      } else if (state === 'LOGIN_FORM' && !clickOnce) {
        show('auth',true);show('dashboard',false);
        note('LOGIN_FORM_READY');
        status('Archer C20 обнаружен. Рекомендуется штатный вход TP-Link.');
      } else {
        show('auth',false);
        try { await readProtected(); }
        catch (e) {
          unlocked = false;
          show('dashboard',false);
          const code=String(e?.message||'READ_UNKNOWN');
          note('READ_FAILED_' + (/^[A-Z0-9_]{3,42}$/.test(code)?code:'UNCLASSIFIED'));
          el('diagnostics').open=true;
          status('После входа конфигурация пока не прочитана (' +
            (/^[A-Z0-9_]{3,42}$/.test(code)?code:'READ_UNKNOWN') +
            '). Откройте диагностику. Повторный пароль не отправляется.');
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
    writeStamp(STOCK_KEY);
    note('PANEL_LOGIN_BUTTON_REQUESTED');
    status('Вход отправлен через штатную форму. Проверяем сессию без повторной отправки…');
    try {
      form.field.value=password;
      form.field.dispatchEvent(new Event('input',{bubbles:true}));
      form.field.dispatchEvent(new Event('change',{bubbles:true}));
      form.button.click(); // Exactly one explicit user-requested stock login.
      note('STOCK_LOGIN_CLICK_DISPATCHED');
      // Stock router login may read the field asynchronously. Keep it until
      // after its handler has had a bounded chance to consume it.
      setTimeout(()=>{
        try { form.field.value=''; } catch (_) { /* stock navigation */ }
        busy=false;
        check(); // Protected read; never a repeated password submission.
      },5200);
    } catch (_) {
      form.field.value='';
      busy=false;
      status('Штатный вход не был выполнен. Повтор заблокирован до перезагрузки страницы.');
    }
  }
  function openStockLogin() {
    // Prefer a real user gesture on the genuine TP-Link login page. This
    // avoids synthetic click / input behavior that can differ in WKWebView.
    if (busy || !mounted || !document.body.contains(host)) return;
    writeStamp(STOCK_KEY);
    host.style.display = 'none';
    restore.style.display = 'block';
    clickOnce = true; // Never re-submit earlier passwords from RouterLab.
    note('STOCK_LOGIN_UI_SHOWN');
  }
  function restoreAfterStock() {
    restore.style.display = 'none';
    if (!document.body.contains(host)) return;
    host.style.display = '';
    // This action only inspects the current session, without submitting login.
    clickOnce = true;
    note('USER_REQUESTED_POSTLOGIN_CHECK');
    check();
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
    } catch (_) {
      note('GDPR_PARAMS_NETWORK_OR_TIMEOUT');
      return false;
    }
    if (Number.isInteger(xhr.status) && xhr.status >= 100 && xhr.status <= 599)
      note('GDPR_PARAMS_HTTP_' + String(xhr.status));
    const t=String(xhr.responseText||'');
    const val=k=>t.match(new RegExp('(?:^|[;\\s,{])(?:var\\s+)?'+k+'\\s*[:=]\\s*["\\x27]?([0-9a-fA-F]+)','im'))?.[1]||'';
    return xhr.status===200 && /^[0-9a-f]{128}$/i.test(val('nn')) &&
      /^[0-9a-f]{1,8}$/i.test(val('ee')) && /^\d+$/.test(val('seq'));
  }
  (async()=>{
    note('DOCUMENT_BOOTSTRAP');
    // Stock login can navigate to a document without the model in its title.
    // A recent fingerprint from this SAME router origin permits recovery,
    // but a fresh valid GDPR response is still mandatory.
    const hasModel = () => /\bArcher\s*C20\b/i.test(text());
    if (!previouslyVerifiedOrigin || !resumedStockFlow) {
      for (let i=0; i<25 && !hasModel(); i++)
        await new Promise(resolve=>setTimeout(resolve,240));
      if (!hasModel()) return;
    }
    note('MODEL_OR_RECOVERY_MARKER_OK');
    observeStockResourceTiming();
    if (previouslyVerifiedOrigin && resumedStockFlow) {
      // A new /cgi/getGDPRParm call after native TP-Link login might rotate
      // RSA/session state. The existing SAME-ORIGIN time-bounded fingerprint
      // suffices only to restore the diagnostic UI; it is not auth evidence.
      note('POSTLOGIN_RSA_REPROBE_SKIPPED');
    } else {
      const freshFingerprint = await validateFingerprint();
      if (!freshFingerprint) {
        note('GDPR_FINGERPRINT_NOT_CONFIRMED');
        return;
      }
      note('GDPR_FINGERPRINT_OK');
      writeStamp(FINGERPRINT_KEY);
    }
    mounted=true;
    document.body.appendChild(host);
    document.body.appendChild(restore);
    if (!reported) {
      reported=true;
      bridge('tplinkProbe',{supported:true,model:'Archer C20',firmwareConfirmed:false});
    }
    if (resumedStockFlow) {
      // A genuine stock login may navigate to a NEW document. Never
      // re-cover it with the initial password prompt on that navigation.
      host.style.display='none';
      restore.style.display='block';
      note('STOCK_FLOW_RESTORED_AFTER_NAV');
      return;
    }
    await check();
  })().catch(()=>{ note('BOOTSTRAP_EXCEPTION'); });
  el('auth').addEventListener('submit',login);
  // Refresh must never remove the one-click login fence. A new page load
  // is required to initiate another credential submission.
  el('refresh').addEventListener('click',()=>check());
  el('stock-auth').addEventListener('click',openStockLogin);
  restore.addEventListener('click',restoreAfterStock);
  el('lock').addEventListener('click',logout);
  el('copy-log').addEventListener('click',async()=>{
    const value=logs.join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(value);
      status('Коды диагностики скопированы.');
    } catch (_) {
      const field=document.createElement('textarea');
      field.value=value;
      field.style.cssText='position:fixed;top:0;left:0;width:100%;height:100px;z-index:2147483647';
      document.body.appendChild(field);
      field.focus();field.select();
      try { document.execCommand('copy'); } catch (_) {}
      field.remove();
      status('Скопируйте текст из раздела «Диагностика» вручную, если буфер недоступен.');
    }
  });
  window.__RouterLabC20Pilot=Object.freeze({check});
})();
