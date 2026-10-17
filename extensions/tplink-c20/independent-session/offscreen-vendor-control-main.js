/* Executed in the real http://192.168.0.1 iframe; no extension privilege in MAIN world.
   Operations use only the already-captured stock UI / $.act / $.exe. */
'use strict';
(()=>{
 if(window.top===window||location.origin!=='http://192.168.0.1'||window.name!=='routerlab-c20-offscreen-probe')return;
 const ORIGIN=location.origin;
 const allowed=new Set(['inspect','login','loginSchema','wifiSet','reboot','http','factoryCreate','quickStage','quickStep','wanRead','pageState']);
 let working=false;
 const visible=el=>!!el&&!el.disabled&&el.getClientRects().length>0;
 const text=()=>((document.title||'')+' '+(document.body?.innerText||'').slice(0,5000));
 const model=()=>/Archer\s*C20/i.test(text());
 const stage=()=>{
   if(!model())return 'MODEL_NOT_CONFIRMED';
   // Only a visible stock lockout message can identify lockout. Not a CGI guess.
   if(/(?:превысили\s+(?:пять|5)\s+попыток|слишком\s+много\s+попыток|too\s+many\s+(?:login\s+)?attempts|exceeded\s+(?:the\s+)?(?:maximum|five|5)\s+login\s+attempts)/i.test(text()))return 'LOGIN_LOCKED';
   const passwords=[...document.querySelectorAll('input[type="password"]')].filter(visible);
   const buttons=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')].filter(visible);
   const login=buttons.some(el=>/^(?:вход|войти|log\s*in|login|sign\s*in)$/i.test((el.innerText||el.value||'').trim()));
   if(passwords.length>=2&&/созда|create|get started|приступим/i.test(text()))return 'FACTORY_PASSWORD';
   // A menu item called Quick Setup does not count; require visible wizard UI.
   const shown=sel=>[...document.querySelectorAll(sel)].some(visible);
   const wizard=/быстрая\s+настройка|quick\s+setup/i.test(text()) &&
     (shown('#quicksetup_isp_container,#quicksetup_dsl_container,#quicksetup-process-content')||
      shown('#wl24gSSID,#wl5gSSID,#next_button,#save'));
   if(wizard)return 'QUICK_SETUP_ACTIVE';
   if(passwords.length===1&&login)return 'LOGIN_FORM';
   return 'POSSIBLY_AUTHENTICATED';
 };
 // Read-only introspection of login calls in existing inline vendor scripts.
 // Report only field-name evidence, never source code, values or credentials.
 // Unknown means unknown; do not infer a working login protocol from a hint.
 const loginSchema=()=>{
   let mentions=0,lower=false,legacy=false,scanned=0;
   for(const script of [...document.querySelectorAll('script')].slice(0,100)){
     if(script.src)continue;
     const code=String(script.textContent||'').slice(0,250000);
     scanned++;
     const rx=/["']\/?cgi\/login["']/ig;
     for(const m of code.matchAll(rx)){
       mentions++;
       const around=code.slice(Math.max(0,m.index-2400),Math.min(code.length,m.index+1800));
       if(/\.username\s*=|\busername\s*:/.test(around)&&/\.password\s*=|\bpassword\s*:/.test(around))lower=true;
       if(/\.UserName\s*=|\bUserName\s*:/.test(around)&&/\.Passwd\s*=|\bPasswd\s*:/.test(around))legacy=true;
     }
   }
   return{status:mentions?'INLINE_CALL_FOUND':'NO_INLINE_LOGIN_CALL',inlineScripts:Math.min(scanned,100),
     callSites:Math.min(mentions,100),lowercaseFields:lower,legacyFields:legacy,
     evidence:'HEURISTIC_NOT_WIRE_PROOF'};
 };
 const validStack=s=>/^\d+(?:,\d+){5}$/.test(String(s||''));
 const mapRows=rows=>{
   const a=rows.filter(x=>/2[.,]?4\s*(?:g|ghz)?/i.test(String(x?.X_TP_Band||'')));
   const b=rows.filter(x=>/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i.test(String(x?.X_TP_Band||'')));
   if(a.length!==1||b.length!==1||!a[0]?.SSID||!b[0]?.SSID||!validStack(a[0].__stack)||
     !validStack(b[0].__stack)||a[0].__stack===b[0].__stack)return null;
   return {ssid24:a[0].SSID,ssid5:b[0].SSID,stack24:a[0].__stack,stack5:b[0].__stack};
 };
 const read=()=>{
   const $=window.$;
   if(typeof $?.act!=='function'||typeof $?.exe!=='function')return {status:'STOCK_API_NOT_READY'};
   if($.as?.length||$.ds?.length)return {status:'VENDOR_QUEUE_BUSY'};
   try{
     const rows=$.act(typeof window.ACT_GL==='number'?window.ACT_GL:5,'LAN_WLAN',
       '0,0,0,0,0,0','0,0,0,0,0,0',['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']);
     if(!Array.isArray(rows))return {status:'LIST_NOT_QUEUED'};
     const code=$.exe();if(code!==0)return {status:'VENDOR_READ_REJECTED',ack:typeof code==='number'?code:null};
     const radio=mapRows(rows);
     return radio?{status:'VENDOR_PROTECTED_READ_OK',radio}:{status:'VENDOR_READ_INCOMPLETE',count:rows.length};
   }catch(e){return {status:'VENDOR_READ_EXCEPTION',errorType:String(e?.name||'Error').slice(0,32)};}
 };

 // Read-only WAN evidence. Stock ACT_GL=5 list call, not ACT_GET=1.
 // Do not treat this as proof of Internet reachability or on-air Wi-Fi.
 const wanRead=()=>{
   if(stage()!=='POSSIBLY_AUTHENTICATED')return {status:'WAN_AUTH_SCREEN_NOT_READY',dhcpVerified:false};
   const $=window.$;
   if(typeof $?.act!=='function'||typeof $.exe!=='function')return{status:'WAN_API_NOT_READY',dhcpVerified:false};
   if($.as?.length||$.ds?.length)return{status:'WAN_QUEUE_BUSY',dhcpVerified:false};
   try{
     const rows=$.act(typeof window.ACT_GL==='number'?window.ACT_GL:5,'WAN_IP_CONN',
       '0,0,0,0,0,0','0,0,0,0,0,0',['enable','name','addressingType','X_TP_IPv4Enabled']);
     if(!Array.isArray(rows))return{status:'WAN_ROWS_UNAVAILABLE',dhcpVerified:false};
     const code=$.exe();if(code!==0)return{status:'WAN_VENDOR_ERROR',dhcpVerified:false};
     const enabled=rows.filter(x=>String(x?.enable)==='1'&&String(x?.X_TP_IPv4Enabled)==='1');
     const dhcp=enabled.filter(x=>x.addressingType==='DHCP');
     return {status:'WAN_PROTECTED_READ_OK',dhcpVerified:enabled.length===1&&dhcp.length===1,
       enabledCount:enabled.length,dhcpCount:dhcp.length};
   }catch{return{status:'WAN_READ_EXCEPTION',dhcpVerified:false};}
 };
 const loginContext=async()=>{
   let storageAccess='UNAVAILABLE',cookieAccess='UNAVAILABLE';
   if(typeof document.hasStorageAccess==='function'){
     try{storageAccess=await document.hasStorageAccess()?'GRANTED':'DENIED';}
     catch{storageAccess='ERROR';}
   }
   try{cookieAccess=document.cookie?'COOKIE_VISIBLE':'NO_COOKIE_VISIBLE'}
   catch{cookieAccess='BLOCKED';}
   // Only boolean flags; no router text, field contents or cookie values.
   const str=text();
   const uiError=/(?:incorrect\s+password|wrong\s+password|invalid\s+password|неверн\w*\s+парол|неправильн\w*\s+парол|парол\w*\s+неверн|слишком\s+много\s+попыток|too\s+many\s+attempts)/i.test(str)?'AUTH_ERROR_VISIBLE':'NO_RECOGNIZED_ERROR';
   return {storageAccess,cookieAccess,uiError};
 };
 // Read-only DOM check. Does NOT call $.act, $.exe or send an HTTP request.
 const pageState=async()=>({stage:stage(),diagnostic:await loginContext(),
   stockIoReady:typeof window.$?.exe==='function',
   tokenPresent:!!(window.TokenID||window.token||window.tokenID)});
 const inspect=async()=>{
   let current=stage();
   if(current==='LOGIN_FORM')return{stage:current,diagnostic:await loginContext()};
   if(current==='LOGIN_LOCKED')return{stage:current,diagnostic:{uiError:'STOCK_LOGIN_LOCKOUT_VISIBLE'}};
   if(['FACTORY_PASSWORD','MODEL_NOT_CONFIRMED','QUICK_SETUP_ACTIVE'].includes(current))return{stage:current};
   for(let i=0;i<15;i++){
     if(window.$&&typeof window.$.act==='function'&&typeof window.$.exe==='function')break;
     await new Promise(r=>setTimeout(r,120));
   }
   const r=read();
   return r.status==='VENDOR_PROTECTED_READ_OK'?{stage:'CONFIGURED_AUTHENTICATED',readConfirmed:true,
     radio:r.radio}:{stage:'AUTH_UNCONFIRMED',reason:r.status,readConfirmed:false};
 };
 // Same-origin transport for RouterLab's existing RSA/AES GDPR protocol.
 // Physical v0.6.2 proved POST /cgi/getGDPRParm works here (200), while
 // extension-origin fetch produced 500. Do not click vendor login or reload.
 // Messages are restricted to the extension-owned parent + a closed route list.
 const http=async args=>{
   const path=args?.path,method=args?.method;
   if(!['/','/cgi/getGDPRParm','/cgi/getParm','/cgi/getBusy','/cgi_gdpr'].includes(path)||
      !['GET','POST'].includes(method)||
      (path==='/'&&method!=='GET')||
      (path==='/cgi/getBusy'&&method!=='POST')||
      (path==='/cgi_gdpr'&&method!=='POST'))
     return {http:0,error:'ROUTE_REJECTED'};
   const body=args?.body??null;
   if(body!==null&&(typeof body!=='string'||body.length>120000))
     return {http:0,error:'BODY_REJECTED'};
   const headers=args?.headers||{};
   if(Object.keys(headers).some(k=>!['content-type','tokenid'].includes(k.toLowerCase()))||
     (headers['Content-Type']&&headers['Content-Type']!=='text/plain'))
     return {http:0,error:'HEADERS_REJECTED'};
   return await new Promise(resolve=>{
     let xhr,finished=false;const started=Date.now();
     const done=r=>{if(finished)return;finished=true;resolve(r)};
     const failure=error=>done({http:0,error,readyState:xhr?.readyState??null,
       elapsedMs:Date.now()-started});
     try{
       xhr=new XMLHttpRequest();xhr.open(method,location.origin+path,true);
       xhr.timeout=11500;xhr.withCredentials=true;
       if(path==='/cgi/getGDPRParm'||path==='/cgi/getParm'){
         xhr.setRequestHeader('Cache-Control','no-cache');
         xhr.setRequestHeader('Pragma','no-cache');
       }
       for(const [k,v] of Object.entries(headers))xhr.setRequestHeader(k,String(v).slice(0,256));
       xhr.onload=()=>xhr.status===0?failure('HTTP_ZERO'):
         done({http:xhr.status,url:path,text:String(xhr.responseText||'').slice(0,280000)});
       xhr.onerror=()=>failure('NETWORK_ERROR');
       xhr.onabort=()=>failure('ABORTED');
       xhr.ontimeout=()=>failure('TIMEOUT');
       xhr.send(body); // no hand-written Origin/Referer; browser sets real router origin
     }catch(e){failure('XHR_'+String(e?.name||'ERROR').replace(/[^a-z0-9_-]/ig,'').slice(0,30))}
   });
 };
 const login=async args=>{
   if(stage()!=='LOGIN_FORM')return {status:'LOGIN_NOT_AVAILABLE',submitted:false};
   const pw=args?.password;
   if(typeof pw!=='string'||!pw||pw.length>80)return {status:'PASSWORD_INVALID',submitted:false};
   const fields=[...document.querySelectorAll('input[type="password"]')].filter(visible);
   const actions=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')]
      .filter(visible).filter(x=>/^(?:вход|войти|log\s*in|login|sign\s*in)$/i.test((x.innerText||x.value||'').trim()));
   if(fields.length!==1||actions.length!==1||fields[0].value)return {status:'LOGIN_PRECHECK_FAILED',submitted:false};
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
   if(!setter)return {status:'INPUT_SETTER_MISSING',submitted:false};
   setter.call(fields[0],pw);
   for(const type of ['input','change','blur'])fields[0].dispatchEvent(new Event(type,{bubbles:true}));
   // The outer caller receives the submission receipt before the stock UI navigates.
   return {status:'LOGIN_READY_TO_CLICK',submitted:true,button:actions[0]};
 };
 const wifiSet=async args=>{
   if(stage()!=='POSSIBLY_AUTHENTICATED')return{submitted:false,reason:'NOT_AUTHENTICATED'};
   const validName=s=>typeof s==='string'&&s.length>0&&new TextEncoder().encode(s).length<=32&&!/[\r\n\0]/.test(s);
   if(!validName(args.ssid24)||!validName(args.ssid5))return{submitted:false,reason:'SSID_INVALID'};
   if(args.password!==undefined &&(typeof args.password!=='string'||args.password.length<8||args.password.length>63||!/^[\x20-\x7e]+$/.test(args.password)))return{submitted:false,reason:'PASSWORD_INVALID'};
   const original=read();if(original.status!=='VENDOR_PROTECTED_READ_OK')return{submitted:false,reason:original.status};
   const m=original.radio;
   if(m.ssid24!==args.old24||m.ssid5!==args.old5||m.stack24!==args.stack24||m.stack5!==args.stack5)return{submitted:false,reason:'FRESH_MAPPING_MISMATCH'};
   if(!args.password&&m.ssid24===args.ssid24&&m.ssid5===args.ssid5)return{submitted:false,reason:'NO_CHANGES'};
   const $=window.$;
   const a={},b={};if(args.ssid24!==m.ssid24)a.SSID=args.ssid24;if(args.ssid5!==m.ssid5)b.SSID=args.ssid5;
   if(args.password){a.X_TP_PreSharedKey=args.password;b.X_TP_PreSharedKey=args.password;}
   try{
     const type=typeof window.ACT_SET==='number'?window.ACT_SET:2;
     if(Object.keys(a).length)$.act(type,'LAN_WLAN',m.stack24,null,a);
     if(Object.keys(b).length)$.act(type,'LAN_WLAN',m.stack5,null,b);
   }catch(e){return{submitted:false,reason:'QUEUE_FAILED'};}
   return await new Promise(resolve=>{
     let complete=false;
     const finish=result=>{if(complete)return;complete=true;clearTimeout(timer);resolve(result);};
     const timer=setTimeout(()=>finish({submitted:true,ack:'UNKNOWN_TIMEOUT'}),11000);
     try{$.exe(code=>finish({submitted:true,ack:code===0?'ACK_ZERO':typeof code==='number'?'ERROR':'ACK_UNKNOWN'}));}
     catch{finish({submitted:true,ack:'EXCEPTION_AFTER_SEND'});}
   });
 };
 const reboot=()=>{
   if(stage()!=='POSSIBLY_AUTHENTICATED')return {requested:false,reason:'NOT_AUTHENTICATED'};
   const button=document.getElementById('topReboot');
   if(!visible(button))return {requested:false,reason:'NO_STOCK_REBOOT_CONTROL'};
   return {requested:true,button};
 };

function offscreenStockQuickStep(wifi){
 if(location.origin!=='http://192.168.0.1'||!/Archer\s*C20/i.test(document.title||''))
   return{step:'IDENTITY',reason:'UNEXPECTED_ROUTER',submitted:false};
 const vis=e=>!!e&&e.getClientRects().length>0;
 const input=id=>{const e=document.getElementById(id);return vis(e)?e:null};
 // Previous version looked for mixed-case IDs. Captured Archer C20 firmware
 // actually exposes lower-case wl24gssid/wl5gssid in some wizard variants.
 const caseId=id=>input(id)||(typeof document.querySelectorAll==='function'
   ?[...document.querySelectorAll('[id]')].find(e=>e.id?.toLowerCase()===id.toLowerCase()&&vis(e))
   :null)||null;
 const clickOne=(step,ids)=>{
   const buttons=ids.map(id=>caseId(id)).filter(Boolean);
   if(buttons.length!==1||buttons[0].disabled)return{step,reason:'STOCK_BUTTON_UNAVAILABLE',submitted:false};
   return{step,submitted:true,button:buttons[0]};
 };
 const w24=caseId('wl24gssid'),w5=caseId('wl5gssid');
 if(w24&&w5){
   const p24=caseId('wl24gpwd'),p5=caseId('wl5gpwd');
   if(wifi.ssid24&&wifi.ssid5){
     const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
     if(!setter)return{step:'WIRELESS',reason:'INPUT_SETTER_MISSING',submitted:false};
     for(const [el,val] of [[w24,wifi.ssid24],[w5,wifi.ssid5]]){
       setter.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
     }
     if(w24.value!==wifi.ssid24||w5.value!==wifi.ssid5)
       return{step:'WIRELESS',reason:'SSID_NOT_STABLE',submitted:false};
   }
   if(wifi.password){
     if(!p24||!p5)return{step:'WIRELESS',reason:'PASSWORD_FIELDS_NOT_FOUND',submitted:false};
     const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
     if(!setter)return{step:'WIRELESS',reason:'PASSWORD_SETTER_MISSING',submitted:false};
     for(const e of [p24,p5]){
       setter.call(e,wifi.password);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
     }
   }
   // Stock wizard owns the validation and vendor transaction for Next.
   return clickOne('WIRELESS',['next']);
 }
 const ispContainer=caseId('quicksetup_isp_container');
 const wanSelect=ispContainer?document.getElementById('select_wan_type'):null;
 if(wanSelect){
   // Reuse the *physical* Archer C20 capture rather than inventing a manual
   // "unknown ISP" route. Verified stock UI sequence from its click/HAR trace:
   // country Украина -> region все -> provider Воля -> dynamic IP -> Next.
   // TP-Link tpSelect owns this widget and populates dependent dropdowns; a
   // raw .value assignment does NOT run the vendor changeCountry/City/Isp path.
   const $=window.$;
   if(typeof $!=='function')return{step:'ISP_WAN',reason:'VENDOR_TPSELECT_UNAVAILABLE',submitted:false};
   const same=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
   const pick=(id,desired,reason)=>{
     const select=document.getElementById(id);
     if(!select)return reason+'_SELECT_MISSING';
     const opts=Array.from(select.options||[]);
     const matches=opts.filter(o=>same(o.value,desired)||same(o.text,desired));
     if(matches.length!==1)return reason+'_OPTION_NOT_UNIQUE';
     const wanted=String(matches[0].value);
     // On this firmware the custom list's data-val is the actual option value.
     // An ordinary select.click() does not update jquery.data('value').
     const $select=$(select);
     let vendor;
     try{vendor=$select.data('value')}catch{return reason+'_VENDOR_VALUE_UNAVAILABLE'}
     if(same(vendor,wanted))return null; // already selected by native tpSelect
     const outer=document.getElementById('_'+id);
     const box=outer?.querySelector('.tp-select .select-box');
     if(!box)return reason+'_STOCK_DROPDOWN_MISSING';
     box.click(); // opens TP-Link's exact stock dropdown, as in captured trace
     const options=Array.from(outer.querySelectorAll('li.option-item[data-val]'));
     const candidates=options.filter(el=>same(el.getAttribute('data-val'),wanted));
     if(candidates.length!==1)return reason+'_STOCK_OPTION_NOT_UNIQUE';
     candidates[0].click(); // vendor handler updates data('value') and children
     try{vendor=$select.data('value')}catch{return reason+'_VENDOR_VALUE_UNAVAILABLE'}
     if(!same(vendor,wanted))return reason+'_STOCK_SELECTION_NOT_ACKNOWLEDGED';
     return null;
   };
   for(const [id,wanted,reason] of [
     ['select_country','Украина','COUNTRY'],
     ['select_city','все','CITY'],
     ['select_isp','Воля','ISP']
   ]){
     const error=pick(id,wanted,reason);
     if(error)return{step:'ISP_WAN',reason:error,submitted:false};
   }
   const dhcp=Array.from(wanSelect.options||[]).filter(o=>
     /^(?:dhcp)$/i.test(String(o.value))||
     /динамическ.*ip|dynamic.*ip/i.test(String(o.text)+' '+String(o.value)));
   if(dhcp.length!==1)return{step:'ISP_WAN',reason:'DHCP_OPTION_NOT_UNIQUE',submitted:false};
   const error=pick('select_wan_type',dhcp[0].value,'WAN_DHCP');
   if(error)return{step:'ISP_WAN',reason:error,submitted:false};
   // Never submit merely because the HTML values appear correct: the *vendor*
   // jQuery value for every prerequisite must match the known stock sequence.
   for(const [id,wanted] of [
     ['select_country','Украина'],['select_city','все'],
     ['select_isp','Воля'],['select_wan_type',dhcp[0].value]
   ]){
     try{if(!same($(document.getElementById(id)).data('value'),wanted))
       return{step:'ISP_WAN',reason:'VENDOR_SELECTION_DESYNC_'+id,submitted:false};}
     catch{return{step:'ISP_WAN',reason:'VENDOR_SELECTION_UNREADABLE_'+id,submitted:false}}
   }
   return clickOne('ISP_WAN',['next_button']);
 }
 // Physical C20 capture: VLAN's #prio is a hidden native <select> with
 // a 0x0 bounding rect. The actual visible page is #quicksetup_dsl_container.
 // Do NOT use caseId('prio') as a visibility check: it incorrectly concludes
 // that the real VLAN page is an unknown wizard stage.
 if(caseId('quicksetup_dsl_container') || caseId('prio')){
   // Preserve the router's default VLAN configuration; never guess a VLAN ID.
   return clickOne('VLAN_DEFAULTS',['next']);
 }
 const pane=caseId('quicksetup-process-content');
 const summaryText=(pane?.innerText||document.body?.innerText||'').slice(0,15000);
 const save=caseId('save');
 if(save&&/(?:обзор|summary|тип интернет.подключения)/i.test(summaryText)){
   // Native click goes through the proven stock goSave handler. The C20 HAR
   // captures <button id="save" onclick="goSave()">. Require that contract.
   if(!/\bgoSave\s*\(/.test(save.getAttribute?.('onclick')||''))
     return{step:'SUMMARY',reason:'STOCK_SAVE_HANDLER_UNCONFIRMED',submitted:false};
   const wanMode=caseId('conntype');
   const mode=(wanMode?.value||wanMode?.textContent||'').trim();
   if(!/динамическ.*ip|dynamic.*ip|dhcp/i.test(mode))
     return{step:'SUMMARY',reason:'SUMMARY_WAN_DHCP_NOT_CONFIRMED',submitted:false};
   return clickOne('SUMMARY',['save']);
 }
 if(/(?:обзор|summary|завершен|finish)/i.test(summaryText))
   return{step:'SUMMARY',reason:'STOCK_FINAL_SAVE_NOT_RECOGNIZED',submitted:false};
 return{step:'UNKNOWN',reason:'STOCK_WIZARD_STEP_NOT_RECOGNIZED',submitted:false};
}

 // First-use stock password creation: exactly two empty password fields and the
 // genuine stock Get Started control. A click receipt is sent BEFORE navigation.
 const firstAdminPrepare=args=>{
   if(stage()!=='FACTORY_PASSWORD')return{status:'FACTORY_SCREEN_NOT_CONFIRMED',submitted:false};
   const password=args?.password;
   if(typeof password!=='string'||password.length<8||password.length>63||/[\r\n\0]/.test(password))
     return{status:'ADMIN_PASSWORD_INVALID',submitted:false};
   const fields=[...document.querySelectorAll('input[type="password"]')].filter(visible);
   if(fields.length!==2||fields.some(e=>e.value))return{status:'ADMIN_FIELDS_NOT_EMPTY_EXACT',submitted:false};
   const buttons=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')]
      .filter(visible).filter(e=>/приступим\s+к\s+работе|let.?s\s+get\s+started|get\s+started/i.test((e.innerText||e.value||'').trim()));
   if(buttons.length!==1||buttons[0].disabled)return{status:'ADMIN_BUTTON_NOT_UNIQUE',submitted:false};
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
   if(!setter)return{status:'ADMIN_INPUT_SETTER_MISSING',submitted:false};
   for(const e of fields){
     setter.call(e,password);
     for(const event of ['input','change','blur'])e.dispatchEvent(new Event(event,{bubbles:true}));
   }
   if(fields.some(e=>e.value!==password))return{status:'ADMIN_INPUT_NOT_STABLE',submitted:false};
   return{status:'ADMIN_READY_TO_CLICK',submitted:true,button:buttons[0]};
 };
 const offscreenQuickStage=()=>{
   if(!model())return{stage:'MODEL_NOT_CONFIRMED',signature:'NONE'};
   const shown=id=>{const direct=document.getElementById(id);
     if(visible(direct))return direct;
     return [...document.querySelectorAll('[id]')].find(x=>x.id?.toLowerCase()===id.toLowerCase()&&visible(x))||null;};
   const pane=shown('quicksetup-process-content');
   const content=(pane?.innerText||'').replace(/\s+/g,' ').trim();
   let current='UNKNOWN';
   if(shown('save')&&/(?:обзор|summary|тип интернет.подключения)/i.test(content))current='SUMMARY';
   else if(shown('wl24gssid')&&shown('wl5gssid'))current='WIRELESS';
   else if(shown('quicksetup_dsl_container'))current='VLAN_DEFAULTS';
   else if(shown('quicksetup_isp_container')&&document.getElementById('select_wan_type'))current='ISP_WAN';
   else if(stage()==='LOGIN_LOCKED')current='LOGIN_LOCKED';
   else if(stage()==='LOGIN_FORM')current='LOGIN_FORM';
   else if(stage()==='FACTORY_PASSWORD')current='FACTORY_PASSWORD';
   // Do not issue a hidden WLAN read from a stage-probe.
   else if(stage()==='POSSIBLY_AUTHENTICATED')current='POSSIBLY_AUTHENTICATED';
   return {stage:current,signature:current,markers:{
     isp:!!shown('quicksetup_isp_container'),vlan:!!shown('quicksetup_dsl_container'),
     wlan:!!(shown('wl24gssid')&&shown('wl5gssid')),summary:!!shown('save'),
     next:!!shown('next'),nextButton:!!shown('next_button')}};
 };

 window.addEventListener('message',async e=>{
   if(e.source!==window.parent||!/^chrome-extension:\/\/[a-z]{32}$/.test(e.origin)||
     e.data?.type!=='C20_OFFSCREEN_OPERATION'||!allowed.has(e.data.command)||working||
     !/^[0-9a-f-]{36}$/.test(String(e.data.requestId||'')))return;
   working=true;
   const answer=result=>window.parent.postMessage({type:'C20_OFFSCREEN_OPERATION_RESULT',requestId:e.data.requestId,result},e.origin);
   try{
     let result;
     if(e.data.command==='inspect')result=await inspect();
     else if(e.data.command==='pageState')result=await pageState();
     else if(e.data.command==='loginSchema')result=loginSchema();
     else if(e.data.command==='quickStage')result=offscreenQuickStage();
     else if(e.data.command==='wanRead')result=wanRead();
     else if(e.data.command==='factoryCreate'){
       result=firstAdminPrepare(e.data.args||{});
       if(result.button){const button=result.button;delete result.button;answer(result);
         // Send once, only after receipt, and never repeat after a lost reply.
         setTimeout(()=>{try{button.click()}catch{}},80);return;}
     } else if(e.data.command==='quickStep'){
       const before=offscreenQuickStage();
       if(!['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(before.stage))
         result={step:before.stage,submitted:false,reason:'WIZARD_STAGE_NOT_VERIFIED'};
       else {
         result=offscreenStockQuickStep(e.data.args||{});
         if(result?.submitted&&result.step!==before.stage)
           result={step:before.stage,submitted:false,reason:'QUICK_STAGE_DESYNC'};
         if(result.button){const button=result.button;delete result.button;answer(result);
           setTimeout(()=>{try{button.click()}catch{}},80);return;}
       }
     }
     else if(e.data.command==='http')result=await http(e.data.args||{});
     else if(e.data.command==='login'){
       result=await login(e.data.args);
       if(result.button){const button=result.button;delete result.button;answer(result);
         setTimeout(()=>{
           const signal=result=>{
             try{window.parent.postMessage({type:'C20_OFFSCREEN_LOGIN_CLICK_SIGNAL',result},e.origin)}catch{}
           };
           signal('CLICK_ATTEMPT');
           try{button.click();signal('CLICK_RETURNED')}
           catch{signal('CLICK_EXCEPTION')}
         },40);return;}
     } else if(e.data.command==='wifiSet')result=await wifiSet(e.data.args||{});
     else if(e.data.command==='reboot'){
       result=reboot();if(result.button){const button=result.button;delete result.button;answer(result);
         setTimeout(()=>{try{button.click()}catch{}},40);return;}
     }
     answer(result||{status:'EMPTY_RESULT'});
   }catch(e){answer({status:'OFFSCREEN_VENDOR_EXCEPTION',reason:String(e?.name||'Error')});}
   finally{working=false;}
 });
})();
