/* RouterLab Archer C20 - vendor-origin READ-ONLY offscreen test (MAIN world).
   This script neither authenticates nor changes any router settings. */
'use strict';
(() => {
  if (window.top === window || location.origin !== 'http://192.168.0.1') return;
  if (window.name !== 'routerlab-c20-offscreen-probe') return;
  const REQUEST = 'ROUTERLAB_OFFSCREEN_READ_PROBE_61';
  const REPLY = 'ROUTERLAB_OFFSCREEN_READ_RESULT_61';
  let handled = false;
  const visible = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
  const reply = (requestId, output) => {
    window.postMessage({type: REPLY, requestId, output}, location.origin);
  };
  // The browser, not the extension, supplies Origin, Referer, User-Agent and
  // Content-Length. An XHR in this router-origin frame is materially different
  // from an extension-origin Service Worker fetch. The physical stock request
  // is a bodyless POST /cgi/getGDPRParm (not a /cgi_gdpr encrypted POST).
  function probeGdprParams() {
    return new Promise(resolve => {
      if (typeof XMLHttpRequest !== 'function')
        return resolve({gdprHttp:null,gdprValid:false,gdprStatus:'XHR_UNAVAILABLE'});
      let xhr, done = false;
      const finish = (gdprHttp,gdprValid,gdprStatus) => {
        if (done) return;
        done = true;
        resolve({gdprHttp,gdprValid,gdprStatus});
      };
      try {
        xhr = new XMLHttpRequest();
        xhr.open('POST', location.origin + '/cgi/getGDPRParm', true);
        xhr.timeout = 4500;
        xhr.setRequestHeader('Accept', '*/*');
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.setRequestHeader('Pragma', 'no-cache');
        xhr.onload = () => {
          const body = String(xhr.responseText || '');
          const field = key => {
            const re = new RegExp(String.raw`(?:^|[;\s,{])(?:var\s+)?${key}\s*[:=]\s*['"]?([0-9a-fA-F]+)`, 'im');
            return body.match(re)?.[1] || null;
          };
          const nn=field('nn'), ee=field('ee'), seq=field('seq');
          const valid = xhr.status === 200 && /^[a-f0-9]{128}$/i.test(nn || '') &&
            /^[a-f0-9]{1,8}$/i.test(ee || '') && !!seq;
          finish(xhr.status,valid, valid?'RSA_PARAMS_VALID':'HTTP_OR_BODY_UNCONFIRMED');
        };
        xhr.onerror = () => finish(0,false,'XHR_NETWORK_ERROR');
        xhr.ontimeout = () => finish(0,false,'XHR_TIMEOUT');
        xhr.onabort = () => finish(0,false,'XHR_ABORT');
        xhr.send(null); // Zero bytes, no manually set Content-Type.
      } catch (_e) { finish(0,false,'XHR_SETUP_ERROR'); }
    });
  }
  async function runProbe(requestId) {
    const gdpr = await probeGdprParams();
    const done = output => reply(requestId,{...output,...gdpr});
    const pageText = (document.body?.innerText || '').slice(0,6500);
    const model = /archer\s*c20/i.test((document.title || '') + ' ' + pageText);
    if (!model) return done( {status:'MODEL_NOT_CONFIRMED',readConfirmed:false});
    const pw = [...document.querySelectorAll('input[type=password]')].filter(visible);
    const login = [...document.querySelectorAll('button,input[type=submit],a[role=button]')]
      .filter(visible).some(x => /^(?:войти|вход|log\s*in|login|sign\s*in)$/i.test((x.innerText || x.value || '').trim()));
    if (pw.length >= 2 && /созда|create|get started|приступим/i.test(pageText))
      return done( {status:'FACTORY_PASSWORD',readConfirmed:false});
    if (pw.length === 1 && login)
      return done( {status:'LOGIN_FORM',readConfirmed:false});
    // TP-Link's own asynchronous scripts may not yet have installed $.act/$.exe.
    let stock = null;
    for (let i=0;i<24;i++) {
      stock = window.$;
      if (stock && typeof stock.act === 'function' && typeof stock.exe === 'function') break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if (!stock || typeof stock.act !== 'function' || typeof stock.exe !== 'function')
      return done( {status:'STOCK_API_NOT_READY',readConfirmed:false});
    if (stock.as?.length || stock.ds?.length)
      return done( {status:'VENDOR_QUEUE_BUSY',readConfirmed:false});
    try {
      const attrs = ['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled'];
      const rows = stock.act(typeof window.ACT_GL === 'number' ? window.ACT_GL : 1,
        'LAN_WLAN', '0,0,0,0,0,0', '0,0,0,0,0,0', attrs);
      if (!Array.isArray(rows)) return done( {status:'LIST_NOT_QUEUED',readConfirmed:false});
      const ack = stock.exe();
      if (typeof ack !== 'number' || ack !== 0)
        return done( {status:'VENDOR_LIST_REJECTED',readConfirmed:false,ackType:typeof ack,
          ackZero:ack===0});
      const valid = rows.filter(x=>typeof x?.SSID==='string' && x.SSID.length>0);
      const one = valid.filter(x=>/2[.,]?4\s*(?:g|ghz)?/i.test(String(x.X_TP_Band||'')));
      const five = valid.filter(x=>/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i.test(String(x.X_TP_Band||'')));
      const okStack = x => /^\d+(?:,\d+){5}$/.test(String(x?.__stack||''));
      const mapped = one.length===1 && five.length===1 && okStack(one[0]) && okStack(five[0]) &&
        one[0].__stack !== five[0].__stack;
      // Never send SSIDs, Wi-Fi keys, vendor stacks or sessions in diagnostic signals.
      return done( {status:mapped?'VENDOR_PROTECTED_READ_OK':'VENDOR_READ_INCOMPLETE',
        readConfirmed:mapped,recordCount:valid.length,has24:one.length===1,has5:five.length===1});
    } catch(e) {
      return done( {status:'VENDOR_READ_EXCEPTION',readConfirmed:false,
        exceptionType:String(e?.name||'Error').replace(/[^a-z]/gi,'').slice(0,25)});
    }
  }
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!==REQUEST || handled)return;
    if(!/^[a-z0-9_-]{10,80}$/i.test(String(event.data.requestId||'')))return;
    handled=true;
    runProbe(event.data.requestId);
  });
})();
