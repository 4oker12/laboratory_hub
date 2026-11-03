/* RouterLab Archer C20 v5 / 200821 - cautious same-origin iOS read-only pilot.
 * The real stock input and button are visually skinned into RouterLab.
 * User keyboard/tap events go straight to those nodes: no synthetic login.
 * No invented CGI packets, configuration writes, saved credentials or auto-retries.
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
  let checkingExistingSession = false;
  let stockSkin = null;
  const nativeClickBound = new WeakSet();
  let loginReadTimer = null;
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
    '<label>Пароль администратора</label><div id="native-pass-slot" style="height:48px;margin:8px 0 12px"></div>' +
    '<div id="native-submit-slot" style="height:46px;margin:0 0 8px"></div>' +
    '<p class="muted">Поле и кнопка принадлежат TP-Link. Ввод и нажатие обрабатывает сам роутер.</p>' +
    '<p id="auth-error" class="error" role="alert"></p></form>' +
    '<div id="dashboard"><div class="card"><span>Устройство</span><strong>TP-Link Archer C20</strong>' +
    '<small id="device-extra">Прошивка требует подтверждения</small></div>' +
    '<div class="card"><span>WAN</span><strong id="wan-type">Нет данных</strong></div>' +
    '<div class="card"><span>Wi-Fi 2,4 ГГц</span><strong id="ssid24">Нет данных</strong>' +
    '<small id="extra24"></small></div>' +
    '<div class="card"><span>Wi-Fi 5 ГГц</span><strong id="ssid5">Нет данных</strong>' +
    '<small id="extra5"></small></div>' +
    '<button type="button" id="lock" class="secondary">Закрыть управление</button></div>' +
    '<button type="button" id="refresh" class="secondary">Проверить состояние</button>' +
    '<button type="button" id="check-existing" class="secondary">Проверить текущую сессию без пароля</button>' +
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
  // Development-only login transport telemetry. Observe XHR lifecycle
  // without touching request body, headers, credentials, cookie or response.
  // The stock request is forwarded unchanged using the original method.
  // The observer is attached after the Archer C20 fingerprint is confirmed.
  const observedButtons = new WeakSet();
  function attachStockLoginEventTrace() {
    const form = getLoginForm();
    if (!form || observedButtons.has(form.button)) return;
    observedButtons.add(form.button);
    form.button.addEventListener('click', event => {
      note(event.isTrusted ? 'STOCK_BUTTON_TRUSTED_CLICK' : 'STOCK_BUTTON_SYNTHETIC_CLICK');
      // Only a genuine tap/key activation of the *original stock button*
      // starts post-login observation. This listener never submits credentials.
      if (!event.isTrusted || !stockSkin || busy || logoutLocked) return;
      checkingExistingSession = false;
      clickOnce = true;
      writeStamp(STOCK_KEY);
      note('NATIVE_STOCK_LOGIN_TAP');
      status('Штатный вход выполняется. Проверяем настройки без повторной отправки пароля…');
      show('auth', false);
      if (loginReadTimer) clearTimeout(loginReadTimer);
      loginReadTimer = setTimeout(() => {
        loginReadTimer = null;
        if (!mounted || logoutLocked) return;
        check();
      }, 4500);
    }, true);
    note('STOCK_BUTTON_TRACE_ATTACHED');
  }

  // Visual relocation ONLY: original TP-Link nodes stay in their original
  // document/parents, retaining stock handlers, keyboard and trusted clicks.
  // On a stacking-context conflict we fail back to the proven stock page.
  function restoreNativeLogin() {
    if (!stockSkin) return;
    for (const item of stockSkin) {
      if (item.original === null) item.node.removeAttribute('style');
      else item.node.setAttribute('style', item.original);
    }
    stockSkin = null;
  }
  function skinNativeLogin() {
    if (stockSkin) return true;
    const form = getLoginForm();
    if (!form) { note('NATIVE_LOGIN_FORM_MISSING'); return false; }
    const pairs = [
      [form.field, el('native-pass-slot'), false],
      [form.button, el('native-submit-slot'), true]
    ];
    if (pairs.some(([,slot]) => !slot.getBoundingClientRect().width)) {
      note('NATIVE_LOGIN_SLOT_MISSING'); return false;
    }
    const originals = [];
    try {
      for (const [node,slot,isButton] of pairs) {
        const rect=slot.getBoundingClientRect();
        originals.push({node,original:node.getAttribute('style')});
        const fixed = {
          position:'fixed',top:rect.top+'px',left:rect.left+'px',
          width:rect.width+'px',height:rect.height+'px',
          'z-index':'2147483647',margin:'0',transform:'none',
          'box-sizing':'border-box',opacity:'1',
          'font-size':'16px',padding:'10px',
          'border-radius':'10px',
          background:isButton?'#11639c':'white',
          color:isButton?'white':'#14212d',
          border:isButton?'0':'1px solid #a8b8c6',
          'pointer-events':'auto'
        };
        for (const [key,value] of Object.entries(fixed))
          node.style.setProperty(key,value,'important');
      }
      stockSkin=originals;
      note('NATIVE_LOGIN_SKIN_PLACED');
      requestAnimationFrame(() => {
        if (!stockSkin) return;
        const hittable = pairs.every(([node,slot]) => {
          const r=slot.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return hit===node || node.contains(hit);
        });
        if (!hittable) {
          note('NATIVE_LOGIN_HITTEST_FAILED');
          openStockLogin();
        } else note('NATIVE_LOGIN_HITTEST_OK');
      });
      return true;
    } catch (_) {
      stockSkin=originals;
      restoreNativeLogin();
      note('NATIVE_LOGIN_SKIN_FAILED');
      return false;
    }
  }
  function showNativeLogin() {
    if (!getLoginForm()) { openStockLogin(); return; }
    show('auth',true);
    show('dashboard',false);
    attachStockLoginEventTrace();
    if (!skinNativeLogin()) openStockLogin();
  }
  function installXHRLoginTelemetry() {
    if (window.__RouterLabC20XHRObserved) return;
    const proto = window.XMLHttpRequest?.prototype;
    if (!proto || typeof proto.open !== 'function' ||
        typeof proto.send !== 'function') {
      note('XHR_OBSERVER_UNAVAILABLE');
      return;
    }
    const originalOpen=proto.open, originalSend=proto.send;
    const tracked=new WeakMap();
    const counts = new Map();
    const routeOf = resource => {
      try {
        const url = new URL(String(resource), location.href);
        if (url.origin !== location.origin) return '';
        if (url.pathname === '/cgi_gdpr') return 'GDPR';
        if (url.pathname === '/cgi/login') return 'LOGIN';
        return '';
      } catch (_) { return ''; }
    };
    function emit(code) {
      const count=counts.get(code)||0;
      if (count>=8) return;
      counts.set(code,count+1);
      try { note(code); } catch (_) {}
    }
    proto.open=function(method,url) {
      // Do not read, rewrite or store the URL/query string.
      const label=routeOf(url);
      if (label && String(method).toUpperCase() === 'POST')
        tracked.set(this,label);
      return Reflect.apply(originalOpen,this,arguments);
    };
    proto.send=function() {
      const label=tracked.get(this);
      if (label) {
        emit('XHR_'+label+'_POST_SENT');
        try {
          this.addEventListener('loadend',()=>{
            const status=this.status;
            if (Number.isInteger(status) && status>=100 && status<=599)
              emit('XHR_'+label+'_HTTP_'+String(status));
            else emit('XHR_'+label+'_NO_HTTP_STATUS');
          },{once:true});
          this.addEventListener('error',()=>emit('XHR_'+label+'_NETWORK_ERROR'),{once:true});
          this.addEventListener('timeout',()=>emit('XHR_'+label+'_TIMEOUT'),{once:true});
          this.addEventListener('abort',()=>emit('XHR_'+label+'_ABORTED'),{once:true});
        } catch (_) {}
      }
      // In particular NEVER inspect arguments[0] (encrypted credential body).
      return Reflect.apply(originalSend,this,arguments);
    };
    Object.defineProperty(window,'__RouterLabC20XHRObserved',{value:true});
    note('XHR_OBSERVER_INSTALLED');
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
    restoreNativeLogin();
    show('dashboard',true);
    show('auth',false);
    unlocked = true;
    if (checkingExistingSession) {
      // Seeing even structurally complete WLAN/WAN rows does not by itself
      // prove the firmware required an authenticated session to serve them.
      // In particular, physical auth was never verified for this model
      // by testing the same request before a login.
      note('CONFIG_READBACK_OK_AUTH_NOT_PROVEN');
      status('Wi-Fi и WAN прочитаны без повторного пароля. Действительность сессии входа отдельно не доказана.');
    } else {
      note('SESSION_READBACK_VERIFIED');
      status('Wi-Fi прочитан после попытки штатного входа. Проверка статуса сессии независимым способом ещё не выполнена.');
    }
    try { sessionStorage.removeItem(STOCK_KEY); } catch (_) {}
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
      } else if (state === 'LOGIN_FORM' && !clickOnce && !checkingExistingSession) {
        note('LOGIN_FORM_READY');
        showNativeLogin();
        status('Archer C20 обнаружен. Введите пароль в штатное поле TP-Link внутри RouterLab.');
      } else {
        show('auth',false);
        try { await readProtected(); }
        catch (e) {
          unlocked = false;
          show('dashboard',false);
          const code=String(e?.message||'READ_UNKNOWN');
          note('READ_FAILED_' + (/^[A-Z0-9_]{3,42}$/.test(code)?code:'UNCLASSIFIED'));
          el('diagnostics').open=true;
          status('Настройки пока не подтверждены (' +
            (/^[A-Z0-9_]{3,42}$/.test(code)?code:'READ_UNKNOWN') + ').');
          if (state === 'LOGIN_FORM' && !checkingExistingSession) {
            clickOnce=false;
            try { sessionStorage.removeItem(STOCK_KEY); } catch (_) {}
            showNativeLogin(); // A NEW tap is always a user decision, never an auto retry.
          } else {
            restoreNativeLogin();
            status('Не удалось прочитать настройки. Пароль не отправлялся повторно.');
          }
        }
      }
    } finally { busy=false;el('refresh').disabled=false; }
  }
  function checkExistingSession() {
    // Explicit read-only test: never click the login form, never use a
    // stored password or claim authentication from an HTTP 200.
    if (busy || logoutLocked || !mounted) return;
    restoreNativeLogin();
    checkingExistingSession = true;
    clickOnce = true;
    note('EXISTING_SESSION_READ_REQUESTED');
    check();
  }
  function openStockLogin() {
    // Prefer a real user gesture on the genuine TP-Link login page. This
    // avoids synthetic click / input behavior that can differ in WKWebView.
    if (busy || !mounted || !document.body.contains(host)) return;
    restoreNativeLogin();
    writeStamp(STOCK_KEY);
    attachStockLoginEventTrace();
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
    checkingExistingSession = true;
    clickOnce = true;
    note('USER_REQUESTED_POSTLOGIN_CHECK');
    check();
  }
  function logout() {
    restoreNativeLogin();
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
    installXHRLoginTelemetry();
    document.body.appendChild(host);
    document.body.appendChild(restore);
    if (!reported) {
      reported=true;
      bridge('tplinkProbe',{supported:true,model:'Archer C20',firmwareConfirmed:false});
    }
    if (resumedStockFlow) {
      // The stock page can be replaced during login. First test protected
      // readback within this same origin; never submit the password again.
      note('STOCK_FLOW_RESTORED_AFTER_NAV');
    }
    await check();
    attachStockLoginEventTrace();
  })().catch(()=>{ note('BOOTSTRAP_EXCEPTION'); });
  // No RouterLab password form or synthetic .click() exists anymore.
  // Keep CSS positioning aligned after keyboard/viewport changes.
  const reflowNative = () => {
    if (!stockSkin) return;
    restoreNativeLogin();
    skinNativeLogin();
  };
  window.addEventListener('resize',reflowNative);
  window.visualViewport?.addEventListener('resize',reflowNative);
  // Refresh must never remove the one-click login fence. A new page load
  // is required to initiate another credential submission.
  el('refresh').addEventListener('click',()=>check());
  el('check-existing').addEventListener('click',checkExistingSession);
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
