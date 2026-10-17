/* RouterLab TP-Link Archer C20 adapter, v0.1. Safe, read-only contracts only. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.RouterLabC20=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const FIRMWARE='3.16.0 0.9.1 v6038.0 Build 200821';
  const MAX_LEN=150000;
  const targets=Object.freeze({'192.168.0.1':'http://192.168.0.1','192.168.0.254':'http://192.168.0.254'});
  function safeBase(host){
    if(!Object.prototype.hasOwnProperty.call(targets,host))throw Error('Недопустимый адрес роутера');
    return targets[host];
  }
  function textOf(value){return typeof value==='string'?value.slice(0,MAX_LEN):''}
  function scrubHtml(html){return textOf(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')}
  function matchHint(html,re){return re.test(textOf(html))}
  function assess(input){
    const main=textOf(input?.root?.body), param=textOf(input?.params?.body), alt=textOf(input?.other?.body);
    const raw=[main,param,alt].join('\n');
    const gotHtml=Boolean(main&&/<!doctype|<html|<form|<head|<script/i.test(main));
    const family=matchHint(raw,/(?:cgi_gdpr|gdprProxy|tpEncrypt|getGDPRParm|\bLAN_WLAN\b)/i);
    const key=matchHint(param+alt,/(?:\bnn\b|\bseq\b)/i)&&matchHint(param+alt,/\bee\b/i);
    const login=matchHint(main,/(?:password|passwd|login|log\s*in|парол|войти|admin)/i);
    const factory=matchHint(main,/(?:create\s+(?:an?\s+)?(?:admin\s+)?password|set\s+password|создать\s+парол|придумайте\s+парол)/i);
    const model=matchHint(raw,/(?:Archer[\s-]?C20|\bC20\b)/i);
    const firmware=matchHint(raw,/(?:200821|v6038\.0)/i);
    const reachable=Boolean([input?.root?.status,input?.params?.status,input?.other?.status].some(x=>x>=200&&x<500));
    let state='UNKNOWN';
    if(!reachable)state='UNREACHABLE';
    else if(factory)state='FACTORY_CANDIDATE';
    else if(login)state='LOGIN_REQUIRED';
    else if(gotHtml)state='ROUTER_PAGE';
    const confidence=family||key?'protocol':'unknown';
    return {state,confidence,family,key,model,firmware,reachable,firmwareExpected:FIRMWARE,
      // Never interpret LOGIN_REQUIRED as proof of a configured router.
      canWrite:false,canAutoLogin:false,canReadWifi:false,
      reason:state==='UNREACHABLE'?'Проверьте соединение с Wi-Fi/LAN Archer C20':
        family||key?'Найден TP-Link GDPR-протокол; авторизация и запись пока отключены':
        'Модель и протокол ещё не подтверждены; запись заблокирована'};
  }
  function paramSummary(s){
    const text=textOf(s);
    const read=name=>{
      const re=new RegExp('(?:^|[^a-z0-9])'+name+'[\\s"\\x27]*[:=][\\s"\\x27]*([a-zA-Z0-9]+)','i');
      return text.match(re)?.[1]||null;
    };
    const nn=read('nn'), ee=read('ee'),seq=read('seq');
    return {nnBits:nn&&/^[a-f0-9]+$/i.test(nn)?nn.length*4:null,exponent:ee||null,hasSequence:!!seq,
      // Never output nonce, modulus, AES keys, cookies or token.
      format: /^\s*\{/.test(text)?'json':/\bvar\b|=/.test(text)?'js-or-form':'other'};
  }
  function sanitizedResponse(status,body){
    const txt=textOf(body);
    return {status,bytes:txt.length,html:/(?:<html|<!doctype|<form)/i.test(txt),
      login:/(?:password|login|парол|войти)/i.test(scrubHtml(txt)),
      gdpr:/(?:getGDPRParm|gdprProxy|cgi_gdpr|tpEncrypt)/i.test(txt)};
  }
  return Object.freeze({FIRMWARE,targets,safeBase,assess,paramSummary,sanitizedResponse});
});
