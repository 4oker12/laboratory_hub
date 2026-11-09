/* RouterLab Universal: passive model discovery and safe fallback panel.
 * C20 and Netis retain their own tested adapters. This UI never guesses vendor
 * login/SET commands and never copies credentials into the diagnostic bridge.
 */
(() => {
  'use strict';
  if (window.__RouterLabUniversalPanel || !window.RouterLabDeviceRegistry) return;
  const registry = window.RouterLabDeviceRegistry;
  const send = (type, rest = {}) => {
    try { window.webkit?.messageHandlers?.routerlab?.postMessage({type, ...rest}); }
    catch (_) {}
  };
  const supportedNative = new Set(['tplink-archer-c20', 'netis-n2']);
  let mounted = false, host = null, current = null, lastHint = '';
  let tick = null, observer = null;
  let scans = 0;
  const started = Date.now();
  const MAX_AGE = 11000;

  function pageEvidence() {
    const headings = Array.from(document.querySelectorAll('h1,h2,header,[class*="model"],[id*="model"]'))
      .filter(n => !n.closest('#routerlab-universal-panel'))
      .slice(0,12).map(n => String(n.textContent || '').slice(0,100)).join(' ');
    const meta = Array.from(document.querySelectorAll('meta[name],meta[property]'))
      .filter(n => /model|device|product|generator/i.test(n.name || n.getAttribute('property') || ''))
      .slice(0,8).map(n => String(n.content || '').slice(0,90)).join(' ');
    const body = String(document.body?.innerText || '').slice(0,1600);
    return {
      title: String(document.title || '').slice(0,200),
      headings:headings.slice(0,600), meta:meta.slice(0,500), body
    };
  }
  function stageCode() {
    const body = String(document.body?.innerText || '').slice(0,2200);
    const inputs = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter(n => n.getClientRects && n.getClientRects().length && !n.disabled);
    if (inputs.length >= 2 && /(?:create|set|new|созда|установ|новий|новый).{0,50}(?:pass|парол)/i.test(body))
      return 'FACTORY_PASSWORD_CANDIDATE';
    if (inputs.length && /(?:login|log in|sign in|вход|увійти|авторизац)/i.test(body))
      return 'LOGIN_FORM_CANDIDATE';
    if (/(?:quick setup|быстрая настройка|швидке налаштування)/i.test(body) &&
        document.querySelector('select,input[type="radio"],input[type="text"]'))
      return 'WIZARD_CANDIDATE';
    return 'STATE_NOT_CONFIRMED';
  }
  function stopScan() {
    if (tick) { clearInterval(tick); tick = null; }
    if (observer) { observer.disconnect(); observer = null; }
  }
  function diagnostic() {
    return Object.freeze({
      identity:current?.id || 'NONE',
      vendor:current?.vendor || '',
      model:current?.model || '',
      revision:current?.revision || '',
      build:current?.build || '',
      evidence:current?.evidence || 'NONE',
      stage:stageCode(),
      vendorFramework: typeof window.$?.su === 'object' ? 'TP_SU' :
        typeof window.$?.act === 'function' ? 'TP_LEGACY' : 'UNKNOWN',
      modelCandidateOnly:true,
      loginVerified:false, writesEnabled:false
    });
  }
  function button(root,id,callback) {
    const btn=root.getElementById(id);
    if(btn)btn.addEventListener('click',callback);
  }
  async function copyDiagnostics(output) {
    const data=JSON.stringify(diagnostic(),null,2);
    try {
      if(!navigator.clipboard?.writeText)throw Error('NOT_AVAILABLE');
      await navigator.clipboard.writeText(data);
      output.textContent='Отчёт скопирован. Пароли и данные сессии в него не включены.';
    } catch (_) {
      const pre=output.ownerDocument.createElement('textarea');
      pre.value=data;pre.readOnly=true;pre.style.cssText='width:100%;min-height:110px';
      output.replaceChildren(pre);pre.focus();pre.select();
      output.appendChild(output.ownerDocument.createTextNode(' Скопируйте текст вручную.'));
    }
  }
  function render(result) {
    if (!document.body || mounted) return;
    const n=document.createElement('div');
    n.id='routerlab-universal-panel';
    n.style.cssText='position:fixed;inset:0;width:100vw;height:100dvh;min-height:100vh;z-index:2147483646;background:#f2f5f9;color:#17293b;font-family:-apple-system,system-ui,Arial,sans-serif';
    const root=n.attachShadow({mode:'open'});
    const region=String(result.revision || 'не определена');
    const state=stageCode();
    root.innerHTML = '<style>' +
      ':host{color-scheme:light}*{box-sizing:border-box}.view{height:100dvh;overflow-y:auto;background:#f2f5f9}' +
      '.head{background:#19374f;color:white;padding:19px 18px;font-weight:750;font-size:17px}' +
      '.wrap{max-width:620px;margin:0 auto;padding:20px 16px 46px}.card{background:#fff;border:1px solid #dae3eb;border-radius:13px;padding:16px;margin-bottom:13px}' +
      '.label{font-size:12px;color:#68798b}.name{font-size:23px;font-weight:750;margin:7px 0}.muted{font-size:13px;line-height:1.5;color:#566b80}' +
      '.step{border-top:1px solid #e6ebef;padding:12px 0;display:flex;justify-content:space-between;gap:10px;font-size:13px}' +
      '.blocked{color:#956112;white-space:nowrap;font-size:12px}.controls{display:flex;gap:9px;flex-wrap:wrap}' +
      'button{background:#1d658f;color:#fff;padding:11px 13px;border:0;border-radius:9px;font-weight:600;font-size:13px}' +
      'button:disabled{opacity:.5}.secondary{background:#e5eff6;color:#184461}' +
      '</style>' +
      '<div class="view"><div class="head">RouterLab · универсальное подключение</div><div class="wrap">' +
      '<div class="card"><div class="label">Распознана модель по веб-интерфейсу</div>' +
      '<div class="name" id="device"></div><div class="muted" id="meta"></div></div>' +
      '<div class="card"><strong>Состояние подключения</strong>' +
      '<p class="muted">Модель определена предварительно. Это не подтверждает авторизацию, ревизию прошивки и возможность записи.</p>' +
      '<div class="step"><span>Обнаруженный экран</span><strong id="stage"></strong></div>' +
      '<div class="step"><span>Вход / создание пароля</span><span class="blocked">API не проверен</span></div>' +
      '<div class="step"><span>Быстрая настройка WAN DHCP</span><span class="blocked">API не проверен</span></div>' +
      '<div class="step"><span>Имя и пароль Wi-Fi</span><span class="blocked">API не проверен</span></div>' +
      '<div class="step"><span>Сохранение и проверка</span><span class="blocked">Запись заблокирована</span></div></div>' +
      '<div class="card"><strong>Диагностика RouterLab</strong>' +
      '<p class="muted">Технические признаки без SSID, паролей, MAC, cookies и токенов. ' +
      'Этот отчёт нужен для создания адаптера именно под данную прошивку.</p>' +
      '<div class="controls"><button id="refresh" class="secondary">Проверить экран</button>' +
      '<button id="copy">Скопировать диагностику</button>' +
      '<button id="stock" class="secondary">Штатный интерфейс</button></div>' +
      '<p class="muted" id="result" role="status"></p></div>' +
      '</div></div>';
    document.body.appendChild(n);
    host=n;mounted=true;current=result;
    root.getElementById('device').textContent=result.vendor+' '+result.model;
    root.getElementById('meta').textContent='Ревизия: '+region+' · источник: '+result.evidence;
    root.getElementById('stage').textContent=state;
    const output=root.getElementById('result');
    button(root,'refresh',()=>{root.getElementById('stage').textContent=stageCode();output.textContent='Состояние экрана обновлено.';});
    button(root,'copy',()=>copyDiagnostics(output));
    button(root,'stock',()=>{
      // Explicit manual fallback only; no automatic credential submission.
      n.style.display='none';
      const restore=document.createElement('button');
      restore.id='routerlab-universal-restore';
      restore.textContent='RouterLab';
      restore.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:12px 16px;background:#19374f;color:white;border:0;border-radius:12px';
      restore.addEventListener('click',()=>{restore.remove();n.style.display='block';send('genericPanelReady',{id:result.id});});
      document.body.appendChild(restore);
      send('genericStockShown',{id:result.id});
    });
    send('routerFingerprint',{id:result.id, vendor:result.vendor,model:result.model,
      revision:result.revision,build:result.build,evidence:result.evidence,panelMounted:true});
    send('genericPanelReady',{id:result.id});
    stopScan();
  }
  function scan() {
    scans++;
    let result;
    try { result=registry.fingerprint(pageEvidence()); } catch (_) { return; }
    if (result.status === 'MODEL_CANDIDATE') {
      if(supportedNative.has(result.id)) {stopScan();return;}
      render(result);
      return;
    }
    if(result.vendor && result.vendor !== lastHint) {
      lastHint=result.vendor;
      send('routerFingerprintHint',{vendor:result.vendor,status:result.status});
    }
    if(Date.now()-started>MAX_AGE) stopScan();
  }
  const boot = () => {
    if(!document.body)return;
    scan();
    if(!mounted) {
      tick=setInterval(scan,400);
      observer=new MutationObserver(()=>{if(!mounted && scans<65)scan();});
      observer.observe(document.body,{childList:true,subtree:true});
    }
  };
  window.__RouterLabUniversalPanel=Object.freeze({
    refresh:scan,diagnostic:()=>mounted?diagnostic():null,
    get ready(){return mounted}
  });
  if(document.body)boot(); else document.addEventListener('DOMContentLoaded',boot,{once:true});
})();
