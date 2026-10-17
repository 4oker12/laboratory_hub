/* RouterLab: one read-only handshake into real router-origin hidden iframe. */
'use strict';
(() => {
  if (window.top === window || location.origin !== 'http://192.168.0.1') return;
  if (window.name !== 'routerlab-c20-offscreen-probe') return;
  const REQUEST='ROUTERLAB_OFFSCREEN_READ_PROBE_61';
  const REPLY='ROUTERLAB_OFFSCREEN_READ_RESULT_61';
  const id=Array.from(crypto.getRandomValues(new Uint8Array(12)),v=>v.toString(16).padStart(2,'0')).join('');
  const allowed=new Set(['MODEL_NOT_CONFIRMED','FACTORY_PASSWORD','LOGIN_FORM','STOCK_API_NOT_READY',
    'VENDOR_QUEUE_BUSY','LIST_NOT_QUEUED','VENDOR_LIST_REJECTED','VENDOR_PROTECTED_READ_OK',
    'VENDOR_READ_INCOMPLETE','VENDOR_READ_EXCEPTION','MAIN_WORLD_NO_REPLY']);
  let complete=false;
  const send=data=>{
    if(complete)return;
    complete=true;clearTimeout(timer);window.removeEventListener('message',handle);
    const title=document.title||'';
    const safe={type:'C20_OFFSCREEN_FRAME_SIGNAL',isC20:/archer\s*c20/i.test(title),
      status:allowed.has(data?.status)?data.status:'INVALID_VENDOR_REPLY',
      readConfirmed:data?.readConfirmed===true && data?.status==='VENDOR_PROTECTED_READ_OK',
      recordCount:Number.isInteger(data?.recordCount)?Math.max(0,Math.min(100,data.recordCount)):null,
      has24:data?.has24===true,has5:data?.has5===true,
      gdprHttp:Number.isInteger(data?.gdprHttp)?Math.max(0,Math.min(599,data.gdprHttp)):null,
      gdprValid:data?.gdprValid===true,
      gdprStatus:['RSA_PARAMS_VALID','HTTP_OR_BODY_UNCONFIRMED','XHR_UNAVAILABLE',
        'XHR_NETWORK_ERROR','XHR_TIMEOUT','XHR_ABORT','XHR_SETUP_ERROR'].includes(data?.gdprStatus)
        ?data.gdprStatus:'NOT_REPORTED'};
    chrome.runtime.sendMessage(safe).catch(()=>{});
  };
  const handle=event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!==REPLY || event.data?.requestId!==id)return;
    send(event.data.output);
  };
  window.addEventListener('message',handle);
  const timer=setTimeout(()=>send({status:'MAIN_WORLD_NO_REPLY',readConfirmed:false}),10500);
  window.postMessage({type:REQUEST,requestId:id},location.origin);
})();
