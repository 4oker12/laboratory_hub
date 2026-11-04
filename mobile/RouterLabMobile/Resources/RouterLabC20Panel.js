/* RouterLab Archer C20 v5 / 200821 - cautious same-origin iOS read-only pilot.
 * The real stock input and button are visually skinned into RouterLab.
 * User keyboard/tap events go straight to those nodes: no synthetic login.
 * No invented CGI packets, configuration writes or stored credentials.
 * The initial device fingerprint is passive: no independent GDPR parameter POST.
 */
(() => {
  'use strict';
  if (window.__RouterLabC20Pilot || !document.body) return;
  const text = () => (document.title + ' ' + (document.body?.innerText || '').slice(0,12000));
  // Diagnostic values are fixed codes only: never credentials, tokens, SSIDs,
  // URLs with query strings, cookies, raw HTML or router responses.
  const TRACE_KEY = 'routerlab_c20_trace_v3';
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
  let fallbackShown = false;
  let stockLoginWindow = false;
  let navigationStarted = false;
  let hiddenStock = [];
  let hitTestGeneration = 0;
  let loginHitVerified = false;
  // A trusted login tap in THIS document may need one protected read if
  // the stock page does not navigate. A persisted marker alone never does.
  let tappedStockLoginHere = false;
  let stage = 'PROBING', lastRead = null, logoutLocked = false;
  let logs = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]');
    if (Array.isArray(saved)) logs = saved.filter(x =>
      typeof x === 'string' && /^\d\d:\d\d:\d\d\.\d{3} [A-Z0-9_]{3,60}$/.test(x)).slice(-200);
  } catch (_) {}

  const host = document.createElement('div');
  host.id = 'routerlab-tplink-c20-ios';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483600;inset:0;width:100vw;height:100dvh;min-height:100vh;background:#f3f7fa;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;';
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
    '#auth,#dashboard,#login-error-panel{display:none}.error{color:#ae2934;font-size:13px}' +
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
    '<div id="login-error-panel" class="card" role="alert"><strong>Вход пока недоступен</strong>' +
    '<p id="login-error-message" class="muted">Проверьте состояние и повторите вход.</p>' +
    '<button type="button" id="retry-login">Повторить</button></div>' +
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
      .map(n => String(n).padStart(2,'0')).join(':') + '.' +
      String(time.getMilliseconds()).padStart(3,'0');
    logs.push(stamp + ' ' + code);
    if (logs.length > 200) logs = logs.slice(-200);
    try { sessionStorage.setItem(TRACE_KEY, JSON.stringify(logs)); } catch (_) {}
    el('log').textContent = logs.join('\n');
    bridge('tplinkDiagnostic',{code,time:stamp});
  }
  el('log').textContent = logs.join('\n');
  function bridge(type, data={}) {
    try { window.webkit?.messageHandlers?.routerlab?.postMessage({type,...data}); }
    catch (_) { /* browser mock has no native bridge */ }
  }
  // Document lifecycle order is essential to distinguish a transport reset
  // from a new navigation destroying the in-flight login XHR.
  window.addEventListener('beforeunload',()=>{
    navigationStarted=true; note('BEFOREUNLOAD');
  },{capture:true});
  window.addEventListener('pagehide',event=>{
    navigationStarted=true; note(event.persisted?'PAGEHIDE_BFCACHE':'PAGEHIDE_NAVIGATING');
  },{capture:true});
  document.addEventListener('visibilitychange',()=>{
    note(document.hidden?'VISIBILITY_HIDDEN':'VISIBILITY_VISIBLE');
  });
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
        if (url.pathname === '/cgi/getGDPRParm') return 'STOCK_GDPR_PARAMS_OBSERVED';
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
    const blurBeforeTap=()=>{
      const focused=document.activeElement;
      if (focused && focused.tagName==='INPUT' && focused.type==='password') {
        focused.blur();
        note('LOGIN_PASSWORD_BLURRED_BEFORE_TAP');
      }
    };
    form.button.addEventListener('pointerdown',blurBeforeTap,{capture:true});
    form.button.addEventListener('touchstart',blurBeforeTap,{capture:true,passive:true});
    form.button.addEventListener('click', event => {
      note(event.isTrusted ? 'STOCK_BUTTON_TRUSTED_CLICK' : 'STOCK_BUTTON_SYNTHETIC_CLICK');
      const scale=Math.round(100*(window.visualViewport?.scale||1));
      note('LOGIN_TAP_SCALE_'+Math.max(1,Math.min(999,scale)));
      // Only a genuine tap/key activation of the *original stock button*
      // starts post-login observation. This listener never submits credentials.
      if (!event.isTrusted || (!stockSkin && !fallbackShown) || busy || logoutLocked) return;
      checkingExistingSession = false;
      tappedStockLoginHere = true;
      clickOnce = true;
      writeStamp(STOCK_KEY);
      note('NATIVE_STOCK_LOGIN_TAP');
      stockLoginWindow = true;
      note(navigator.onLine?'LOGIN_ONLINE_YES':'LOGIN_ONLINE_NO');
      // The same genuine stock button serves both experiences. Record which
      // screen was actually visible; a trusted event alone is not evidence
      // that the RouterLab overlay remained on screen.
      note(fallbackShown ? 'NATIVE_LOGIN_TAP_STOCK_FALLBACK' : 'NATIVE_LOGIN_TAP_OVERLAY');
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

  // The original stock login nodes stay in their original document/parents.
  // Errors never reveal the underlying vendor UI.
  function restoreHiddenStock() {
    for (const item of hiddenStock) {
      if(item.previous===null)item.node.style.removeProperty('visibility');
      else item.node.style.setProperty('visibility',item.previous,'important');
      item.node.style.removeProperty('pointer-events');
    }
    hiddenStock=[];
  }
  function hideStockControls() {
    restoreHiddenStock();
    const form=getLoginForm();
    if(!form)return;
    for(const node of [form.field,form.button]) {
      hiddenStock.push({node,previous:node.style.getPropertyValue('visibility')||null});
      node.style.setProperty('visibility','hidden','important');
      node.style.setProperty('pointer-events','none','important');
    }
  }
  function showLoginError(code, explanation) {
    note(code);
    hitTestGeneration++;
    restoreNativeLogin();
    hideStockControls();
    fallbackShown=false;
    show('auth',false);
    show('dashboard',false);
    show('login-error-panel',true);
    el('login-error-message').textContent=explanation;
    status('RouterLab: требуется повторная попытка входа.');
    el('diagnostics').open=true;
  }
  function retryLogin() {
    if (busy || logoutLocked) return;
    restoreHiddenStock();
    show('login-error-panel',false);
    note('LOGIN_USER_RETRY_REQUESTED');
    document.activeElement?.blur();
    setTimeout(()=>showNativeLogin(),300);
  }
  function restoreNativeLogin() {
    loginHitVerified = false;
    if (!stockSkin) return;
    for (const item of stockSkin) {
      if (item.original === null) item.node.removeAttribute('style');
      else item.node.setAttribute('style', item.original);
    }
    stockSkin = null;
  }
  function skinNativeLogin() {
    if (stockSkin) return true;
    loginHitVerified = false;
    const generation=++hitTestGeneration;
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
          // Keep real stock controls invisible until geometry is verified.
          // opacity:0 preserves hit testing; visibility:hidden would not.
          'box-sizing':'border-box',opacity:'0',
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
      // Bound retries: 300ms intervals, 5s total, after viewport settling.
      // Never treat a blocked native target as a successful login button.
      const started=Date.now();
      const coord=n=>Number.isFinite(n) ? (n<0?'N':'')+String(Math.min(9999,Math.abs(Math.round(n)))):'UNK';
      const domLabel=v=>{
        const raw=String(v||'').split(/\s+/)[0];
        return /^[a-z][a-z0-9_-]{0,18}$/i.test(raw) &&
          !/(?:TOKEN|SECRET|SESSION|PASSWORD|CREDENTIAL|NONCE)/i.test(raw)
          ? raw.toUpperCase().replace(/-/g,'_') : 'REDACTED';
      };
      function geometry(attempt) {
        const vv=window.visualViewport;
        const scale=vv?.scale||1;
        const active=document.activeElement;
        const focused=active?.tagName==='INPUT';
        const keyboard=focused && vv && vv.height < innerHeight*0.82;
        note('HIT_TEST_ATTEMPT_'+Math.min(99,attempt));
        note('HIT_VIEW_SCALE_'+Math.min(999,Math.round(scale*100)));
        note('HIT_WIN_'+coord(innerWidth)+'_'+coord(innerHeight));
        note('HIT_VV_'+coord(vv?.width||innerWidth)+'_'+coord(vv?.height||innerHeight));
        note(focused?'HIT_ACTIVE_INPUT_YES':'HIT_ACTIVE_INPUT_NO');
        note(keyboard?'HIT_KEYBOARD_PROBABLE_YES':'HIT_KEYBOARD_PROBABLE_NO');
        return {scale,keyboard};
      }
      function checkTargets() {
        // Observe the actual rendered target, never assume that a fixed
        // positioned child escapes a transformed vendor ancestor.
        // An opacity-zero control remains hittable for this measurement.
        return pairs.map(([node,slot]) => {
          const r=slot.getBoundingClientRect();
          const hit=r.width&&r.height ? document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
          const inWindow=r.width>0 && r.height>0 &&
            r.left+r.width/2>=0 && r.left+r.width/2<innerWidth &&
            r.top+r.height/2>=0 && r.top+r.height/2<innerHeight;
          return {ok:inWindow && (hit===node||node.contains(hit)),hit,inWindow};
        });
      }
      function describeBlocker(label,elem) {
        note('HIT_'+label+'_BLOCK_TAG_'+domLabel(elem?.tagName||'NONE'));
        note('HIT_'+label+'_BLOCK_ID_'+domLabel(elem?.id||'NONE'));
        note('HIT_'+label+'_BLOCK_CLASS_'+domLabel(
          typeof elem?.className==='string'?elem.className:'NONE'));
        const r=elem?.getBoundingClientRect?.();
        if (r) {
          note('HIT_'+label+'_BLOCK_XY_'+coord(r.left)+'_'+coord(r.top));
          note('HIT_'+label+'_BLOCK_WH_'+coord(r.width)+'_'+coord(r.height));
        }
      }
      function removeSafeMask(hit) {
        // Only an explicitly inert loader backdrop may stop intercepting
        // taps. Never hide a password/error/lockout dialog or arbitrary DOM.
        if(!hit || hit===document.body)return false;
        const label=String(hit.id||'')+' '+String(hit.className||'');
        if(!/\b(?:loading-mask|spinner-mask|routerlab-loading-overlay)\b/i.test(label)
           || hit.getAttribute('aria-modal')==='true'
           || /(?:lock|error|failed|password|попыток|парол)/i.test(hit.textContent||''))
          return false;
        hit.style.setProperty('pointer-events','none','important');
        note('HIT_INERT_LOADING_MASK_IGNORED');
        return true;
      }
      function verifyLayout(attempt) {
        if(!stockSkin || generation!==hitTestGeneration ||
           host.style.display==='none') return;
        const view=geometry(attempt);
        const targets=checkTargets();
        // A non-unit scale is NOT itself a blocked DOM target. iOS WebKit
        // can fit a desktop-sized vendor page at 0.4x. Normalize the
        // viewport separately, then require physically tappable controls.
        const realSizes = pairs.map(([,slot])=>{
          const rect=slot.getBoundingClientRect();
          return Math.min(rect.width,rect.height)*view.scale;
        });
        const tapSizeOk=realSizes.every(px=>px>=36);
        if(!view.keyboard && targets.every(x=>x.ok) && tapSizeOk){
          loginHitVerified=true;
          for (const [node] of pairs)
            node.style.setProperty('opacity','1','important');
          note(attempt?'NATIVE_LOGIN_HITTEST_RECOVERED':'NATIVE_LOGIN_HITTEST_OK');
          if(Math.abs(view.scale-1)>0.025)note('HIT_NONUNIT_SCALE_ACCEPTED');
          return;
        }
        if(Date.now()-started<5000){
          if(attempt===0)note('NATIVE_LOGIN_HITTEST_RETRY');
          for(const t of targets)if(!t.ok)removeSafeMask(t.hit);
          setTimeout(()=>verifyLayout(attempt+1),300);
          return;
        }
        if(!tapSizeOk)note('HIT_TAP_TARGET_TOO_SMALL');
        if(Math.abs(view.scale-1)>0.025)note('HIT_VIEWPORT_NONUNIT_SCALE');
        if(view.keyboard)note('HIT_KEYBOARD_BLOCKED');
        if(targets.some(t=>!t.inWindow))note('HIT_TARGET_OUT_OF_WINDOW');
        if(!targets[0].ok) {
          note('NATIVE_LOGIN_HITTEST_FIELD_BLOCKED');
          describeBlocker('FIELD',targets[0].hit);
        }
        if(!targets[1].ok) {
          note('NATIVE_LOGIN_HITTEST_BUTTON_BLOCKED');
          describeBlocker('BUTTON',targets[1].hit);
        }
        note('NATIVE_LOGIN_HITTEST_FAILED');
        showLoginError('LOGIN_LAYOUT_UNSTABLE',
          'Поле входа перекрыто или масштаб страницы не восстановлен. Закройте клавиатуру и нажмите «Повторить».');
      }
      requestAnimationFrame(()=>verifyLayout(0));
      return true;
    } catch (_) {
      stockSkin=originals;
      restoreNativeLogin();
      note('NATIVE_LOGIN_SKIN_FAILED');
      return false;
    }
  }
  function showNativeLogin() {
    restoreHiddenStock();
    if (!getLoginForm()) {
      showLoginError('NATIVE_LOGIN_FORM_MISSING',
        'Штатные элементы входа временно недоступны. Обновите страницу роутера и повторите.');
      return;
    }
    show('login-error-panel',false);
    show('auth',true);
    show('dashboard',false);
    attachStockLoginEventTrace();
    if (!skinNativeLogin()) showLoginError('LOGIN_SKIN_UNAVAILABLE',
      'Невозможно разместить поле TP-Link. Закройте клавиатуру и повторите.');
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
        const isLogin = stockLoginWindow && (label==='GDPR'||label==='LOGIN');
        emit('XHR_'+label+'_POST_SENT');
        if (isLogin) {
          note('LOGIN_XHR_POST_SENT');
          note(navigator.onLine?'LOGIN_XHR_ONLINE_YES':'LOGIN_XHR_ONLINE_NO');
        }
        const xhr=this;
        const ready=()=>Math.max(0,Math.min(4,Number(xhr.readyState)||0));
        try {
          if (isLogin) this.addEventListener('readystatechange',()=>{
            note('LOGIN_XHR_READY_STATE_'+ready());
          });
          this.addEventListener('loadend',()=>{
            const status=this.status;
            if (Number.isInteger(status) && status>=100 && status<=599)
              emit('XHR_'+label+'_HTTP_'+String(status));
            else emit('XHR_'+label+'_NO_HTTP_STATUS');
            if (isLogin) {
              note('LOGIN_XHR_LOADEND_RS_'+ready());
              note('LOGIN_XHR_HTTP_'+(status>=100&&status<=599?status:'NONE'));
              note(navigationStarted?'LOGIN_XHR_NAV_STARTED':'LOGIN_XHR_NAV_NOT_STARTED');
            }
          },{once:true});
          this.addEventListener('error',()=>{
            emit('XHR_'+label+'_NETWORK_ERROR');
            if (isLogin) {
              note('LOGIN_XHR_ONERROR_RS_'+ready());
              note(navigator.onLine?'LOGIN_ERROR_ONLINE_YES':'LOGIN_ERROR_ONLINE_NO');
              note(navigationStarted?'LOGIN_ERROR_AFTER_NAV':'LOGIN_ERROR_BEFORE_NAV');
            }
          },{once:true});
          this.addEventListener('timeout',()=>{
            emit('XHR_'+label+'_TIMEOUT');
            if(isLogin)note('LOGIN_XHR_ONTIMEOUT_RS_'+ready());
          },{once:true});
          this.addEventListener('abort',()=>{
            emit('XHR_'+label+'_ABORTED');
            if(isLogin) {
              note('LOGIN_XHR_ONABORT_RS_'+ready());
              note(navigator.onLine?'LOGIN_ABORT_ONLINE_YES':'LOGIN_ABORT_ONLINE_NO');
            }
          },{once:true});
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
    // The stock encrypted login and protected read share /cgi_gdpr.
    // Close the login-specific telemetry window before any read request.
    stockLoginWindow=false;
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
    restoreHiddenStock();
    restoreNativeLogin();
    show('login-error-panel',false);
    show('dashboard',true);
    show('auth',false);
    unlocked = true;
    fallbackShown = false;
    tappedStockLoginHere = false;
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
      } else if (state === 'LOGIN_FORM' && !checkingExistingSession && !tappedStockLoginHere) {
        // A visible stock login form overrides any saved navigation marker.
        // A marker means 'attempted login', never 'session authenticated'.
        // A protected read here can collide with the stock GDPR/login CGI.
        if (clickOnce || resumedStockFlow) {
          note('LOGIN_MARKER_REJECTED_STOCK_FORM_VISIBLE');
          clickOnce = false;
          try { sessionStorage.removeItem(STOCK_KEY); } catch (_) {}
        }
        note('LOGIN_FORM_READY');
        showNativeLogin();
        status('Archer C20 обнаружен. Введите пароль в штатное поле TP-Link внутри RouterLab.');
      } else {
        show('auth',false);
        if (state === 'LOGIN_FORM') {
          if (tappedStockLoginHere) note('POST_TRUSTED_TAP_PROTECTED_READ');
          else note('EXPLICIT_SESSION_READ_CHECK');
          // The current document saw a trusted tap, or the user explicitly
          // requested a no-password probe. Neither proves authentication.
          status('Проверяем сохранённую сессию TP-Link (до 7 секунд). Если она недействительна, появится поле пароля.');
        } else {
          status('Проверяем защищённые настройки TP-Link…');
        }
        try { await readProtected(); }
        catch (e) {
          unlocked = false;
          show('dashboard',false);
          const code=String(e?.message||'READ_UNKNOWN');
          note('READ_FAILED_' + (/^[A-Z0-9_]{3,42}$/.test(code)?code:'UNCLASSIFIED'));
          el('diagnostics').open=true;
          status('Настройки пока не подтверждены (' +
            (/^[A-Z0-9_]{3,42}$/.test(code)?code:'READ_UNKNOWN') + ').');
          if (state === 'LOGIN_FORM') {
            tappedStockLoginHere = false;
            // An explicit no-password probe must also restore the real login
            // controls when protected readback fails. Otherwise the panel
            // remains empty after the user presses "Check existing session".
            checkingExistingSession = false;
            clickOnce=false;
            try { sessionStorage.removeItem(STOCK_KEY); } catch (_) {}
            note('PRELOGIN_READ_FAILED_SHOW_LOGIN');
            showNativeLogin(); // Never auto-submit a password.
            if (host.style.display !== 'none')
              status('Сессия не подтверждена (' +
                (/^[A-Z0-9_]{3,42}$/.test(code)?code:'READ_UNKNOWN') +
                '). Введите пароль TP-Link в штатное поле.');
          } else {
            restoreNativeLogin();
            status('Не удалось прочитать настройки (' +
              (/^[A-Z0-9_]{3,42}$/.test(code)?code:'READ_UNKNOWN') +
              '). Пароль не отправлялся повторно.');
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
  function revealStockLogin() {
    showLoginError('STOCK_UI_SUPPRESSED',
      'Штатная страница скрыта. Нажмите «Повторить» для проверки расположения поля.');
  }
  function openStockLogin() { revealStockLogin(); }
  function restoreAfterStock() {
    restore.style.display = 'none';
    if (!document.body.contains(host)) return;
    fallbackShown = false;
    if (loginReadTimer) { clearTimeout(loginReadTimer); loginReadTimer=null; }
    host.style.display = '';
    // This action only inspects the current session, without submitting login.
    checkingExistingSession = true;
    clickOnce = true;
    note('USER_REQUESTED_POSTLOGIN_CHECK');
    check();
  }
  function logout() {
    restoreNativeLogin();
    fallbackShown = false;
    if (loginReadTimer) { clearTimeout(loginReadTimer); loginReadTimer=null; }
    unlocked=false;logoutLocked=true;
    show('dashboard',false);show('auth',false);
    status('Управление RouterLab закрыто. Это не выход из сессии самого TP-Link.');
  }
  function passiveC20Evidence() {
    // Never request /cgi/getGDPRParm here; the stock endpoint may rotate the
    // login crypto state and can return 500 for already-authenticated pages.
    const model=/\bArcher\s*C20\b/i.test(text());
    const vendor=typeof window.$?.act==='function' &&
      typeof window.$?.exe==='function';
    const stockLogin=Boolean(getLoginForm());
    let stockNetwork=false;
    try {
      stockNetwork=performance.getEntriesByType('resource').some(entry=>{
        const url=new URL(entry.name,location.href);
        return url.origin===location.origin &&
          ['/cgi/getGDPRParm','/cgi_gdpr','/cgi/getBusy'].includes(url.pathname);
      });
    } catch (_) {}
    // Model title plus actual firmware controls, OR a recent same-origin
    // fingerprint from this WKWebView and real vendor APIs after navigation.
    if (model && (stockLogin || vendor || stockNetwork)) {
      note(stockNetwork?'PASSIVE_STOCK_NETWORK_OK':'PASSIVE_MARKUP_VENDOR_OK');
      writeStamp(FINGERPRINT_KEY);
      return true;
    }
    if (previouslyVerifiedOrigin && vendor) {
      note('PASSIVE_ORIGIN_SESSION_RECOVERY');
      return true;
    }
    note('PASSIVE_FINGERPRINT_MISSING');
    return false;
  }
  function normalizeMobileViewport() {
    // Stock C20 may already contain <meta name=viewport content=width=980>.
    // Merely adding one when absent leaves iOS WebKit at 0.4x.
    const head=document.head;
    if(!head) { note('MOBILE_VIEWPORT_HEAD_MISSING'); return; }
    let meta=head.querySelector('meta[name="viewport" i]');
    if(!meta) {
      meta=document.createElement('meta');
      meta.name='viewport';
      head.appendChild(meta);
      note('MOBILE_VIEWPORT_ADDED');
    }
    const wanted='width=device-width, initial-scale=1, viewport-fit=cover';
    if(meta.content.trim().toLowerCase().replace(/\\s+/g,'') !==
       wanted.toLowerCase().replace(/\\s+/g,'')) {
      meta.content=wanted;
      note('MOBILE_VIEWPORT_NORMALIZED');
    }
    // Never disable user zoom / accessibility with maximum-scale or
    // user-scalable=no. De-focus vendor input before placing fixed nodes.
    if(document.activeElement?.matches?.('input[type="password"]')) {
      document.activeElement.blur();
      note('MOBILE_INITIAL_PASSWORD_FOCUS_CLEARED');
    }
  }
  (async()=>{
    note('DOCUMENT_BOOTSTRAP');
    // Passive fingerprint only: do not send our own HTTP POST to the
    // fragile stock GDPR parameters endpoint. An observed 500 never resets
    // a previously verified model, and is not evidence of login failure.
    let recognized=false;
    for(let i=0;i<25;i++) {
      if(passiveC20Evidence()){recognized=true;break;}
      await new Promise(resolve=>setTimeout(resolve,240));
    }
    if (!recognized) return;
    note('MODEL_OR_RECOVERY_MARKER_OK');
    observeStockResourceTiming();
    if(previouslyVerifiedOrigin) note('POSTLOGIN_RSA_REPROBE_SKIPPED');
    mounted=true;
    normalizeMobileViewport();
    installXHRLoginTelemetry();
    document.body.appendChild(host);
    document.body.appendChild(restore);
    if (!reported) {
      reported=true;
      bridge('tplinkProbe',{supported:true,model:'Archer C20',firmwareConfirmed:false});
    }
    if (resumedStockFlow) {
      // Stock navigation does not prove successful authentication. If the
      // login form remains visible, check() displays real login controls
      // rather than starting an unauthenticated protected WLAN read.
      note('STOCK_FLOW_RESTORED_AFTER_NAV');
    }
    await check();
    attachStockLoginEventTrace();
  })().catch(()=>{ note('BOOTSTRAP_EXCEPTION'); });
  // No RouterLab password form or synthetic .click() exists anymore.
  // Keep CSS positioning aligned after keyboard/viewport changes.
  const reflowNative = () => {
    if (!stockSkin || el('auth').style.display === 'none') return;
    const slots=[el('native-pass-slot'),el('native-submit-slot')];
    stockSkin.forEach((item,i) => {
      const rect=slots[i].getBoundingClientRect();
      // Change only geometry: never detach a focused stock password input
      // or rebuild its event listeners when the iOS keyboard opens.
      item.node.style.setProperty('top',rect.top+'px','important');
      item.node.style.setProperty('left',rect.left+'px','important');
      item.node.style.setProperty('width',rect.width+'px','important');
      item.node.style.setProperty('height',rect.height+'px','important');
    });
  };
  window.addEventListener('resize',reflowNative);
  window.visualViewport?.addEventListener('resize',reflowNative);
  window.visualViewport?.addEventListener('scroll',reflowNative);
  shadow.querySelector('.content').addEventListener('scroll',reflowNative,{passive:true});
  // Refresh must never remove the one-click login fence. A new page load
  // is required to initiate another credential submission.
  el('refresh').addEventListener('click',()=>check());
  el('check-existing').addEventListener('click',checkExistingSession);
  el('retry-login').addEventListener('click',retryLogin);
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
