/* RouterLab C20 0.8.3: fresh router-origin JSESSIONID pre-login wire check. */
'use strict';
importScripts('c20.js','crypto.js','protocol.js','flow.js');
const URL='http://192.168.0.1/', PAGE=chrome.runtime.getURL('setup.html');
const getState=()=>({authenticated:!!session.token,validated:!!session.identity?.allowed});
let tabId=null,tabOwned=false,vendorWindowId=null,busy=false,transport='unselected',lastProbeStage='UNKNOWN',postFactory=false;
let nativeSessionOptIn=false; // never silently borrow an unrelated stock tab's auth state
let session={crypto:null,token:null,identity:null,radio:null,wan:null,lastRead:0};
let nativeEvidence=null, pendingWrite=null;
let preferredGdprHeaderMode=null; // Volatile; never persist a header workaround without physical proof.
const PENDING_KEY='c20PendingWifiWriteV1';
const QUICK_PENDING_KEY='c20PendingQuickStepV1';
const ADMIN_PENDING_KEY='c20PendingFirstPasswordV1';
const LOGIN_STATE_KEY='c20PendingAcceptedLoginStateV1'; // no passwords/tokens; locks ambiguous re-login
const LOGIN_CRYPTO_CONTEXT_KEY='c20PendingLoginCryptoContextV1'; // transient crypto only in chrome.storage.session
const LOGIN_ATTEMPTS_KEY='c20RecentLoginPostsV1'; // timestamps only; max three per ten minutes
const NATIVE_WIZARD_KEY='c20LastVisibleNativeWizardV1'; // read-only hint, NEVER authentication proof
// MV3 service workers can be evicted during a pause in the wizard. Store only
// non-secret write intent in extension session storage so a restart cannot
// inadvertently re-send an ambiguous Wi-Fi mutation.
async function recoverPending(){
 const area=chrome.storage?.session;
 if(!area) return;
 const saved=(await area.get(PENDING_KEY))[PENDING_KEY];
 if(saved && typeof saved.at==='number' && saved.expected && saved.stage)
   pendingWrite=saved;
}
async function setPending(next){
 const area=chrome.storage?.session;
 if(!area){if(next)throw Error('C20_SESSION_STORAGE_UNAVAILABLE_WRITE_BLOCKED');pendingWrite=null;return;}
 if(next)await area.set({[PENDING_KEY]:next});
 else await area.remove(PENDING_KEY);
 pendingWrite=next;
}
async function clearPendingLoginCrypto(){
 try{await chrome.storage?.session?.remove(LOGIN_CRYPTO_CONTEXT_KEY)}catch{}
}
function validRouterJsessionid(value){
 return typeof value==='string'&&value.length>0&&value.length<=512&&
   /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value);
}
async function pendingLoginJsessionid(){
 try{
  const area=chrome.storage?.session;if(!area)return null;
  const saved=(await area.get(LOGIN_CRYPTO_CONTEXT_KEY))[LOGIN_CRYPTO_CONTEXT_KEY];
  if(!saved||!Number.isFinite(saved.at)||Date.now()-saved.at>30*60*1000||
     !validRouterJsessionid(saved.routerJsessionid))return null;
  return saved.routerJsessionid;
 }catch{return null;}
}
async function restorePendingLoginCrypto(pending){
 if(session.crypto)return true;
 if(!pending||pending.state!=='ACK_ZERO_POSTLOGIN_CHECK')return false;
 const area=chrome.storage?.session;if(!area)return false;
 const saved=(await area.get(LOGIN_CRYPTO_CONTEXT_KEY))[LOGIN_CRYPTO_CONTEXT_KEY];
 if(!saved||!Number.isFinite(saved.at)||Date.now()-saved.at>30*60*1000){
   await clearPendingLoginCrypto();return false;
 }
 try{
   session.crypto=await C20Crypto.restoreContext(saved.nn,saved.ee,saved.seq,
     saved.key,saved.iv,saved.h);
   transport='offscreen-rpc';
   return true;
 }catch{await clearPendingLoginCrypto();return false;}
}
async function writeStatus(){
 await recoverPending();
 return {pending:!!pendingWrite,stage:pendingWrite?.stage||null,
   check:pendingWrite?'RECONNECT_AND_READ_WIFI':null};
}
function clearSession(){session={crypto:null,token:null,identity:null,radio:null,wan:null,lastRead:0};nativeEvidence=null}
async function openMaster(){
 const tabs=await chrome.tabs.query({});
 const old=tabs.find(t=>t.url===PAGE);
 if(old){await chrome.tabs.update(old.id,{active:true});if(Number.isInteger(old.windowId))await chrome.windows.update(old.windowId,{focused:true}).catch(()=>{});return;}
 await chrome.tabs.create({url:PAGE,active:true});
}
chrome.runtime.onInstalled.addListener(({reason})=>{stopRouterCookieBridge().catch(()=>{});if(reason==='install')openMaster().catch(()=>{})});
chrome.action.onClicked.addListener(()=>openMaster().catch(()=>{}));
chrome.tabs.onRemoved.addListener(id=>{if(id===tabId){tabId=null;nativeSessionOptIn=false;if(transport==='tab'||transport==='native'){clearSession();transport='unselected';}postFactory=false;}});
function messageSafe(err){return String(err?.message||err||'ERROR').replace(/(password|pass|ssid|key|token|sign|cookie)=\S+/ig,'$1=[redacted]').slice(0,250)}
async function ensureTab(){
 if(tabId!==null){try{const t=await chrome.tabs.get(tabId);if(t.url?.startsWith(URL))return tabId;}catch{ }tabId=null;clearSession()}
 // Reuse an existing router tab if the user already opened it.
 const existing=typeof chrome.tabs.query==='function'?await chrome.tabs.query({url:'http://192.168.0.1/*'}).catch(()=>[]):[];
 if(existing?.length){tabId=existing[0].id;tabOwned=false;return tabId;}
 const t=await chrome.tabs.create({url:URL,active:false});tabId=t.id;tabOwned=true;
 const start=Date.now();while(Date.now()-start<14000){const v=await chrome.tabs.get(tabId);if(v.status==='complete')return tabId;await new Promise(r=>setTimeout(r,250))}
 throw Error('C20_TAB_LOAD_TIMEOUT');
}
// A failed content-script fetch is not a failed administrator login.
// Try a host-permissioned MV3 Service Worker request first, keeping the SAME
// transport throughout login and authenticated requests.
function routeAllowed(path){
 if(!/^\/(?:$|cgi\/(?:getGDPRParm|getParm|getBusy|login)|cgi_gdpr)$/.test(path))throw Error('C20_ROUTE_NOT_ALLOWED');
}
function safeReason(e){return String(e?.name||'Error').replace(/[^a-z0-9_-]/ig,'').slice(0,40)}
// Only for read-only diagnostics, never store or print CGI request bodies,
// tokens, credentials or arbitrary HTML responses. Chrome DNR rejections
// usually explain the invalid rule in e.message, not in e.name.
function diagnosticReason(e){
 const message=String(e?.message||e?.reason||e||'').replace(/(?:https?:\/\/)?192\.168\.0\.1/g,'[ROUTER]')
   .replace(/(?:[?&](?:password|pass|ssid|token|sign|data|cookie|key)=)[^\s&]+/ig,'[redacted]')
   .replace(/[^a-zA-Z0-9 _.,:;()\[\]/=-]/g,'_').slice(0,180);
 return message||safeReason(e);
}
async function httpDirect(path,method='GET',body=null,headers={}){
 routeAllowed(path);
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
 try{
   const response=await fetch(URL.replace(/\/$/,'')+path,{method,headers,body,credentials:'include',redirect:'follow',cache:'no-store',signal:c.signal});
   return {http:response.status,url:new globalThis.URL(response.url).pathname,text:(await response.text()).slice(0,280000)};
 }catch(e){throw Error('DIRECT_'+safeReason(e));}finally{clearTimeout(timer)}
}
// Check the vendor parameter endpoint with *read-only* variants only.
// An HTTP 500 is a valid server reply, not a missing Chrome permission.
// The stock firmware may require an XMLHttpRequest-style POST body/content type.
// No guessed login or LAN_WLAN SET is ever sent by this diagnostic.
async function cryptoParamsBy(send){
 const attempts=[
  {id:'POST_EMPTY_BODY_ABSENT',path:'/cgi/getGDPRParm',method:'POST',body:null,headers:{}},
  {id:'POST_URLENCODED_ZERO_LENGTH',path:'/cgi/getGDPRParm',method:'POST',body:'',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}},
  {id:'ALT_GETPARM_POST',path:'/cgi/getParm',method:'POST',body:null,headers:{}},
  {id:'GET_GDPR',path:'/cgi/getGDPRParm',method:'GET',body:null,headers:{}}
 ];
 const statuses=[];
 for(const a of attempts){
   try{
     const r=await send(a.path,a.method,a.body,a.headers);
     let params=null;
     if(r.http===200)try{params=C20Crypto.getParams(r.text)}catch{}
     statuses.push({variant:a.id,http:r.http,valid:!!params});
     if(params)return {params,response:r,selectedVariant:a.id,statuses};
   }catch(e){statuses.push({variant:a.id,http:0,valid:false,error:safeReason(e)})}
 }
 return {params:null,response:null,selectedVariant:null,statuses};
}
// Inspect cookie presence only; never expose/store cookie values, auth tokens or headers.
// credentials:'include' already sends eligible cookies, without this API.
async function sessionCookieSummary(){
 if(!chrome.cookies?.getAll)return {apiAvailable:false,present:null};
 try{const items=await chrome.cookies.getAll({url:URL});
  return {apiAvailable:true,present:items.length>0,count:items.length};
 }catch(e){return {apiAvailable:true,present:null,error:safeReason(e)};}
}
// In native TP-Link the GDPR POST comes from http://192.168.0.1; in MV3
// it comes from chrome-extension://<id>. Some firmware rejects this origin.
// Chrome forbids setting Origin via fetch headers, but a narrowly scoped
// declarativeNetRequest SESSION rule can test this hypothesis. Rules are only
// installed around ONE read-only request and removed in finally, even on 500.
// These rules can affect only this extension's POSTs to this exact router CGI.
const HEADER_DIAG_RULE_ID=95801;
function gdprHeaderRule(mode,path){
 const op=mode==='REMOVE_ORIGIN'?[
   {header:'origin',operation:'remove'},{header:'referer',operation:'remove'}
 ]:mode==='ROUTER_ORIGIN'?[
   {header:'origin',operation:'set',value:'http://192.168.0.1'},
   {header:'referer',operation:'set',value:URL}
 ]:null;
 if(!op||!['/cgi/getGDPRParm','/cgi_gdpr'].includes(path))throw Error('C20_HEADER_DIAG_SCOPE_DENIED');
 return {id:HEADER_DIAG_RULE_ID,priority:1,
   action:{type:'modifyHeaders',requestHeaders:op},
   condition:{urlFilter:'|http://192.168.0.1'+path,
     initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest'],requestMethods:['post']}};
}
async function clearHeaderDiagnosticRule(){
 const api=chrome.declarativeNetRequest;
 if(!api?.updateSessionRules)return;
 await api.updateSessionRules({removeRuleIds:[HEADER_DIAG_RULE_ID]});
}
async function withHeaderDiagnostic(mode,path,callback){
 const api=chrome.declarativeNetRequest;
 if(!api?.updateSessionRules)throw Error('DNR_API_UNAVAILABLE');
 let failure=null;
 try{
   try{await clearHeaderDiagnosticRule();}
   catch(e){throw Error('DNR_PRE_CLEAN: '+diagnosticReason(e));}
   try{await api.updateSessionRules({addRules:[gdprHeaderRule(mode,path)]});}
   catch(e){throw Error('DNR_INSTALL: '+diagnosticReason(e));}
   try{return await callback();}
   catch(e){throw Error('DNR_REQUEST: '+diagnosticReason(e));}
 }catch(e){failure=e;throw e;}
 finally{
   try{await clearHeaderDiagnosticRule();}
   catch(e){
     // Cleanup failure takes precedence: the rule may remain active. No
     // further exploratory request should run under an unknown header rule.
     throw Error('DNR_CLEANUP: '+diagnosticReason(e)+(failure?' AFTER_'+safeReason(failure):''));
   }
 }
}
// Offscreen iframe feasibility: no credentials, no CGI and no writes. If Chrome
// and the stock firmware allow framing, a content script running inside the
// *real router-origin iframe* reports a minimal stage enum (never a password).
// This result is only a transport capability signal. It does NOT imply that
// we can login, call vendor APIs, apply WLAN settings, or safely bypass CSP.
let offscreenProbeInFlight=null, offscreenProbeSeen=null, cachedOffscreenProbe=null;
async function probeOffscreenVendorFrame(){
 if(!chrome.offscreen?.createDocument || !chrome.offscreen?.closeDocument)
   return {status:'OFFSCREEN_API_UNAVAILABLE'};
 if(offscreenProbeInFlight)return offscreenProbeInFlight;
 offscreenProbeInFlight=(async()=>{
   let created=false, timeout=null;
   try{
     if(chrome.runtime.getContexts){
       const current=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
       if(current?.length)return {status:'OFFSCREEN_CONTROL_ALREADY_PRESENT_DIAGNOSTIC_SKIPPED'};
     }
     let complete;
     const seen=new Promise(resolve=>{complete=resolve;});
    offscreenProbeSeen=complete;
    await recordOffscreenCookieBootstrap();
     try{await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['IFRAME_SCRIPTING'],
         justification:'Read-only test whether Archer C20 native UI can load in a hidden router-origin frame; no credentials or writes'});
       created=true;
     }catch(e){return {status:'OFFSCREEN_CREATE_FAILED',detail:diagnosticReason(e)};}
     const result=await Promise.race([seen,new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),12000);})]);
     if(!result)return {status:'OFFSCREEN_NO_FRAME_SIGNAL',detail:'FRAME_DENIED_OR_CONTENT_SCRIPT_NOT_INJECTED'};
     return {status:result.readConfirmed?'OFFSCREEN_VENDOR_READ_CONFIRMED':'OFFSCREEN_VENDOR_READ_UNCONFIRMED',
       vendorStatus:result.status,isC20:!!result.isC20,readConfirmed:!!result.readConfirmed,
       recordCount:result.recordCount,has24:!!result.has24,has5:!!result.has5,
       gdprHttp:result.gdprHttp,gdprValid:result.gdprValid,gdprStatus:result.gdprStatus};
   }catch(e){return {status:'OFFSCREEN_PROBE_ERROR',detail:diagnosticReason(e)};}
   finally{
     if(timeout!==null)clearTimeout(timeout);
     offscreenProbeSeen=null;
     if(created)try{await chrome.offscreen.closeDocument();}
       catch(e){/* diagnostic only; never mark frame as auth-ready */}
   }
 })();
 try{return await offscreenProbeInFlight;}
 finally{offscreenProbeInFlight=null;}
}
// Persistent real-origin iframe. The previous diagnostic closed this document after
// getting RSA_PARAMS_VALID, and never used the successful channel for login.
let offscreenCreating=null, offscreenVerifiedMap=null;
let activeLoginAudit=null,activeStateReadAudit=null;
// Ephemeral, metadata-only accounting. No URL query, credentials, ciphertext,
// response bodies or session tokens are recorded. Distinguishes OUR XHRs from
// stock-tab traffic observed by webRequest.
function traceOwnRequest(operation, path){
 const audit=activeLoginAudit;
 if(!audit||Date.now()-audit.started>22000||audit.ownRequests.length>=24)return null;
 const event={operation,endpoint:path==='/cgi_gdpr'?'ENCRYPTED_CGI':
   path==='/cgi/getGDPRParm'?'RSA_PARAMETERS':path==='/'?'ROUTER_ROOT':'OTHER',
   source:'ROUTERLAB_OFFSCREEN',status:'STARTED'};
 audit.ownRequests.push(event);return event;
}

function loginHttpEvent(d,failed){
 const stateAudit=activeStateReadAudit&&Date.now()-activeStateReadAudit.started<=22000?
   activeStateReadAudit:null;
 const audit=stateAudit||activeLoginAudit;
 if(!audit||Date.now()-audit.started>22000)return;
 const pathname=(()=>{try{return new globalThis.URL(d.url).pathname}catch{return''}})();
 if(!['/cgi_gdpr','/cgi/login','/cgi/getGDPRParm'].includes(pathname))return;
 // During a password-free explicit WLAN read, keep only the browser's final
 // request outcome. This distinguishes a router HTTP response from Chrome
 // transport failures without recording URLs, headers, or response content.
 if(stateAudit){
   if(!Array.isArray(stateAudit.wire)||stateAudit.wire.length>=30)return;
   const event={route:pathname==='/cgi_gdpr'?'CGI':pathname==='/cgi/login'?'LOGIN':'PARAMS',
     phase:failed?'ERROR':'COMPLETE',
     ...(failed?{outcome:'NETWORK_ERROR',...(typeof d.error==='string'&&/^net::ERR_[A-Z0-9_]+$/.test(d.error)?{netError:d.error}:{})}:
       {httpStatus:Number(d.statusCode)||0})};
   stateAudit.wire.push(event);return;
 }
 if(audit.requests.length>=20)return;
 audit.requests.push({path:pathname==='/cgi_gdpr'?'GDPR':pathname==='/cgi/login'?'LOGIN':'PARAMS',
   http:failed?0:d.statusCode||0,outcome:failed?'NETWORK_ERROR':'HTTP_REPLY',
   source:Number.isInteger(d.tabId)&&d.tabId>=0?'VISIBLE_TAB':'NO_TAB_CONTEXT',
   ...(failed&&d.error?{netError:String(d.error).replace(/[^a-z0-9:_-]/ig,'').slice(0,65)}:{})});
}
// Classify a router-issued JSESSIONID without returning its value in logs.
function routerJsessionDisposition(header){
 if(typeof header!=='string'||header.length>4096)return 'INVALID_HEADER';
 const match=/^\s*JSESSIONID=([^;\r\n]+)(?:;|$)/i.exec(header);
 if(!match)return 'NOT_JSESSIONID';
 if(match[1].length<1||match[1].length>512||
    !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(match[1]))return 'INVALID_VALUE';
 // A Set-Cookie carrying an old JSESSIONID can be a deletion instruction.
 // Never use it as proof that this request created a usable session.
 const maxAge=/;\s*Max-Age\s*=\s*(-?\d+)/i.exec(header);
 if(maxAge&&Number(maxAge[1])<=0)return 'EXPIRED_OR_DELETION';
 const expires=/;\s*Expires\s*=\s*([^;]+)/i.exec(header);
 if(expires){const expiry=Date.parse(expires[1]);if(Number.isFinite(expiry)&&expiry<=Date.now())return 'EXPIRED_OR_DELETION';}
 return 'FRESH_CANDIDATE';
}
function parseRouterIssuedJsession(header){
 return routerJsessionDisposition(header)==='FRESH_CANDIDATE'?
   /^\s*JSESSIONID=([^;\r\n]+)/i.exec(header)[1]:null;
}
function sessionCookieCaptureEvidence(headers,eligible){
 const set=(headers||[]).filter(h=>String(h.name||'').toLowerCase()==='set-cookie');
 const jsession=set.filter(h=>/^\s*JSESSIONID\s*=/i.test(String(h.value||'')));
 if(!jsession.length)return 'NO_JSESSIONID_SET_COOKIE';
 const dispositions=jsession.map(h=>routerJsessionDisposition(h.value));
 if(dispositions.some(x=>x==='EXPIRED_OR_DELETION'))return 'EXPIRED_OR_DELETION';
 if(dispositions.some(x=>x!=='FRESH_CANDIDATE'))return 'INVALID_JSESSIONID_SET_COOKIE';
 if(jsession.length!==1)return 'AMBIGUOUS_JSESSIONID_SET_COOKIE';
 return eligible?'FRESH_COOKIE_CAPTURED':'VALID_COOKIE_NOT_CAPTURE_ELIGIBLE';
}
// Read-only wire evidence. No raw Cookie/Set-Cookie/Authorization headers,
// session IDs, passwords, body content, or complete URLs are stored. All
// observations are volatile and scoped to the explicit user login window.
function evidenceHeaderFlags(headers, response=false){
 if(!Array.isArray(headers))return {observed:false};
 const exact=k=>headers.filter(h=>String(h.name||'').toLowerCase()===k);
 const cookieHeader=exact(response?'set-cookie':'cookie');
 const authorization=exact('authorization');
 const cTypes=new Set();let sameSite='NOT_VISIBLE';
 if(response){
  for(const h of cookieHeader){
   const v=String(h.value||'');
   if(/^JSESSIONID\s*=/i.test(v))cTypes.add('JSESSIONID');
   else if(/^Authorization\s*=/i.test(v))cTypes.add('AUTHORIZATION');
   else cTypes.add('OTHER');
   if(/;\s*SameSite=None\b/i.test(v))sameSite='NONE';
   else if(/;\s*SameSite=Lax\b/i.test(v))sameSite='LAX';
   else if(/;\s*SameSite=Strict\b/i.test(v))sameSite='STRICT';
   else if(sameSite==='NOT_VISIBLE')sameSite='UNSPECIFIED';
  }
 }
 return {observed:true,cookiePresent:cookieHeader.length>0,
   ...(response?{setCookieCount:cookieHeader.length,knownNames:[...cTypes],sameSite}
     :{authorizationHeaderPresent:authorization.length>0})};
}
function wireEvidence(d,kind){
 const audit=activeStateReadAudit&&Date.now()-activeStateReadAudit.started<=22000?
   activeStateReadAudit:activeLoginAudit;
 if(!audit||Date.now()-audit.started>22000||!Array.isArray(audit.wire)||audit.wire.length>=30)return;
 const route=(()=>{try{return new globalThis.URL(d.url).pathname}catch{return''}})();
 const rootBootstrap=route==='/'&&audit===activeLoginAudit&&audit.rootBootstrapIntent===true;
 if(!rootBootstrap&&!['/cgi_gdpr','/cgi/login','/cgi/getGDPRParm','/cgi/getBusy'].includes(route))return;
 const headers=kind==='RESPONSE'?d.responseHeaders:d.requestHeaders;
 const flags=evidenceHeaderFlags(headers,kind==='RESPONSE');
 const cookieCaptureRoute=rootBootstrap||route==='/cgi/getGDPRParm'||route==='/cgi_gdpr'||
   (route==='/cgi/getBusy'&&audit?.busyProbeIntent===true);
 const cookieCaptureEligible=kind==='RESPONSE'&&audit===activeLoginAudit&&
   Number(d.tabId)===-1&&cookieCaptureRoute&&
   String(d.initiator||'').startsWith('http://192.168.0.1');
 const sessionCookieEvidence=kind==='RESPONSE'?
   sessionCookieCaptureEvidence(headers,cookieCaptureEligible):null;
 // Capture ONLY a session cookie newly issued by this router in the current
 // user-initiated operation. This value stays in volatile SW memory, is never
 // logged and is never read from an unrelated visible TP-Link tab. On the
 // physical C20 the cookie appeared in Set-Cookie before the Cookies API
 // reflected it; that timing previously made the bridge silently skip LOGIN.
 if(audit===activeLoginAudit&&kind==='RESPONSE'&&Number(d.tabId)===-1&&
     rootBootstrap&&
     String(d.initiator||'').startsWith('http://192.168.0.1')){
   const set=(headers||[]).filter(h=>String(h.name||'').toLowerCase()==='set-cookie');
   const ids=set.map(h=>parseRouterIssuedJsession(h.value)).filter(Boolean);
   if(ids.length===1)audit.freshRootCookie=ids[0];
 }
 if(audit===activeLoginAudit&&kind==='RESPONSE'&&Number(d.tabId)===-1&&
     (route==='/cgi/getGDPRParm'||route==='/cgi_gdpr'||
      (route==='/cgi/getBusy'&&audit.busyProbeIntent===true))&&
     String(d.initiator||'').startsWith('http://192.168.0.1')){
   const set=(headers||[]).filter(h=>String(h.name||'').toLowerCase()==='set-cookie');
   const ids=set.map(h=>parseRouterIssuedJsession(h.value)).filter(Boolean);
   if(ids.length===1){
     if(route==='/cgi/getGDPRParm')audit.freshParamsCookie=ids[0];
     else if(route==='/cgi_gdpr'&&audit.loginSubmitIntentCount===1)audit.freshLoginCookie=ids[0];
     else if(route==='/cgi/getBusy'&&audit.busyProbeIntent===true)audit.freshBusyCookie=ids[0];
   }
 }
 audit.wire.push({route:rootBootstrap?'ROOT':route==='/cgi_gdpr'?'CGI':route==='/cgi/login'?'LOGIN':route==='/cgi/getBusy'?'BUSY':'PARAMS',
   phase:kind,context:Number.isInteger(d.tabId)&&d.tabId>=0?'VISIBLE_TAB':'NO_TAB_CONTEXT',
    ...(kind==='RESPONSE'?{httpStatus:Number(d.statusCode)||0,sessionCookieEvidence}:{}),...flags});
}
// Headers are OBSERVED only. No webRequestBlocking, no Cookie modification.
try{chrome.webRequest?.onSendHeaders?.addListener(d=>wireEvidence(d,'REQUEST'),
 {urls:['http://192.168.0.1/','http://192.168.0.1/cgi_gdpr*','http://192.168.0.1/cgi/login*','http://192.168.0.1/cgi/getGDPRParm*','http://192.168.0.1/cgi/getBusy*']},['requestHeaders','extraHeaders']);}catch{}
try{chrome.webRequest?.onHeadersReceived?.addListener(d=>wireEvidence(d,'RESPONSE'),
 {urls:['http://192.168.0.1/','http://192.168.0.1/cgi_gdpr*','http://192.168.0.1/cgi/login*','http://192.168.0.1/cgi/getGDPRParm*','http://192.168.0.1/cgi/getBusy*']},['responseHeaders','extraHeaders']);}catch{}
// The hidden iframe's first router-root navigation can create the anonymous
// JSESSIONID before the later RSA request. Capture only that exact
// extension-owned, no-tab response; keep the cookie volatile and out of logs.
let offscreenBootstrapCookie=null;
function captureOffscreenBootstrapCookie(d){
 if(Number(d.tabId)!==-1||d.type!=='sub_frame')return;
 let url;
 try{url=new globalThis.URL(d.url)}catch{return}
 const prefix='chrome-extension://'+chrome.runtime.id;
 const initiator=String(d.initiator||'');
 if(url.origin!=='http://192.168.0.1'||url.pathname!=='/'||
    !(initiator===prefix||initiator.startsWith(prefix+'/')))return;
 const set=(d.responseHeaders||[]).filter(h=>String(h.name||'').toLowerCase()==='set-cookie');
 const ids=set.map(h=>parseRouterIssuedJsession(h.value)).filter(Boolean);
 if(ids.length===1)offscreenBootstrapCookie=ids[0];
}
try{chrome.webRequest?.onHeadersReceived?.addListener(captureOffscreenBootstrapCookie,
 {urls:['http://192.168.0.1/*'],types:['sub_frame']},['responseHeaders','extraHeaders']);}catch{}
// Cookie API's default scope is unpartitioned; it cannot be taken as proof
// that a third-party iframe received or sent a cookie. The partitioned query
// may be unsupported on a user's Chrome: report UNSUPPORTED, not absent.
async function cookiePartitionEvidence(){
 if(!chrome.cookies?.getAll)return {api:'UNAVAILABLE'};
 const summarize=items=>({count:items.length,
   knownNames:[...new Set(items.map(c=>/^JSESSIONID$/i.test(c.name)?'JSESSIONID':
     /^Authorization$/i.test(c.name)?'AUTHORIZATION':'OTHER'))],
   sameSite:[...new Set(items.map(c=>['lax','strict','no_restriction','unspecified'].includes(c.sameSite)?c.sameSite:'UNKNOWN'))]});
 const result={api:'AVAILABLE',unpartitioned:'UNAVAILABLE',partitioned:'UNAVAILABLE'};
 try{result.unpartitioned=summarize(await chrome.cookies.getAll({url:URL}));}catch{}
 try{result.partitioned=summarize(await chrome.cookies.getAll({url:URL,
   partitionKey:{topLevelSite:'chrome-extension://'+chrome.runtime.id}}));}
 catch{result.partitioned='UNSUPPORTED_OR_INACCESSIBLE';}
 return result;
}
// Password-free metadata for an explicit state refresh. Cookie values and
// derived key material are inspected only for presence/age and never returned.
async function stateRefreshContextEvidence(pending){
 let saved=null;
 try{
  const area=chrome.storage?.session;
  if(area)saved=(await area.get(LOGIN_CRYPTO_CONTEXT_KEY))[LOGIN_CRYPTO_CONTEXT_KEY]||null;
 }catch{}
 const now=Date.now();
 return {
  pendingState:typeof pending?.state==='string'?pending.state:'NONE',
  fenceReadAttempted:pending?.explicitProtectedReadAttempted===true,
  explicitReadCount:Number.isInteger(pending?.explicitProtectedReadCount)?pending.explicitProtectedReadCount:
    (pending?.explicitProtectedReadAttempted===true?1:0),
  pendingAgeSec:Number.isFinite(pending?.at)?Math.max(0,Math.round((now-pending.at)/1000)):null,
  cryptoStored:!!saved,
  cryptoAgeSec:Number.isFinite(saved?.at)?Math.max(0,Math.round((now-saved.at)/1000)):null,
  routerCookieStored:validRouterJsessionid(saved?.routerJsessionid),
  cryptoInMemory:!!session.crypto,tokenInMemory:!!session.token,
  radioCached:!!session.radio,transport,
  cookieJar:await cookiePartitionEvidence()
 };
}
let offscreenCookieJarInitiallyEmpty=null;
async function recordOffscreenCookieBootstrap(){
 if(offscreenCookieJarInitiallyEmpty!==null)return;
 const evidence=await cookiePartitionEvidence();
 offscreenCookieJarInitiallyEmpty=evidence.unpartitioned?.count===0;
}
// webRequest is observational only (no blocking, no header/body access).
// Some browser contexts won't produce events here: report UNKNOWN, not success.
chrome.webRequest?.onCompleted?.addListener(d=>loginHttpEvent(d,false),
 {urls:['http://192.168.0.1/cgi_gdpr*','http://192.168.0.1/cgi/login*','http://192.168.0.1/cgi/getGDPRParm*']});
chrome.webRequest?.onErrorOccurred?.addListener(d=>loginHttpEvent(d,true),
 {urls:['http://192.168.0.1/cgi_gdpr*','http://192.168.0.1/cgi/login*','http://192.168.0.1/cgi/getGDPRParm*']});
async function ensureOffscreenControl(){
 if(!chrome.offscreen?.createDocument||!chrome.runtime?.sendMessage)
   throw Error('C20_OFFSCREEN_API_UNAVAILABLE');
 if(offscreenCreating)return offscreenCreating;
 offscreenCreating=(async()=>{
   const existing=chrome.runtime.getContexts ? await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}) : [];
    if(!existing?.length){
      await recordOffscreenCookieBootstrap();
     try{await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['IFRAME_SCRIPTING'],
       justification:'TP-Link vendor-origin local router session and settings without an extra browser tab'});}
     catch(e){
       // Chrome may race another creation; only treat as success if now present.
       const current=chrome.runtime.getContexts?await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}):[];
       if(!current?.length)throw Error('C20_OFFSCREEN_CREATE_'+safeReason(e));
     }
   }
 })();
 try{return await offscreenCreating}finally{offscreenCreating=null}
}
async function offscreenCommand(command,args={}){
 await ensureOffscreenControl();
 // The extension-owned offscreen document relays only to the named router iframe.
 let response;
 try{response=await chrome.runtime.sendMessage({type:'C20_OFFSCREEN_OPERATION',command,args})}
 catch(e){throw Error('C20_OFFSCREEN_BRIDGE_'+safeReason(e))}
 if(!response?.ok)throw Error('C20_OFFSCREEN_'+(response?.reason||'NO_RESPONSE'));
 return response.result;
}
async function offscreenDiscover(){
 let response=await offscreenCommand('inspect');
 if(response?.stage==='AUTH_UNCONFIRMED'&&response.reason==='STOCK_API_NOT_READY'){
   await new Promise(r=>setTimeout(r,500));response=await offscreenCommand('inspect');
 }
 if(response?.stage==='CONFIGURED_AUTHENTICATED'&&response.readConfirmed===true&&response.radio){
   offscreenVerifiedMap={...response.radio,at:Date.now()};
 }else offscreenVerifiedMap=null;
 return response;
}
async function offscreenLogin(password){
 if(typeof password!=='string'||!password||password.length>80||/[\r\n\0]/.test(password))throw Error('C20_ADMIN_PASSWORD_REQUIRED');
 // This audit contains only status codes/booleans and is never persisted.
 const audit={started:Date.now(),requests:[],click:'NOT_OBSERVED'};
 activeLoginAudit=audit;
 try{
  const before=await offscreenDiscover().catch(()=>null);
  const reply=await offscreenCommand('login',{password});
  if(!reply?.submitted)throw Error('C20_OFFSCREEN_LOGIN_'+(reply?.status||'PRECHECK_FAILED'));
  let result=null;
  for(let i=0;i<12;i++){
    await new Promise(r=>setTimeout(r,450));
    try{result=await offscreenDiscover()}catch{continue}
    if(result?.stage==='CONFIGURED_AUTHENTICATED'&&result.readConfirmed)return result;
    if(result?.stage==='FACTORY_PASSWORD')break;
  }
  const cookies=await sessionCookieSummary();
  return {stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
   diagnostic:{click:audit.click,requests:audit.requests.slice(),
     frameNavigation:Number.isInteger(before?.frameLoads)&&Number.isInteger(result?.frameLoads)?
       result.frameLoads>before.frameLoads:null,
     stage:result?.stage||'UNKNOWN',
     storageAccess:result?.diagnostic?.storageAccess||'UNREPORTED',
     cookieAccess:result?.diagnostic?.cookieAccess||'UNREPORTED',
     uiError:result?.diagnostic?.uiError||'UNREPORTED',
     cookiePresent:cookies.present===true}};
 }finally{if(activeLoginAudit===audit)activeLoginAudit=null;}
}
async function offscreenSetWifi(req){
 validateWifiChange(req);await recoverPending();
 if(pendingWrite)throw Error('C20_PENDING_WRITE_CHECK_BEFORE_ANOTHER_CHANGE');
 if(typeof req.old24!=='string'||typeof req.old5!=='string')throw Error('C20_MISSING_BASELINE');
 const fresh=await offscreenDiscover();
 if(fresh?.stage!=='CONFIGURED_AUTHENTICATED'||!offscreenVerifiedMap)throw Error('C20_OFFSCREEN_PROTECTED_READ_REQUIRED');
 const map=offscreenVerifiedMap;
 if(map.ssid24!==req.old24||map.ssid5!==req.old5)throw Error('C20_WIFI_CHANGED_SINCE_DISPLAY');
 if(map.ssid24===req.ssid24&&map.ssid5===req.ssid5&&!req.password)return{noChanges:true,verified:true};
 const expected={ssid24:req.ssid24,ssid5:req.ssid5};
 await setPending({at:Date.now(),expected,passwordChanged:!!req.password,stage:'SENDING'});
 let result;
 try{result=await offscreenCommand('wifiSet',{ssid24:req.ssid24,ssid5:req.ssid5,
      password:req.password,old24:map.ssid24,old5:map.ssid5,stack24:map.stack24,stack5:map.stack5});}
 catch{await setPending({...pendingWrite,stage:'UNKNOWN_AFTER_OFFSCREEN_REQUEST'});
   return{submitted:'UNKNOWN',verified:false,retrySafe:false,reason:'OFFSCREEN_LINK_OR_REQUEST_INTERRUPTED'};}
 offscreenVerifiedMap=null;
 if(!result?.submitted){await setPending(null);return{submitted:false,verified:false,preflightFailed:true,reason:result?.reason||'OFFSCREEN_VENDOR_PRECHECK_FAILED'};}
 await setPending({...pendingWrite,stage:'PENDING_VERIFICATION'});
 if(result.ack!=='ACK_ZERO')return{submitted:true,verified:false,ack:result.ack||'UNKNOWN',retrySafe:false};
 try{
  await new Promise(r=>setTimeout(r,1000));
  const after=await offscreenDiscover();
  const namesMatch=after?.readConfirmed&&after.radio?.ssid24===expected.ssid24&&after.radio?.ssid5===expected.ssid5;
  if(namesMatch){await setPending({...pendingWrite,stage:'CONFIG_SAVED_AWAIT_APPLY'});
    return {submitted:true,verified:false,configVerified:true,applied:false,ack:result.ack,
      passwordVerificationRequired:!!req.password,applyRequired:true,retrySafe:false};}
 }catch{}
 return{submitted:true,verified:false,ack:result.ack,retrySafe:false,reason:'READBACK_PENDING'};
}
// Real router-origin XHR relay. Unlike the old vendor button click, this uses
// the protocol that RouterLab already signs/encrypts and gives an HTTP receipt.
// Never log the request body, crypto keys, passwords, or response contents.
async function offscreenHttp(path,method='GET',body=null,headers={},operation='OTHER'){
 routeAllowed(path);
 const trace=traceOwnRequest(operation,path);
 let result;
 try{result=await offscreenCommand('http',{path,method,body,headers});}
 catch(e){if(trace)trace.status='BRIDGE_ERROR';throw e}
 if(trace)trace.status=result?.http===0?'NETWORK_ERROR':'HTTP_'+(result?.http??'UNKNOWN');
 if(!result||typeof result.http!=='number')throw Error('C20_OFFSCREEN_HTTP_MALFORMED');
 if(result.http===0){
   const code=String(result.error||'NO_RESPONSE').replace(/[^A-Z_]/g,'').slice(0,40);
   const error=Error('C20_OFFSCREEN_HTTP_'+code);
   error.httpTrace={event:code,
     readyState:Number.isInteger(result.readyState)?result.readyState:null,
     elapsedMs:Number.isFinite(result.elapsedMs)?Math.round(result.elapsedMs):null};
   throw error;
 }
 return result;
}
// Archer C20's stock login page calls POST /cgi/getBusy to ask whether the
// router's web-management session is logged in / busy. These flags describe
// the ROUTER's global state, not proof that our offscreen iframe owns a valid
// cookie/TokenID. Never eval firmware JS and never use this probe to authorize.
function parseBusyReply(body){
 const s=String(body||'').slice(0,16384);
 const field=name=>{
   const matches=[...s.matchAll(new RegExp('(?:^|[;\r\n])\\s*(?:var\\s+)?'+name+'\\s*=\\s*(true|false|0|1)\\s*(?=;|[\r\n]|$)','ig'))];
   if(matches.length!==1)return null;
   return /^(?:true|1)$/i.test(matches[0][1]);
 };
 return {isLogined:field('isLogined'),isBusy:field('isBusy')};
}
async function inspectBusyReadOnly(){
 // The only network operation here is a no-body, same-origin POST to the
 // vendor's NON-authenticating /cgi/getBusy. Do not touch LOGIN_STATE_KEY.
 const page=await offscreenCommand('pageState').catch(()=>null);
 try{
   const r=await offscreenHttp('/cgi/getBusy','POST',null,{},'STOCK_BUSY_READ_ONLY');
   const parsed=r.http===200?parseBusyReply(r.text):{isLogined:null,isBusy:null};
   return {http:r.http,...parsed,frameStage:page?.stage||'UNKNOWN',
      isOwnSessionVerified:false,passwordSent:false,
      note:'ROUTER_GLOBAL_FLAGS_NOT_IFRAME_AUTH_PROOF'};
 }catch(e){return {http:0,isLogined:null,isBusy:null,frameStage:page?.stage||'UNKNOWN',
   isOwnSessionVerified:false,passwordSent:false,reason:diagnosticReason(e)};}
}
// v0.8.3: On the physical Archer, /cgi/getGDPRParm sets an unpartitioned
// JSESSIONID, but the subsequent request from the embedded (third-party)
// router frame has NO Cookie header. Chrome's default SameSite behavior can
// prevent that cookie from accompanying frame XHR. Do NOT invent a token or
// modify the stored cookie. Temporarily attach ONLY the cookie that the local
// router itself set to NO-TAB router-origin requests, never ordinary tabs.
// Chrome MV3 cannot set Cookie from page XMLHttpRequest; a tightly scoped
// session-only DNR modifyHeaders rule is the supported API for this test.
const ROUTER_COOKIE_XHR_RULE=95802;
const ROUTER_COOKIE_FRAME_RULE=95803;
const ROUTER_COOKIE_RULES=[ROUTER_COOKIE_XHR_RULE,ROUTER_COOKIE_FRAME_RULE];
let routerCookieBridgeActive=false;
async function stopRouterCookieBridge(){
  routerCookieBridgeActive=false;
  if(!chrome.declarativeNetRequest?.updateSessionRules)return;
  try{await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:ROUTER_COOKIE_RULES})}
  catch{/* do not report session material or compromise the login fence */}
}
async function prepareRouterCookieBridge(freshCookie=null){
  const api=chrome.declarativeNetRequest;
  if(!api?.updateSessionRules||!chrome.cookies?.getAll)return 'API_UNAVAILABLE';
  // Never keep a stale rule from a preceding failed attempt.
  await routerCookieBootCleanup;
  await stopRouterCookieBridge();
  let cookieValue=null;
  // Prefer the EXACT cookie from this attempt's router Set-Cookie response.
  // The Cookies API can lag behind the response or be restricted in iframe.
  if(typeof freshCookie==='string'&&freshCookie.length<=512&&
     /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(freshCookie))cookieValue=freshCookie;
  else if(freshCookie!==null)return 'INVALID_FRESH_COOKIE';
  if(!cookieValue){
    // Limited read-only wait for the browser cookie store to catch up.
    // Caller MUST have verified this is a NEW session, never a stale manual
    // stock-page login cookie. Do not arbitrarily choose an existing cookie.
    let cookies;
    try{cookies=await chrome.cookies.getAll({url:URL})}catch{return 'COOKIE_QUERY_FAILED'}
    const found=(cookies||[]).filter(c=>c.name==='JSESSIONID'&&
      typeof c.value==='string'&&c.value.length>0&&c.value.length<=512&&
      !/[\r\n;\0]/.test(c.value)&&c.domain?.replace(/^\./,'')==='192.168.0.1');
    if(found.length!==1)return found.length?'COOKIE_AMBIGUOUS':'COOKIE_NOT_PRESENT';
    cookieValue=found[0].value;
  }
  const cookie='JSESSIONID='+cookieValue;
  const common={type:'modifyHeaders',requestHeaders:[{header:'cookie',operation:'set',value:cookie}]};
  const rules=[
   {id:ROUTER_COOKIE_XHR_RULE,priority:2,action:common,condition:{
     regexFilter:'^http://192\\.168\\.0\\.1/(?:cgi_gdpr|cgi/getGDPRParm|cgi/getBusy)(?:\\?.*)?$',
     resourceTypes:['xmlhttprequest'],tabIds:[-1],initiatorDomains:['192.168.0.1']}},
   // The refresh of the *extension-owned* router iframe is a sub_frame load.
   // Its initiator is our own extension rather than 192.168.0.1.
   {id:ROUTER_COOKIE_FRAME_RULE,priority:2,action:common,condition:{
     regexFilter:'^http://192\\.168\\.0\\.1/(?:\\?.*)?$',
     resourceTypes:['sub_frame'],tabIds:[-1],initiatorDomains:[chrome.runtime.id]}}
  ];
  try{await api.updateSessionRules({removeRuleIds:ROUTER_COOKIE_RULES,addRules:rules});
    routerCookieBridgeActive=true;return 'RULE_INSTALLED';}
  catch{await stopRouterCookieBridge();return 'RULE_REJECTED'}
}
// Clean rules even after MV3 worker eviction, not only full browser startup.
// A restarted worker has no AES state and must not inherit an old cookie rule.
const routerCookieBootCleanup=stopRouterCookieBridge().catch(()=>{});
chrome.runtime.onStartup?.addListener(()=>stopRouterCookieBridge().catch(()=>{}));
// The device locks out after repeated invalid passwords. Reserve an attempt
// immediately before the only credential-bearing POST, across MV3 restarts.
// RSA parameter probes and protected READ operations do NOT count as logins.
async function reserveLoginPost(){
 const area=chrome.storage?.session;
 if(!area)throw Error('C20_LOGIN_RATE_GUARD_STORAGE_UNAVAILABLE');
 const now=Date.now();
 const current=(await area.get(LOGIN_ATTEMPTS_KEY))[LOGIN_ATTEMPTS_KEY];
 const recent=(Array.isArray(current)?current:[]).filter(t=>
   Number.isFinite(t)&&t>now-600000&&t<=now);
 if(recent.length>=3)throw Error('C20_LOGIN_RATE_LIMIT_THREE_PER_TEN_MINUTES');
 await area.set({[LOGIN_ATTEMPTS_KEY]:recent.concat(now)});
 return recent.length+1;
}
// A lost CGI reply does not prove that the LOGIN request failed on the router.
// Reconcile exactly once with a READ-ONLY protected WLAN request using the same
// transient AES context. Never replay the password, mutate settings or claim
// success based on an HTTP 200 alone. A failed reconciliation restores the
// pre-login transport and clears the unverified crypto session.
// Stock Archer implementations may require TokenID after a successful login.
// A GET of the router root is read-only; a token is never treated as proof of
// authentication until the encrypted WLAN response decrypts and maps both bands.
async function primeRouterOriginToken(){
 try{
   const root=await offscreenHttp('/','GET',null,{},'SESSION_ROOT_TOKEN_PROBE');
   const token=root.http===200?tokenFromHtml(root.text):null;
   session.token=token||null;
   return !!token;
 }catch{return false;}
}
async function reconcileAmbiguousLogin(ctx){
 const previousTransport=transport;
 transport='offscreen-rpc';
 session.crypto=ctx;session.token=null;session.identity=null;session.radio=null;session.wan=null;session.lastRead=0;
 let tokenEvidence=false;
 try{
   tokenEvidence=await primeRouterOriginToken();
   const raw=await gdprRead(C20Protocol.wifiRead());
   const wlan=C20Protocol.parseWifi(raw);
   if(!wlan.dynamicStacksVerified)throw Error('C20_RECOVERY_WLAN_MAP_UNCONFIRMED');
   session.radio=wlan;session.lastRead=Date.now();
   return {confirmed:true,tokenPresent:tokenEvidence,radio:{ssid24:wlan.radio24.ssid,ssid5:wlan.radio5.ssid,
       stack24:wlan.radio24.stack,stack5:wlan.radio5.stack},reason:'PROTECTED_WLAN_READ_CONFIRMED'};
 }catch(e){
   // The POST may have succeeded before the TCP response vanished. Preserve
   // its crypto context only as UNVERIFIED evidence for a future explicit
   // read-only refresh; the persisted fence prohibits another credential POST.
   session.crypto=ctx;session.identity=null;session.radio=null;
   transport='offscreen-rpc';
   return {confirmed:false,tokenPresent:tokenEvidence,reason:diagnosticReason(e)};
 }
}
// A zero CGI acknowledgment is NOT proof that Quick Setup completed, and an
// absent WLAN read is NOT an invalid password. Inspect stock UI first, then
// refresh the hidden iframe ONCE to let the vendor route to its actual screen.
// No second login, configuration SET or wizard click is made by this probe.
async function checkAcceptedLoginState(){
 const area=chrome.storage?.session;
 if(!area)return {stage:'UNKNOWN',reason:'SESSION_STORAGE_UNAVAILABLE'};
 await area.set({[LOGIN_STATE_KEY]:{at:Date.now(),state:'ZERO_ACK_UNRESOLVED'}});
 let refresh='NOT_NEEDED';
 for(let pass=0;pass<2;pass++){
   const view=await offscreenCommand('quickStage').catch(()=>null);
   if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(view?.stage)){
     await area.remove(LOGIN_STATE_KEY);
     return {stage:'QUICK_SETUP_ACTIVE',wizardStep:view.stage,reason:'VISIBLE_WIZARD_MARKERS',refresh};
   }
   if(view?.stage==='LOGIN_LOCKED')return {stage:'LOGIN_LOCKED',reason:'STOCK_LOCKOUT_VISIBLE',refresh};
   const page=await offscreenDiscover().catch(()=>null);
   if(page?.stage==='QUICK_SETUP_ACTIVE'){
     const confirmed=await offscreenCommand('quickStage').catch(()=>null);
     if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(confirmed?.stage)){
       await area.remove(LOGIN_STATE_KEY);
       return {stage:'QUICK_SETUP_ACTIVE',wizardStep:confirmed.stage,reason:'VISIBLE_WIZARD_MARKERS',refresh};
     }
   }
   if(page?.stage==='CONFIGURED_AUTHENTICATED'&&page.readConfirmed===true){
     await area.remove(LOGIN_STATE_KEY);
     return {stage:'CONFIGURED_AUTHENTICATED',radio:page.radio,reason:'STOCK_PROTECTED_READ',refresh};
   }
   if(pass===0){
     const refreshed=await offscreenCommand('refresh').catch(()=>null);
     refresh=refreshed?.refreshed===true?'FRAME_RELOADED':'REFRESH_NOT_CONFIRMED';
     if(refresh!=='FRAME_RELOADED')break;
   }
 }
 return {stage:'UNKNOWN',reason:'LOGIN_ACK_ZERO_SCREEN_UNRESOLVED',refresh};
}
async function offscreenEncryptedLogin(password){
 if(typeof password!=='string'||!password||password.length>80||/[\r\n\0]/.test(password))throw Error('C20_ADMIN_PASSWORD_REQUIRED');
 const cookiesBefore=await cookiePartitionEvidence();
 const pre=await offscreenDiscover();
 if(pre?.stage!=='LOGIN_FORM')throw Error('C20_OFFSCREEN_LOGIN_SCREEN_NOT_CONFIRMED');
 const receipt={method:'ROUTER_ORIGIN_ENCRYPTED_XHR',step:'PARAMS',http:0,
   paramsHttp:0,loginHttp:null,decrypted:false,readConfirmed:false,
   wireProfile:'NOT_SELECTED_YET'};
 const audit={started:Date.now(),requests:[],ownRequests:[],wire:[],click:'NOT_USED'};
 activeLoginAudit=audit;
 receipt.operationTrace=audit.ownRequests; // live reference; copied safely into diagnostics
 receipt.wireEvidence=audit.wire; // header presence/known names only, never values
 receipt.loginSubmitIntentCount=0;
 receipt.cookiesBefore=cookiesBefore;
 const frameBefore=await offscreenCommand('frameStatus').catch(()=>null);
 let cookieBridgeSessionConfirmed=false;
 try{
   // Refresh the anonymous router-origin cookie before requesting RSA params.
   // This is a same-origin GET / only; it never submits credentials. Capture
   // only a fresh JSESSIONID issued on this exact no-tab XHR response.
   audit.rootBootstrapIntent=true;
   let rootBootstrapReply=null;
   try{rootBootstrapReply=await offscreenHttp('/','GET',null,{},'LOGIN_ROOT_COOKIE_BOOTSTRAP')}
   catch{}
   finally{audit.rootBootstrapIntent=false;}
   receipt.rootBootstrapHttp=rootBootstrapReply?.http??0;
   receipt.rootBootstrapCookie=audit.freshRootCookie?'CAPTURED':'NOT_ISSUED';
   if(audit.freshRootCookie)offscreenBootstrapCookie=audit.freshRootCookie;
   // The router-origin frame returned HTTP 200 for this exact request on hardware.
   let r=await offscreenHttp('/cgi/getGDPRParm','POST',null,{},'LOGIN_RSA_PARAMS');
   receipt.http=r.http;receipt.paramsHttp=r.http;
   if(r.http===500){
     // Safe recovery for the post-native-tab-close case: NO LOGIN was sent.
     // Reload ONLY the extension's hidden vendor iframe, inspect its new
     // stage, and retry RSA parameters ONCE if it still shows LOGIN_FORM.
     const refreshed=await offscreenCommand('refresh').catch(()=>null);
     receipt.paramsRecovery=refreshed?.refreshed?'FRAME_REFRESHED':'FRAME_REFRESH_FAILED';
     if(refreshed?.refreshed){
       const after=await offscreenDiscover().catch(()=>null);
       receipt.paramsPostRefreshStage=after?.stage||'UNKNOWN';
       if(after?.stage==='QUICK_SETUP_ACTIVE'){
         const wizard=await offscreenCommand('quickStage').catch(()=>null);
         if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(wizard?.stage))
           return {stage:'QUICK_SETUP_ACTIVE',submitted:false,
             diagnostic:{...receipt,reason:'PARAMS_REFRESH_REVEALED_WIZARD',wizardStep:wizard.stage}};
       }
       if(after?.stage==='CONFIGURED_AUTHENTICATED'&&after.readConfirmed===true)
         return {stage:'CONFIGURED_AUTHENTICATED',submitted:false,readConfirmed:true,radio:after.radio,
           diagnostic:{...receipt,reason:'PARAMS_REFRESH_REVEALED_AUTHENTICATED_SCREEN'}};
       if(after?.stage==='LOGIN_FORM'){
         r=await offscreenHttp('/cgi/getGDPRParm','POST',null,{},'LOGIN_RSA_PARAMS_RECHECK');
         receipt.http=r.http;receipt.paramsHttp=r.http;
         receipt.paramsRecovery='REFRESHED_AND_RETRIED';
       }
     }
   }
   if(r.http!==200)return {stage:'LOGIN_SUBMITTED_UNVERIFIED',diagnostic:{...receipt,reason:'PARAMS_HTTP_ERROR',
     paramsRetrySafe:true},submitted:false};
   const params=C20Crypto.getParams(r.text);
   // Never send credentials when the session-cookie bridge cannot be scoped
   // safely. No password POST has occurred yet, so the user can stop here.
   // Prefer cookies issued by this attempt's RSA request or the hidden
   // extension-owned root bootstrap. Never open a visible tab as a fallback.
   // A cookie-store candidate is allowed only when the jar was empty before
   // RouterLab's first hidden load, or it is empty before this RSA request.
   const rsaCookie=typeof audit.freshParamsCookie==='string'?audit.freshParamsCookie:null;
   const rootXhrCookie=!rsaCookie&&typeof audit.freshRootCookie==='string'?audit.freshRootCookie:null;
   const bootstrapCookie=!rsaCookie&&!rootXhrCookie&&typeof offscreenBootstrapCookie==='string'?
     offscreenBootstrapCookie:null;
   if(bootstrapCookie)offscreenBootstrapCookie=null;
   receipt.firstPartyCookieBootstrap='DISABLED_NO_VISIBLE_TAB';
   const fresh=rsaCookie||rootXhrCookie||bootstrapCookie;
   const preCount=receipt.cookiesBefore?.unpartitioned?.count;
   const routerTabs=await chrome.tabs.query?.({url:'http://192.168.0.1/*'}).catch(()=>null);
   const bootstrapStoreCandidate=!fresh&&offscreenCookieJarInitiallyEmpty===true&&
     preCount!==0&&Array.isArray(routerTabs)&&routerTabs.length===0;
   receipt.cookieBridgeSource=rsaCookie?'FRESH_RSA_SET_COOKIE':
      rootXhrCookie?'FRESH_OFFSCREEN_ROOT_XHR_COOKIE':
      bootstrapCookie?'FRESH_OFFSCREEN_ROOT_SET_COOKIE':
      bootstrapStoreCandidate?'FRESH_OFFSCREEN_ROOT_COOKIE_STORE':
      preCount===0?'FRESH_COOKIE_STORE_CANDIDATE':'NO_VERIFIED_FRESH_COOKIE';
   receipt.cookieBridgeSeedSource=receipt.cookieBridgeSource;
   if(!fresh&&preCount!==0&&!bootstrapStoreCandidate){
     receipt.cookieBridge='FRESH_COOKIE_NOT_PROVEN';
     return {stage:'LOGIN_NOT_SUBMITTED',submitted:false,
       diagnostic:{...receipt,reason:'COOKIE_BRIDGE_PREFLIGHT_FAILED',noPasswordSent:true}};
   }
   if(!fresh){
     // The Set-Cookie event may precede the Cookies API store update.
     // Bounded wait only; NO requests to the router and NO password retry.
     for(let i=0;i<8;i++){
       const snap=await chrome.cookies?.getAll?.({url:URL}).catch(()=>[]);
       if(snap?.some(c=>c.name==='JSESSIONID'&&c.value))break;
       await new Promise(resolve=>setTimeout(resolve,125));
     }
   }
   receipt.cookieBridge=await prepareRouterCookieBridge(fresh);
   if(receipt.cookieBridge!=='RULE_INSTALLED')return {
     stage:'LOGIN_NOT_SUBMITTED',submitted:false,
     diagnostic:{...receipt,reason:'COOKIE_BRIDGE_PREFLIGHT_FAILED',noPasswordSent:true}};
   if(receipt.cookieBridge==='RULE_INSTALLED'){
     // Prove the cookie is actually on the *wire* before risking the password.
     // /cgi/getBusy is the stock non-login state endpoint; never a CGI login.
     let busyReply;
     audit.busyProbeIntent=true;
     try{busyReply=await offscreenHttp('/cgi/getBusy','POST',null,{},'COOKIE_BRIDGE_READ_ONLY_PROBE')}
     catch{receipt.cookieBridgeWire='BUSY_PROBE_FAILED';}
     const seen=audit.wire.some(x=>x.route==='BUSY'&&x.phase==='REQUEST'&&
       x.context==='NO_TAB_CONTEXT'&&x.cookiePresent===true);
     if(!receipt.cookieBridgeWire)receipt.cookieBridgeWire=seen?'COOKIE_ATTACHED':'COOKIE_NOT_OBSERVED';
     if(busyReply?.http!==200||!seen)return {
       stage:'LOGIN_NOT_SUBMITTED',submitted:false,
       diagnostic:{...receipt,reason:'COOKIE_BRIDGE_WIRE_UNCONFIRMED',noPasswordSent:true}};
     // Some C20 firmware rotates the anonymous session at getBusy. Bridge
     // only the cookie returned by this exact read-only response before LOGIN.
     const busyCookie=typeof audit.freshBusyCookie==='string'?audit.freshBusyCookie:null;
     receipt.busyCookieIssued=!!busyCookie;
     receipt.busyCookieChanged=!!busyCookie&&busyCookie!==fresh;
     if(busyCookie&&busyCookie!==fresh){
       receipt.cookieBridge=await prepareRouterCookieBridge(busyCookie);
       receipt.cookieBridgeSource='FRESH_BUSY_SET_COOKIE';
       if(receipt.cookieBridge!=='RULE_INSTALLED')return {
         stage:'LOGIN_NOT_SUBMITTED',submitted:false,
         diagnostic:{...receipt,reason:'BUSY_COOKIE_ROTATION_NOT_BRIDGED',noPasswordSent:true}};
     }
   }
   const ctx=await C20Crypto.createContext(params.nn,params.ee,params.seq,'user',password);
   // Archer's physical v0.6.9 probe exposed legacy UserName/Passwd
   // at the inline /cgi/login call site. The v0.6.8 lower-case command
   // yielded vendorRet=71234 (invalid CGI request, not a wrong password).
   // Select the legacy dialect only if THIS router's stock script supports it.
   // Do not auto-retry a rejected login using another dialect: lockout risk.
   const evidence=await offscreenCommand('loginSchema').catch(()=>null);
   const legacy=!!(evidence?.status==='INLINE_CALL_FOUND' &&
     evidence?.legacyFields===true && evidence?.lowercaseFields===false &&
     Number(evidence?.callSites)>=1);
   const plain=legacy?
     C20Protocol.loginLegacy('user',password):
     C20Protocol.loginLowercase('user',password);
   receipt.wireProfile=legacy?'CGI_SLASH_LEGACY_USERNAME_PASSWD_B64_ACT_GL5':
     'CGI_SLASH_USERNAME_PASSWORD_ACT_GL5';
   receipt.loginSchemaEvidence=legacy?'VENDOR_INLINE_LEGACY':'NOT_EXCLUSIVE_LEGACY';
   const packet=await ctx.encrypt(plain,true);
   // Never log encrypted bytes or fragments. Shape checks are non-secret.
   receipt.packetShapeOk=/^[a-f\d]+$/i.test(packet.sign)&&packet.sign.length%128===0&&
     /^[A-Za-z0-9+/]+={0,2}$/.test(packet.data)&&packet.data.length>0;
   receipt.packetSignLength=packet.sign.length;
   receipt.packetDataLength=packet.data.length;
   receipt.step='LOGIN';receipt.http=null; // params HTTP 200 is NOT a login HTTP response.
   // Frame baseline must be captured just BEFORE login (not before RSA params).
   const loginFrameBefore=await offscreenCommand('frameStatus').catch(()=>frameBefore);
   // From here any network failure may be ambiguous: NEVER auto-submit again.
   let reply;
   try{receipt.loginAttemptWindowCount=await reserveLoginPost();}
   catch(e){return {stage:'LOGIN_NOT_SUBMITTED',submitted:false,
     diagnostic:{...receipt,reason:diagnosticReason(e),noPasswordSent:true}};}
   receipt.loginSubmitIntentCount=1;
   audit.loginSubmitIntentCount=1; // allows capturing a freshly rotated server-issued JSESSIONID
   // Fence BEFORE the first password-bearing network operation. If Chrome
   // evicts this worker or the router drops TCP, an ambiguous login MUST NOT
   // permit a second POST on the next UI click.
   const contextForRecovery=ctx.serialize();
   const recoveryAt=Date.now();
   const recoveryCookie=typeof audit.freshParamsCookie==='string'&&validRouterJsessionid(audit.freshParamsCookie)?
     audit.freshParamsCookie:null;
   await chrome.storage?.session?.set({
     [LOGIN_STATE_KEY]:{at:recoveryAt,state:'LOGIN_POST_OUTCOME_UNKNOWN'},
     [LOGIN_CRYPTO_CONTEXT_KEY]:{...contextForRecovery,at:recoveryAt,routerJsessionid:recoveryCookie}});
   try{reply=await offscreenHttp('/cgi_gdpr','POST',
     'sign='+packet.sign+'\r\ndata='+packet.data+'\r\n',{'Content-Type':'text/plain'},'LOGIN');}
   catch(e){
     // Read-only metadata query: no retry of login and no second password submission.
     const frameAfter=await offscreenCommand('frameStatus').catch(()=>null);
     const nav=Number.isInteger(loginFrameBefore?.frameLoads)&&Number.isInteger(frameAfter?.frameLoads)
       ?frameAfter.frameLoads>loginFrameBefore.frameLoads:null;
     // The same error might mean that the router processed login, then reset
     // the TCP connection. A bounded protected WLAN read can confirm that.
     const recovery=await reconcileAmbiguousLogin(ctx);
     if(recovery.confirmed){
       await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
       await clearPendingLoginCrypto();
       cookieBridgeSessionConfirmed=true;
       return {stage:'CONFIGURED_AUTHENTICATED',submitted:true,
       readConfirmed:true,radio:recovery.radio,
       diagnostic:{...receipt,readConfirmed:true,reason:'LOGIN_REPLY_LOST_BUT_WLAN_READ_CONFIRMED',
         loginHttp:null,recoveryRead:'CONFIRMED',tokenPresent:recovery.tokenPresent,frameNavigation:nav}};
     }
     return {stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
       diagnostic:{...receipt,reason:'CGI_NETWORK_OR_NAVIGATION_FAILURE',
         errorType:safeReason(e),errorDetail:diagnosticReason(e),
         xhrEvent:e?.httpTrace?.event||null,
         xhrReadyState:e?.httpTrace?.readyState??null,
         xhrElapsedMs:e?.httpTrace?.elapsedMs??null,
         recoveryRead:'UNCONFIRMED',recoveryTokenPresent:recovery.tokenPresent,
         recoveryReason:recovery.reason,
         frameNavigation:nav,frameLoadsBefore:loginFrameBefore?.frameLoads??null,
         frameLoadsAfter:frameAfter?.frameLoads??null,
         webRequest:audit.requests.filter(x=>x.path==='GDPR').slice(-3)}};
   }
   receipt.http=reply.http;receipt.loginHttp=reply.http;
   // Re-read the router's own JSESSIONID in case LOGIN rotated it.
   // No second login, no manual session-ID construction.
   if(receipt.cookieBridge==='RULE_INSTALLED'){
     const postLoginCookie=typeof audit.freshLoginCookie==='string'&&validRouterJsessionid(audit.freshLoginCookie)?
       audit.freshLoginCookie:recoveryCookie;
     if(postLoginCookie)await chrome.storage?.session?.set({[LOGIN_CRYPTO_CONTEXT_KEY]:{
       ...contextForRecovery,at:recoveryAt,routerJsessionid:postLoginCookie}});
     receipt.cookieBridgeAfterLogin=await prepareRouterCookieBridge(postLoginCookie);
   }
   if(receipt.cookieBridge==='RULE_INSTALLED'&&receipt.cookieBridgeAfterLogin!=='RULE_INSTALLED')return {
     stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
     diagnostic:{...receipt,reason:'COOKIE_BRIDGE_LOST_AFTER_LOGIN',noAutoLoginRetry:true}};
   receipt.cookiesAfterLogin=await cookiePartitionEvidence();
   const observedFrame=await offscreenCommand('pageState').catch(()=>null);
   receipt.frameCookieAfterLogin=observedFrame?.diagnostic?.cookieAccess||'NOT_REPORTED';
   receipt.frameStorageAfterLogin=observedFrame?.diagnostic?.storageAccess||'NOT_REPORTED';
   if(reply.http!==200)return {stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
      diagnostic:{...receipt,reason:'LOGIN_HTTP_NON_200'}};
   let decrypted='';
   try{decrypted=await ctx.decrypt(reply.text);receipt.decrypted=true}
   catch{return {stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
      diagnostic:{...receipt,reason:'LOGIN_REPLY_NOT_DECRYPTABLE'}};}
   const verdict=C20Protocol.parseLoginResult(decrypted);
   // The values are signed vendor status integers, not arbitrary CGI text.
   // Preserve both: [error]0 can otherwise obscure a nonzero $.ret.
   receipt.vendorRetCode=verdict.retCode;
   receipt.vendorErrorCode=verdict.errorCode;
   receipt.vendorReplyShape=verdict.shape;
   receipt.vendorReplyStatus=verdict.status;
   // Never print the decrypted CGI response. Some firmware embeds a session
   // marker here; only its presence is useful until the stock wire contract
   // demonstrates that it is required on subsequent requests.
   const loginHints=C20Protocol.loginSessionHints(decrypted);
   receipt.loginTokenFieldPresent=loginHints.tokenFieldPresent;
   receipt.loginCookieFieldPresent=loginHints.cookieFieldPresent;
   receipt.tokenHeaderSent=false;
   receipt.tokenHeaderContract='STOCK_TPAJAX_HEADER_DISABLED';
   if(verdict.rejected){
     // Explicit rejection is NOT an ambiguous submission. Permit a future
     // user-clicked correction, subject to the three-in-ten-minute rate limit.
     await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
     await clearPendingLoginCrypto();
     return {stage:'LOGIN_SUBMITTED_UNVERIFIED',submitted:true,
       diagnostic:{...receipt,reason:'VENDOR_LOGIN_REJECTED',code:verdict.code}};
   }
   // An accepted reply only proves CGI status; it does not prove an active
   // stock session. Persist a no-relogin fence BEFORE any post-login traffic.
   // An SW eviction between ACK and protected read must not allow a new POST.
   if(chrome.storage?.session)await chrome.storage.session.set({
     [LOGIN_STATE_KEY]:{at:Date.now(),state:'ACK_ZERO_POSTLOGIN_CHECK'}});
   // Stock wizard takes precedence even if a partial WLAN list is readable.
   // Only visible, exact wizard markers count; menu text alone is insufficient.
   const wizardBefore=await offscreenCommand('quickStage').catch(()=>null);
   if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(wizardBefore?.stage)){
     await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
     await clearPendingLoginCrypto();
     cookieBridgeSessionConfirmed=true;
     return {stage:'QUICK_SETUP_ACTIVE',submitted:true,
       diagnostic:{...receipt,reason:'LOGIN_ZERO_ACK_WIZARD_VISIBLE',postLoginStage:'QUICK_SETUP_ACTIVE',wizardStep:wizardBefore.stage}};
   }
   // The real stock login navigates to its initialized interface after
   // processing the zero ACK. Our background encrypted XHR cannot navigate
   // the frame by itself, leaving its DOM on LOGIN_FORM. Reproduce exactly
   // ONE read-only page transition, never another credential submission.
   // An already authenticated or unknown DOM is not force-reloaded.
   const beforeTransition=await offscreenCommand('pageState').catch(()=>null);
   receipt.frameStageBefore=beforeTransition?.stage||'UNKNOWN';
   if(beforeTransition?.stage==='LOGIN_FORM'){
     const transition=await offscreenCommand('refresh').catch(()=>null);
     receipt.postLoginFrameTransition=transition?.refreshed===true?'RELOADED':'NOT_CONFIRMED';
     if(transition?.refreshed===true){
       const afterTransition=await offscreenCommand('pageState').catch(()=>null);
       receipt.frameStageAfter=afterTransition?.stage||'UNKNOWN';
       const confirmedWizard=await offscreenCommand('quickStage').catch(()=>null);
       if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(confirmedWizard?.stage)){
         await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
         await clearPendingLoginCrypto();
         cookieBridgeSessionConfirmed=true;
     return {stage:'QUICK_SETUP_ACTIVE',submitted:true,
           diagnostic:{...receipt,reason:'LOGIN_ZERO_ACK_FRAME_NAVIGATED_TO_WIZARD',
             wizardStep:confirmedWizard.stage}};
       }
       if(afterTransition?.stage==='POSSIBLY_AUTHENTICATED'){
         // One stock ACT_GL protected read in the freshly initialized page.
         // No redundant RouterLab AES read afterwards. This also provides
         // the native vendor-write context once the read succeeds.
         receipt.step='STOCK_POSTLOGIN_READ';
         const native=await offscreenDiscover().catch(()=>null);
         receipt.nativeReadStatus=native?.stage||'UNAVAILABLE';
         if(native?.stage==='CONFIGURED_AUTHENTICATED'&&native.readConfirmed===true&&native.radio){
           transport='offscreen';
           clearSession();
           await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
           await clearPendingLoginCrypto();
           cookieBridgeSessionConfirmed=true;
       return {stage:'CONFIGURED_AUTHENTICATED',submitted:true,readConfirmed:true,
             radio:native.radio,diagnostic:{...receipt,readConfirmed:true,
               reason:'STOCK_POSTLOGIN_PROTECTED_WLAN_READ_CONFIRMED'}};
         }
         // A native read was already attempted. Do not send another CGI
         // packet merely because we lack proof of authentication. Retain
         // the unverified AES context behind the no-login-resend fence for
         // ONE explicit later state refresh; this is NOT a valid session.
         session.crypto=ctx;session.token=null;session.identity=null;session.radio=null;
         transport='offscreen-rpc';
         return {stage:'LOGIN_STATE_UNRESOLVED',submitted:true,
           diagnostic:{...receipt,reason:'STOCK_POSTLOGIN_READ_UNCONFIRMED',
             noAutoReadRetry:true,noAutoLoginRetry:true}};
       }
     }
   }
   // Only ONE protected CGI read after a zero-ACK login. If the stock frame
   // remains at LOGIN_FORM, probe using the original AES context (without the
   // non-stock TokenID header); never auto-resubmit credentials.
   receipt.step='PROTECTED_READ';
   transport='offscreen-rpc';
   session.crypto=ctx;session.token=null;session.identity=null;session.radio=null;
   await primeRouterOriginToken();
   try{
     const raw=await gdprRead(C20Protocol.wifiRead());
     const wlan=C20Protocol.parseWifi(raw);
     if(!wlan.dynamicStacksVerified)throw Error('C20_WLAN_BAND_STACK_MAPPING_NOT_PROVEN');
     session.radio=wlan;session.lastRead=Date.now();
     await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
     await clearPendingLoginCrypto();
     cookieBridgeSessionConfirmed=true;
     return {stage:'CONFIGURED_AUTHENTICATED',readConfirmed:true,radio:{
       ssid24:wlan.radio24.ssid,ssid5:wlan.radio5.ssid,
       stack24:wlan.radio24.stack,stack5:wlan.radio5.stack},
       submitted:true,diagnostic:{...receipt,readConfirmed:true,reason:'SINGLE_PROTECTED_WLAN_READ_CONFIRMED'}};
   }catch(e){
     receipt.readError=diagnosticReason(e);
     receipt.xhrEvent=e?.httpTrace?.event||null;
     receipt.xhrReadyState=e?.httpTrace?.readyState??null;
     receipt.xhrElapsedMs=e?.httpTrace?.elapsedMs??null;
     receipt.webRequest=audit.requests.filter(x=>x.path==='GDPR').slice(-3);
   }
   receipt.cookiesAfterRead=await cookiePartitionEvidence();
   // IMPORTANT: only DOM state checks are permitted here. A stock $.act/$.exe
   // inspect on an uninitialized iframe can generate additional encrypted CGI
   // traffic. Do NOT reload/retry login, or attempt more protected reads.
   const wizardAfter=await offscreenCommand('quickStage').catch(()=>null);
   receipt.postLoginStage=wizardAfter?.stage||'UNKNOWN';
   if(['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(wizardAfter?.stage)){
     await chrome.storage?.session?.remove(LOGIN_STATE_KEY);
     await clearPendingLoginCrypto();
     lastProbeStage='QUICK_SETUP_ACTIVE';
     cookieBridgeSessionConfirmed=true;
     return {stage:'QUICK_SETUP_ACTIVE',submitted:true,
       diagnostic:{...receipt,reason:'LOGIN_ZERO_ACK_WIZARD_VISIBLE',wizardStep:wizardAfter.stage}};
   }
   const passive=await offscreenCommand('pageState').catch(()=>null);
   receipt.passiveStage=passive?.stage||'UNKNOWN';
   return {stage:'LOGIN_STATE_UNRESOLVED',submitted:true,
     diagnostic:{...receipt,reason:'LOGIN_ZERO_ACK_SINGLE_READ_UNCONFIRMED',
       noAutoReadRetry:true,noAutoLoginRetry:true}};
 }catch(e){return{stage:receipt.loginSubmitIntentCount>0?'LOGIN_SUBMITTED_UNVERIFIED':'LOGIN_NOT_SUBMITTED',
   submitted:receipt.loginSubmitIntentCount>0,
   diagnostic:{...receipt,reason:'PREPARE_OR_TRANSPORT_ERROR',errorType:safeReason(e),errorDetail:diagnosticReason(e)}};}
 finally{
   if(!cookieBridgeSessionConfirmed)await stopRouterCookieBridge();
   if(activeLoginAudit===audit)activeLoginAudit=null;
 }
}
async function headerOriginAudit(){
 const attempts=[];let result=null;
 if(!chrome.declarativeNetRequest?.updateSessionRules||!chrome.runtime?.id){
   return {params:null,selectedMode:null,statuses:[{variant:'DNR_NOT_AVAILABLE',http:0}]};
 }
 // Explicitly clean stale rules left after abnormal service-worker termination.
 await clearHeaderDiagnosticRule();
 for(const mode of ['REMOVE_ORIGIN','ROUTER_ORIGIN']){
   try{
     const r=await withHeaderDiagnostic(mode,'/cgi/getGDPRParm',
       ()=>httpDirect('/cgi/getGDPRParm','POST',null,{}));
     let params=null;
     if(r.http===200)try{params=C20Crypto.getParams(r.text)}catch{}
     attempts.push({variant:mode,http:r.http,valid:!!params});
     if(params){result={params,response:r,selectedMode:mode};break;}
   }catch(e){attempts.push({variant:mode,http:0,valid:false,error:diagnosticReason(e)})}
 }
 return {params:result?.params||null,response:result?.response||null,
   selectedMode:result?.selectedMode||null,statuses:attempts};
}
// When a read-only probe proves one Origin/Referer mode, reuse the SAME
// temporary scoped rule for subsequent login/authenticated CGI POSTs. The
// AES/RSA login and actual router access must still be verified separately.
async function directWithPreferredHeaders(path,method='GET',body=null,headers={}){
 if(preferredGdprHeaderMode&&method==='POST'&&
      ['/cgi/getGDPRParm','/cgi_gdpr'].includes(path)){
   return withHeaderDiagnostic(preferredGdprHeaderMode,path,
     ()=>httpDirect(path,method,body,headers));
 }
 return httpDirect(path,method,body,headers);
}
async function httpTab(path,method='GET',body=null,headers={}){
 routeAllowed(path);
 const id=await ensureTab();
 const run=chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:async(arg)=>{
   const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
   try{const r=await fetch(arg.path,{method:arg.method,headers:arg.headers,body:arg.body,redirect:'follow',credentials:'same-origin',cache:'no-store',signal:c.signal});
    return {http:r.status,url:new URL(r.url).pathname,text:(await r.text()).slice(0,280000)}}
   catch(e){return{http:0,url:'',text:'',error:e.name||'fetch_error',pageOrigin:location.origin}}finally{clearTimeout(timer)}
 },args:[{path,method,body,headers}]});
 let timer;
 const out=await Promise.race([run,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C20_TAB_TIMEOUT')),16000);})]).finally(()=>clearTimeout(timer));
 const r=out?.[0]?.result;if(!r)throw Error('C20_TAB_NO_RESPONSE');
 if(r.error)throw Error('TAB_'+r.error+(r.pageOrigin===URL.slice(0,-1)?'':'_ORIGIN_MISMATCH'));
 return r;
}
async function http(path,method='GET',body=null,headers={},operation='OTHER'){
 if(transport==='unselected')throw Error('C20_RUN_PROBE_FIRST');
 return transport==='offscreen-rpc'?offscreenHttp(path,method,body,headers,operation):
   transport==='direct'?directWithPreferredHeaders(path,method,body,headers):httpTab(path,method,body,headers);
}
function tokenFromHtml(t){
 const s=String(t||'');return s.match(/\b(?:var|let|const)\s+token\s*=\s*["']([a-z0-9]+)["']/i)?.[1]
  ||s.match(/["']?TokenID["']?\s*:\s*["']([a-z0-9]+)["']/i)?.[1]||null;
}
// Read the already-opened vendor screen. This never creates or activates a tab,
// makes no HTTP request and returns no secret or DOM contents.
async function inspectNative(){
 const existing=await chrome.tabs.query({url:'http://192.168.0.1/*'});
 const candidate=existing.find(x=>typeof x.id==='number');
 if(!candidate)return {tabExists:false,stage:'NO_ROUTER_TAB',next:'USE_DIRECT_TRANSPORT_FIRST'};
 const run=await chrome.scripting.executeScript({target:{tabId:candidate.id},world:'MAIN',func:()=>{
   if(location.origin!=='http://192.168.0.1')return {stage:'ORIGIN_MISMATCH'};
   const text=(document.body?.innerText||'').slice(0,22000);
   const title=document.title||'';
   const isC20=/archer\s*c20/i.test(title+' '+text);
   if(!isC20)return {stage:'IDENTITY_UNCONFIRMED'};
   const shown=selector=>[...document.querySelectorAll(selector)].filter(x=>!x.disabled&&x.getClientRects().length);
   const pwCount=shown('input[type="password"]').length;
   const factory=pwCount>=2 && /приступим\s+к\s+работе|let.?s\s+get\s+started/i.test(text);
   // The Quick Setup *wireless* screen contains password fields too; do not
   // mistake one Wi-Fi password for an administrator login field.
   const wizardContext=/(быстрая\s+настройка|quick\s+setup)/i.test(text);
   const wizardDetail=/(выберите\s+поставщика|поставщик\s+интернет|настройки\s+беспроводного\s+режима|wireless\s+settings|тип\s+(?:подключения\s+wan|интернет.подключения)|тип\s+соединения|страна\s*[:：]|internet\s+service\s+provider)/i.test(text);
   // Quick Setup appears in the navigation even on a configured dashboard.
   // Only an active, visible wizard screen may trigger the factory wizard route.
   const activeWizardContainers=shown('#quicksetup_isp_container,#quicksetup_dsl_container,#quicksetup-process-content');
   const visibleWizardFields=shown('#wl24gSSID,#wl5gSSID,#wl24gssid,#wl5gssid,#next_button,#save');
   const explicitWizardText=/(выберите\s+поставщика|город\s*\/\s*регион|настройки\s+беспроводного\s+режима|\bVLAN ID\b|\bобзор\b|\bWAN\b.*Страна)/i.test(text);
   const wizard=wizardContext && (activeWizardContainers.length>0||visibleWizardFields.length>0||explicitWizardText);

   const loginActions=shown('button,input[type="submit"],a[role="button"]').filter(x=>/^(?:войти|вход|log\s*in|sign\s*in|login)$/i.test((x.innerText||x.value||'').trim()));
   const loginForm=pwCount===1&&!wizard&&(loginActions.length===1||/(?:вход|\blog\s*in\b|\blogin\b)/i.test(text));
   const hasStockIo=typeof window.$?.io==='function';
   const tokenPresent=!!(window.TokenID||window.token||window.tokenID);
   const firmware200821=/v6038\.0/i.test(text)&&/200821/.test(text);
   const hardwareV5=/archer\s*c20\s*v5/i.test(text);
   const stage=factory?'FACTORY_PASSWORD':wizard?'QUICK_SETUP_ACTIVE':loginForm?'LOGIN_FORM':
      hasStockIo?'CONFIGURED_AUTHENTICATED':'UNCLASSIFIED';
   return {stage,isC20,passwordFields:pwCount,stockIoReady:hasStockIo,tokenPresent,firmware200821,hardwareV5};
 }});
 const info=run?.[0]?.result;
 if(!info)throw Error('C20_NATIVE_INSPECT_EMPTY');
 tabId=candidate.id;tabOwned=false;
 return {tabExists:true,...info};
}
// Existing vendor UI is the primary state authority. Reading the current page
// never creates a tab or discards an authenticated browser session.
function nativeStage(native){
 return {FACTORY_PASSWORD:'FACTORY_CANDIDATE',LOGIN_FORM:'LOGIN_REQUIRED',
  QUICK_SETUP_ACTIVE:'QUICK_SETUP_ACTIVE',CONFIGURED_AUTHENTICATED:'CONFIGURED_AUTHENTICATED'}[native?.stage]||null;
}
async function probe(forceTab=false){
 const existing=await inspectNative().catch(()=>null);
 const state=existing?.isC20&&existing?.tabExists?nativeStage(existing):null;
 if(state){
   lastProbeStage=state;
   // A valid existing TP-Link session must not be invalidated by an RSA login probe.
   if(state==='QUICK_SETUP_ACTIVE'||state==='CONFIGURED_AUTHENTICATED')transport='native';
   else if(transport==='unselected'||transport==='native')transport='direct';
   const ready=Boolean(existing.stockIoReady);
   return {stage:state,protocolReady:ready,modelHint:true,versionHint:null,
     rootHttp:null,paramsHttp:null,native:existing,transport:'EXISTING_ROUTER_TAB',
     login:state==='FACTORY_CANDIDATE'?'FIRST_PASSWORD_REQUIRED':state==='LOGIN_REQUIRED'?'REQUIRED':'ALREADY_AUTHENTICATED',
     canWrite:false,diagnostics:'NATIVE_STATE_FIRST_NO_RELOGIN_NO_HTTP'};
 }
 // No usable vendor page: only then perform the minimal direct HTTP fingerprint.
 // Repeated checks must not clear an existing verified cryptographic session.
 if(!session.token){transport='unselected';}

 const problems=[];
 // Never silently create router tabs when testing Service Worker.
 for(const mode of (forceTab?['tab']:['direct'])){
   const send=mode==='direct'?directWithPreferredHeaders:httpTab;
   try{
     const root=await send('/');if(root.http!==200)throw Error('ROOT_HTTP_'+root.http);
     const keyProbe=await cryptoParamsBy(send);
     const parm=keyProbe.response||{http:keyProbe.statuses[0]?.http||0,text:''};
     const view=RouterLabC20.assess({root:{status:root.http,body:root.text},params:{status:parm.http,body:parm.text}});
     const p=keyProbe.params;
     // A factory phrase in downloaded scripts is not evidence of an active
     // factory form: prefer the visible stock page if the tab already exists.
     let stage=view.state, native=null;
     try{native=await inspectNative();}catch{}
     if(native?.stage==='QUICK_SETUP_ACTIVE')stage='QUICK_SETUP_ACTIVE';
     else if(native?.stage==='LOGIN_FORM')stage='LOGIN_REQUIRED';
     else if(native?.stage==='FACTORY_PASSWORD')stage='FACTORY_CANDIDATE';
     else if(postFactory)stage='FIRST_PASSWORD_CREATED';
     // After first-admin setup, the TP-Link page can have a valid native
     // wizard session while getGDPRParm is HTTP 500. Permit STATE detection
     // without asserting that RouterLab's encrypted API transport is ready.
     if(!p&&!['FACTORY_CANDIDATE','QUICK_SETUP_ACTIVE','FIRST_PASSWORD_CREATED'].includes(stage))throw Error('MISSING_GDPR_PARAMETERS');
     transport=mode;lastProbeStage=stage;
     return {stage,protocolReady:!!p,modelHint:view.model,versionHint:view.firmware,rootHttp:root.http,paramsHttp:parm.http,native,
       transport:mode==='direct'?'SERVICE_WORKER_DIRECT':'INACTIVE_TAB_SAME_ORIGIN',login:stage==='FACTORY_CANDIDATE'?'FIRST_PASSWORD_REQUIRED':stage==='QUICK_SETUP_ACTIVE'?'VENDOR_SESSION_POSSIBLE':'REQUIRED',canWrite:false,
       diagnostics:problems.join(' | ')||'DIRECT_OK',paramsVariant:keyProbe.selectedVariant,paramsAttempts:keyProbe.statuses};
   }catch(e){problems.push(mode.toUpperCase()+'='+safeReason(e)+'_'+String(e.message||'').slice(0,65).replace(/[^a-z0-9_=-]/ig,''));}
 }
 throw Error('C20_TRANSPORTS_FAILED '+problems.join(' | '));
}
async function directAudit(){
 const root=await httpDirect('/');
 // A prior successful profile can be re-tested without repeating four bad POSTs.
 const keyProbe=preferredGdprHeaderMode
   ?await cryptoParamsBy(directWithPreferredHeaders):await cryptoParamsBy(httpDirect);
 const primary=keyProbe.statuses[0]||{};
 const fallback=keyProbe.statuses.find(x=>x.variant==='ALT_GETPARM_POST');
 const headerProbe=!keyProbe.params &&
   keyProbe.statuses.some(x=>x.http===500)
   ?await headerOriginAudit():null;
 if(headerProbe?.params)preferredGdprHeaderMode=headerProbe.selectedMode;
 const params=keyProbe.params||headerProbe?.params||null;
 const raw=keyProbe.response||headerProbe?.response||{http:primary.http||0,text:''};
 const cookies=await sessionCookieSummary();
 // Run once per worker lifecycle after CGI transports fail; always read-only.
 // Repeated Discover presses return the previous negative frame capability.
 if(!params&&!cachedOffscreenProbe)cachedOffscreenProbe=await probeOffscreenVendorFrame();
 const candidate=RouterLabC20.assess({root:{status:root.http,body:root.text},params:{status:raw.http,body:raw.text}});
 // Do not label a factory state based on hidden source/script phrases. Factory
 // is confirmed only by a real visible two-password stock form.
 const view=await inspectNative().catch(()=>null);
 const nativeStageValue=view?.isC20?nativeStage(view):null;
 return {transport:'SERVICE_WORKER_DIRECT',createdRouterTab:false,
   rootHttp:root.http,paramsHttp:primary.http,fallbackHttp:fallback?.http??null,gdprParamsValid:!!params,
   paramsVariant:keyProbe.selectedVariant||(headerProbe?.params?'DNR_'+headerProbe.selectedMode:null),paramsAttempts:keyProbe.statuses,
   headerAttempts:headerProbe?.statuses||[],headerSelectedMode:headerProbe?.params?headerProbe.selectedMode:null,
   cookieDiagnostic:cookies,
   offscreenDiagnostic:params?null:cachedOffscreenProbe,
   nativeStage:nativeStageValue||null,
   nativeApiPresent:!!view?.stockIoReady,
   sessionTokenPresent:!!session.token,
   versionHint:candidate.firmware,
   modelHint:candidate.model,
   next:nativeStageValue==='QUICK_SETUP_ACTIVE'?'READ_NATIVE_API':params?'DIRECT_LOGIN_OR_READ':'EXPLICIT_FALLBACK_OR_DIAGNOSE',
   reason:params?'GDPR_PARAMS_PARSE_OK_'+(keyProbe.selectedVariant||(headerProbe?.selectedMode?'DNR_'+headerProbe.selectedMode:'UNKNOWN')):primary.http!==200?'GDPR_HTTP_'+primary.http+(fallback?.http!==undefined?'_FALLBACK_'+fallback.http:''):'GDPR_PARAMS_NOT_CONFIRMED'};
}
async function login(user,password){
 // Password-only vendor UI. The captured C20-v5 GDPR payload uses internal user='user'.
 user='user';
 if(!password||password.length>80)throw Error('INVALID_PASSWORD_INPUT');
 if(transport==='unselected')await probe();
 if(lastProbeStage==='FACTORY_CANDIDATE')throw Error('C20_FIRST_ADMIN_PASSWORD_REQUIRED');
 if(lastProbeStage==='QUICK_SETUP_ACTIVE'||lastProbeStage==='CONFIGURED_AUTHENTICATED'||lastProbeStage==='FIRST_PASSWORD_CREATED')throw Error('C20_ALREADY_AUTHENTICATED_NO_LOGIN_NEEDED');
 if(transport==='native')transport='direct';
 clearSession();const homepage=await http('/');
 const keyProbe=await cryptoParamsBy(http);
 if(!keyProbe.params)throw Error('C20_GDPR_PARAMETERS_NOT_AVAILABLE_'+keyProbe.statuses.map(x=>x.variant+':'+x.http).join('_'));
 const param=keyProbe.params;
 const context=await C20Crypto.createContext(param.nn,param.ee,param.seq,user,password);
 // C20 v5 stock HAR: ACT_CGI /cgi/login is encrypted inside /cgi_gdpr.
 // Do not POST directly to /cgi/login: the older dialect does not establish JSESSIONID.
 if(/[\r\n\0]/.test(user)||/[\r\n\0]/.test(password))throw Error('C20_LOGIN_FIELDS_INVALID');
 const plain='8\r\n[/cgi/login#0,0,0,0,0,0#0,0,0,0,0,0]0,2\r\n'+
   'username='+user+'\r\npassword='+password+'\r\n';
 const packet=await context.encrypt(plain,true);
 const r=await http('/cgi_gdpr','POST',
   'sign='+packet.sign+'\r\ndata='+packet.data+'\r\n',{'Content-Type':'text/plain'});
 if(r.http!==200)throw Error('C20_LOGIN_HTTP_'+r.http);
 let msg=r.text;
 try{msg=await context.decrypt(r.text)}catch{}
 const ret=msg.match(/\$\.ret\s*=\s*(-?\d+)/);const error=C20Protocol.parseErrors(msg);
 if((ret&&Number(ret[1])!==0)||(error!==null&&error!==0))throw Error('C20_LOGIN_DENIED_'+(error??ret?.[1]));
 // Critical: even ret=0 is not enough. Require TokenID from authenticated page.
 let token=null;for(let i=0;i<3;i++){
  const p=await http('/');token=tokenFromHtml(p.text);if(token)break;
  await new Promise(r=>setTimeout(r,200));
 }
 if(!token)throw Error(transport==='direct'?'C20_LOGIN_TOKEN_NOT_FOUND_DIRECT_TRY_TAB':'C20_LOGIN_TOKEN_NOT_FOUND_TAB');
 session.crypto=context;session.token=token;session.identity=null;session.lastRead=0;
 return{authenticated:true,protocol:'RSA512+AES-CBC',cookie:'session (values hidden)',tokenFound:true,transport};
}

async function offscreenFactoryCreate(req){
 if(lastProbeStage!=='FACTORY_CANDIDATE')throw Error('C20_NOT_CONFIRMED_FACTORY');
 if(req?.confirm!==true||req?.password!==req?.passwordConfirm)throw Error('C20_FACTORY_CONFIRM_MISMATCH');
 const r=await offscreenCommand('factoryCreate',{password:req.password});
 if(!r?.submitted)throw Error('C20_FACTORY_'+(r?.status||'PRECHECK_FAILED'));
 // The first password may navigate the iframe before a protected session is available.
 // Only receipt of the stock click, never proof of password creation.
 return{submitted:true,verified:false,method:'OFFSCREEN_STOCK_UI_CLICK',routerTabUsed:false};
}
async function offscreenAutoQuick(request={}){
 const started=Date.now(),steps=[],budgetMs=22000;
 const wifi=C20Flow.cleanWifi(request.wifi||{});
 const area=chrome.storage?.session;
 if(!area)throw Error('C20_QUICK_SESSION_FENCE_UNAVAILABLE');
 for(let i=0;i<7;i++){
   if(Date.now()-started>budgetMs)return{outcome:'AUTO_QUICK_PENDING',stage:'TIME_BUDGET_EXCEEDED',steps,elapsedMs:Date.now()-started};
   let before;
   try{before=await offscreenCommand('quickStage');}
   catch{return{outcome:'AUTO_QUICK_PENDING',stage:'UNKNOWN',reason:'OFFSCREEN_STAGE_UNAVAILABLE',steps,elapsedMs:Date.now()-started};}
   if(before.stage==='CONFIGURED_AUTHENTICATED')
     return{outcome:'AUTO_QUICK_PENDING',stage:'VERIFY_WAN_WIFI',reason:'POST_SETUP_PROTECTED_READ_REQUIRED',steps,elapsedMs:Date.now()-started};
   if(['LOGIN_FORM','FACTORY_PASSWORD','UNKNOWN','MODEL_NOT_CONFIRMED'].includes(before.stage))
     return{outcome:'AUTO_QUICK_PENDING',stage:before.stage,
       reason:'WAIT_FOR_STOCK_FACTORY_WIZARD_NO_LOGIN_OR_RETRY',steps,elapsedMs:Date.now()-started};
   if(!['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(before.stage))
     return{outcome:'AUTO_QUICK_BLOCKED',stage:before.stage,reason:'STOCK_STAGE_UNVERIFIED',steps,elapsedMs:Date.now()-started};
   const previous=(await area.get(QUICK_PENDING_KEY))[QUICK_PENDING_KEY];
   if(previous?.stage==='SUMMARY')return{outcome:'AUTO_QUICK_RECONNECT_REQUIRED',stage:'SUMMARY',steps,reason:'SAVE_SENT_AWAIT_RECONNECT',elapsedMs:Date.now()-started};
   if(previous){
     if(previous.stage===before.stage)return{outcome:'AUTO_QUICK_PENDING',stage:before.stage,reason:'PREVIOUS_STEP_MAY_HAVE_BEEN_SENT_NO_RETRY',steps,elapsedMs:Date.now()-started};
     await area.remove(QUICK_PENDING_KEY); // confirmed stage advanced
   }
   await area.set({[QUICK_PENDING_KEY]:{stage:before.stage,signature:before.signature,at:Date.now()}});
   let r;
   try{r=await offscreenCommand('quickStep',{ssid24:wifi.ssid24,ssid5:wifi.ssid5,password:wifi.password});}
   catch{return{outcome:'AUTO_QUICK_PENDING',stage:before.stage,reason:'STEP_RESULT_AMBIGUOUS_NO_RETRY',steps,elapsedMs:Date.now()-started};}
   if(!r?.submitted){await area.remove(QUICK_PENDING_KEY);
     return{outcome:'AUTO_QUICK_BLOCKED',stage:r?.step||before.stage,reason:r?.reason||'STOCK_PRECHECK_FAILED',steps,elapsedMs:Date.now()-started};}
   steps.push(r.step);
   if(r.step==='SUMMARY')return{outcome:'AUTO_QUICK_RECONNECT_REQUIRED',stage:'SUMMARY',steps,reason:'SAVE_SENT_RECONNECT_THEN_VERIFY',elapsedMs:Date.now()-started};
   let changed=false,last=null;
   for(let j=0;j<24&&Date.now()-started<budgetMs;j++){
     await new Promise(resolve=>setTimeout(resolve,320));
     try{last=await offscreenCommand('quickStage')}
     catch{continue}
     if(last.stage==='LOGIN_FORM'||last.stage==='CONFIGURED_AUTHENTICATED')
       return{outcome:'AUTO_QUICK_PENDING',stage:last.stage,reason:'POST_STEP_REAUTH_OR_PROTECTED_READ_REQUIRED',steps,elapsedMs:Date.now()-started};
     if(last.stage!==before.stage&&['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(last.stage)){
       changed=true;await area.remove(QUICK_PENDING_KEY);break;
     }
   }
   if(!changed)return{outcome:'AUTO_QUICK_PENDING',stage:r.step,
     reason:'STEP_TRANSITION_NOT_CONFIRMED_NO_RETRY',observedStage:last?.stage||'UNKNOWN',observedMarkers:last?.markers||null,
     steps,elapsedMs:Date.now()-started};
 }
 return{outcome:'AUTO_QUICK_PENDING',stage:'STEP_LIMIT',steps,elapsedMs:Date.now()-started};
}

// Factory password creation delegates to the exact stock UI JS, not a guessed encrypted RPC.
// It may require a real router tab; this is an explicit, opt-in fallback.
async function factoryCreate(req){
 if(lastProbeStage!=='FACTORY_CANDIDATE')throw Error('C20_NOT_CONFIRMED_FACTORY');
 if(req?.confirm!==true)throw Error('C20_FACTORY_CONFIRM_REQUIRED');
 const password=req?.password,again=req?.passwordConfirm;
 if(typeof password!=='string'||password.length<8||password.length>63||/[\r\n\0]/.test(password))throw Error('C20_INVALID_NEW_ADMIN_PASSWORD');
 if(password!==again)throw Error('C20_ADMIN_PASSWORD_CONFIRM_MISMATCH');
 const id=await ensureTab();
 const run=await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:(pw)=>{
  try{
   if(location.origin!=='http://192.168.0.1')return{stage:'ORIGIN_MISMATCH'};
   const title=(document.title||'').toLowerCase(),body=(document.body?.innerText||'').slice(0,16000).toLowerCase();
   if(!/archer\s*c20|tp.link|tp-link/i.test(title+' '+body))return{stage:'NOT_TPLINK_C20_PAGE'};
   const inputs=[...document.querySelectorAll('input[type="password"]')].filter(x=>!x.disabled&&x.getClientRects().length);
   if(inputs.length!==2)return{stage:'FACTORY_PASSWORD_FIELDS_NOT_EXACT',count:inputs.length};
   const candidates=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')].filter(x=>x.getClientRects().length);
   const start=candidates.filter(x=>/приступим\s+к\s+работе|let.?s\s+get\s+started|get\s+started/i.test((x.innerText||x.value||'').trim()));
   if(start.length!==1)return{stage:'FACTORY_START_BUTTON_NOT_EXACT',count:start.length};
   // Confirm both password fields have no prior values; never overwrite an active user entry.
   if(inputs.some(x=>x.value))return{stage:'EXISTING_FORM_DATA_BLOCKED'};
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
   if(!setter)return{stage:'NO_INPUT_SETTER'};
   for(const el of inputs){setter.call(el,pw);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));}
   if(start[0].disabled)return{stage:'VENDOR_BUTTON_DISABLED'};
   start[0].click();return{stage:'VENDOR_CLICK_SUBMITTED'};
  }catch(e){return{stage:'STOCK_UI_ERROR',code:String(e.name||'Error')}}
 },args:[password]});
 const result=run?.[0]?.result||{stage:'FACTORY_SCRIPT_EMPTY'};
 if(result.stage!=='VENDOR_CLICK_SUBMITTED')throw Error('C20_FACTORY_'+result.stage);
 // The stock wizard can redirect before the token exists: the click itself is never proof of write.
 let token=false;for(let i=0;i<4;i++){
   await new Promise(r=>setTimeout(r,600));
   try{const root=await httpTab('/');token=!!tokenFromHtml(root.text);if(token)break;}catch{}
 }
 // Browser tab may now be inside Quick Setup. Do NOT clear its native session
 // or run another GDPR-param probe (observed HTTP 500 on physical C20).
 // Our own RSA/AES context has not been established; never claim API login.
 lastProbeStage=token?'FIRST_PASSWORD_CREATED':'FIRST_PASSWORD_SUBMITTED';
 postFactory=true;transport='tab';
 return {submitted:true,verified:token,method:'STOCK_UI_VENDOR_CLICK',
  routerTabUsed:true,next:token?'INSPECT_NATIVE_QUICK_SETUP':'VERIFY_FACTORY_SCREEN_AFTER_CLICK'};
}

// Continue from a TP-Link-owned authenticated session without forcing another
// /cgi/login, /cgi/getGDPRParm or session teardown. Intentionally read-only
// until the wizard-specific native action contract is confirmed on hardware.
async function nativeContinue(){
 const n=await inspectNative();
 if(n.stage!=='QUICK_SETUP_ACTIVE'&&n.stage!=='CONFIGURED_AUTHENTICATED')
   throw Error('C20_NATIVE_SESSION_NOT_READY_'+n.stage);
 if(!n.stockIoReady)throw Error('C20_STOCK_API_NOT_READY');
 lastProbeStage=n.stage;transport='native';
 return {authenticated:false,uiSessionLikely:true,apiVerified:false,stage:n.stage,stockIoReady:true,routerTabUsed:true,
   firstPasswordRequired:false,anotherLoginRequired:false,
   canApply:false,next:'AUTHENTICATED_READ_PROBE_REQUIRED',
   note:'Existing Quick Setup UI detected. API authorization has NOT been verified; no login or writes attempted.'};
}
// Native vendor API probe: use TP-Link's OWN $.act/$.exe in the existing
// authenticated page. We do not reproduce guessed stacks, plaintext passwords
// or cookies; vendor library performs all transport and decryption.
async function nativeRead(){
 const n=await inspectNative();
 if(n.stage!=='QUICK_SETUP_ACTIVE'&&n.stage!=='CONFIGURED_AUTHENTICATED')
   throw Error('C20_NATIVE_READ_REQUIRES_AUTHENTICATED_SCREEN_'+n.stage);
 if(!n.stockIoReady)throw Error('C20_NATIVE_STOCK_API_NOT_READY');
 const output=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
   if(location.origin!=='http://192.168.0.1')return {ok:false,reason:'ORIGIN_MISMATCH'};
   const $=window.$;
   if(!$||typeof $.act!=='function'||typeof $.exe!=='function')return {ok:false,reason:'NO_VENDOR_ACT_EXE'};
   // Stock physical trace: a grouped response contained
   // `1&5&1&1` and `[LAN_WLAN#0,0,0,0,0,0#0,0,0,0,0,0]1,14`.
   // Type 1 (ACT_GL) is a LIST request; do not assume indexed stacks
   // 1,1,0... and 1,2,0... as the previous guessed protocol.js did.
   const listType=typeof window.ACT_GL==='number'?window.ACT_GL:1;
   const attrs=['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled'];
   try{
     if($.as?.length || $.ds?.length)return {ok:false,reason:'VENDOR_QUEUE_BUSY'};
     const rows=$.act(listType,'LAN_WLAN','0,0,0,0,0,0','0,0,0,0,0,0',attrs);
     if(!Array.isArray(rows))return {ok:false,reason:'VENDOR_LIST_NOT_QUEUED',returnType:typeof rows};
     const ret=$.exe();
     const code=typeof ret==='number'?ret:null;
     if(code!==0)return {ok:false,reason:'VENDOR_LIST_ERROR',code};
     const safe=rows.map(x=>({ssid:typeof x?.SSID==='string'?x.SSID:null,
       band:typeof x?.X_TP_Band==='string'?x.X_TP_Band:null,
       stack:typeof x?.__stack==='string'?x.__stack:null,
       enabled:x?.Enable===undefined?null:String(x.Enable)}))
       .filter(x=>x.ssid!==null);
     if(!safe.length)return {ok:false,reason:'VENDOR_LIST_EMPTY',count:rows.length};
     const bands=[...new Set(safe.map(x=>x.band).filter(Boolean))];
     const pick=(re)=>safe.filter(x=>re.test(x.band||''));
     const a=pick(/2[.,]?4\s*(?:g|ghz)?/i),b=pick(/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i);
     const validStack=x=>/^\d+(?:,\d+){5}$/.test(x||'');
     const mapValid=a.length===1&&b.length===1&&a[0].stack!==b[0].stack&&
       validStack(a[0].stack)&&validStack(b[0].stack)&&!!a[0].ssid&&!!b[0].ssid;
     return {ok:true,rows:safe,bands,recordCount:safe.length,
       code,allBandsConfirmed:mapValid,
       mapped:mapValid?{ssid24:a[0].ssid,ssid5:b[0].ssid,stack24:a[0].stack,stack5:b[0].stack}:null};
   }catch(e){return {ok:false,reason:'VENDOR_GET_EXCEPTION',code:String(e.name||'Error').slice(0,30)}}
 }});
 const res=output?.[0]?.result;
 if(!res)throw Error('C20_NATIVE_READ_EMPTY');
 if(!res.ok)throw Error('C20_NATIVE_READ_'+res.reason+(res.code!==undefined?'_'+res.code:''));
 // Snapshot is private to the service worker. Never persist credentials or leak
 // original dynamic stacks to an untrusted router page or analytics service.
 nativeEvidence=res.allBandsConfirmed?{tabId,at:Date.now(),map:res.mapped,
   modelConfirmed:n.isC20,firmwareConfirmed:n.firmware200821,hardwareConfirmed:n.hardwareV5}:null;
 return {apiVerified:true,originVerified:true,stage:n.stage,transport:'NATIVE_VENDOR_API',wifi:res,
    canWrite:!!res.allBandsConfirmed&&n.stage==='CONFIGURED_AUTHENTICATED',reason:res.allBandsConfirmed?'EXPERIMENTAL_VENDOR_ACT_SET_REQUIRES_PHYSICAL_VERIFICATION':'BANDS_OR_STACKS_AMBIGUOUS',
    next:res.allBandsConfirmed?'WIFI_SET_REQUIRES_HARDWARE_VALIDATION':'CONFIRM_BOTH_BANDS_BEFORE_WRITE'};
}

// This function runs IN THE TP-LINK MAIN WORLD, not in an extension iframe.
// It has no dependency on extension globals. Use the vendor's own crypto/session.
// All sensitive Wi-Fi keys remain transient; none are returned in a result.
async function vendorWifiTransaction(req){
 if(location.origin!=='http://192.168.0.1')return {ok:false,reason:'ORIGIN_MISMATCH',submitted:false};
 const title=(document.title||'')+' '+(document.body?.innerText||'').slice(0,3000);
 if(!/Archer\s*C20/i.test(title))return {ok:false,reason:'MODEL_NOT_C20',submitted:false};
 const $=window.$;
 if(!$||typeof $.act!=='function'||typeof $.exe!=='function')return {ok:false,reason:'VENDOR_API_UNAVAILABLE',submitted:false};
 if(($.as?.length||0)!==0||($.ds?.length||0)!==0)return {ok:false,reason:'VENDOR_QUEUE_BUSY',submitted:false};
 const validStack=s=>typeof s==='string'&&/^\d+(?:,\d+){5}$/.test(s);
 const listType=typeof window.ACT_GL==='number'?window.ACT_GL:1;
 const setType=typeof window.ACT_SET==='number'?window.ACT_SET:2;
 // Re-read BEFORE mutating: reject stale values, altered stacks and wrong radio mapping.
 let rows;
 try{
   rows=$.act(listType,'LAN_WLAN','0,0,0,0,0,0','0,0,0,0,0,0',
     ['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']);
   if(!Array.isArray(rows))return {ok:false,reason:'VENDOR_LIST_NOT_ARRAY',submitted:false};
   const code=$.exe();
   if(code!==0)return {ok:false,reason:'VENDOR_LIST_FAILED',code,submitted:false};
 }catch(e){return {ok:false,reason:'VENDOR_READ_EXCEPTION',name:String(e.name||'Error'),submitted:false};}
 const mapped=rows.map(x=>({ssid:x?.SSID,band:x?.X_TP_Band,stack:x?.__stack}));
 const a=mapped.filter(x=>/2[.,]?4\s*(?:g|ghz)?/i.test(x.band||''));
 const b=mapped.filter(x=>/(?:^|[^0-9])5\s*(?:g|ghz)?(?:$|[^a-z])/i.test(x.band||''));
 if(a.length!==1||b.length!==1||!validStack(a[0].stack)||!validStack(b[0].stack))
   return {ok:false,reason:'RADIO_MAPPING_CHANGED',submitted:false};
 if(a[0].stack===b[0].stack||a[0].stack!==req.stack24||b[0].stack!==req.stack5||
    a[0].ssid!==req.old24||b[0].ssid!==req.old5)
   return {ok:false,reason:'STALE_WLAN_STATE_REREAD_REQUIRED',submitted:false};
 const new24=req.ssid24!==req.old24,new5=req.ssid5!==req.old5;
 if(!new24&&!new5&&!req.password)return {ok:false,reason:'NO_CHANGES',submitted:false};
 // Partial ACT_SET is deliberately used for SSID-only changes: do NOT send an
 // absent/placeholder key as this could overwrite the real Wi-Fi password.
 // This is a bounded experiment and requires a physical readback after writing.
 const attrs24={}, attrs5={};
 if(new24)attrs24.SSID=req.ssid24;
 if(new5)attrs5.SSID=req.ssid5;
 if(req.password){attrs24.X_TP_PreSharedKey=req.password;attrs5.X_TP_PreSharedKey=req.password;}
 try{
   if(Object.keys(attrs24).length)$.act(setType,'LAN_WLAN',a[0].stack,null,attrs24);
   if(Object.keys(attrs5).length)$.act(setType,'LAN_WLAN',b[0].stack,null,attrs5);
 }catch(e){return {ok:false,reason:'VENDOR_SET_QUEUE_FAILED',name:String(e.name||'Error'),submitted:false};}
 // Stock Quick Setup uses $.exe(callback) after two ACT_SET operations.
 // The call can drop the active Wi-Fi connection before a callback can execute.
 return await new Promise(resolve=>{
   let finished=false;
   const finish=v=>{if(!finished){finished=true;clearTimeout(timer);resolve(v);}};
   const timer=setTimeout(()=>finish({ok:true,submitted:true,ack:'UNKNOWN_TIMEOUT',
       retrySafe:false}),11000);
   try{$.exe(code=>{
     const numeric=typeof code==='number'?code:null;
     finish({ok:numeric===0,submitted:true,ack:numeric===0?'ACK_ZERO':numeric===null?'ACK_UNKNOWN':'ERROR',
       code:numeric,retrySafe:false});
   });}catch(e){finish({ok:false,submitted:true,ack:'EXCEPTION_AFTER_SEND',
      name:String(e.name||'Error'),retrySafe:false});}
 });
}
function validateWifiChange(req){
 if(req?.confirm!==true)throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 const validSsid=(s,label)=>{
   if(typeof s!=='string'||!s||/[\r\n\0]/.test(s)||new TextEncoder().encode(s).length>32)
     throw Error('C20_INVALID_'+label+'_MAX_32_BYTES');
 };
 validSsid(req.ssid24,'SSID24');validSsid(req.ssid5,'SSID5');
 if(req.password!==undefined){
   if(typeof req.password!=='string'||req.password.length<8||req.password.length>63||
      !/^[\x20-\x7E]+$/.test(req.password))throw Error('C20_WIFI_PASSWORD_8_TO_63_ASCII');
 }
}
async function nativeSetWifiCore(req){
 validateWifiChange(req);
 await recoverPending();
 if(pendingWrite)throw Error('C20_PENDING_WRITE_CHECK_BEFORE_ANOTHER_CHANGE');
 // The earlier protected read may have happened before an MV3 SW eviction.
 // Re-establish the proof inside THIS user-authorized write operation.
 // old24/old5 are the values that were shown to the user, not edited fields.
 if(typeof req.old24!=='string'||typeof req.old5!=='string')
   throw Error('C20_PRECHECK_MISSING_BASELINE_READ_WIFI_FIRST');
 const fresh=await nativeRead();
 if(!fresh.wifi?.mapped || !fresh.apiVerified)
   throw Error('C20_PRECHECK_PROTECTED_WLAN_READ_UNCONFIRMED');
 if(fresh.wifi.mapped.ssid24!==req.old24||fresh.wifi.mapped.ssid5!==req.old5)
   throw Error('C20_PRECHECK_WIFI_CHANGED_SINCE_DISPLAY_REREAD');
 const n=await inspectNative();
 if(!n.isC20||n.stage!=='CONFIGURED_AUTHENTICATED')
   throw Error('C20_WIFI_SET_REQUIRES_CONFIGURED_AUTHENTICATED_PAGE');
 if(!n.stockIoReady)throw Error('C20_STOCK_API_UNAVAILABLE');
 const e=nativeEvidence;
 if(!e||e.tabId!==tabId||!e.map||Date.now()-e.at>120000||!e.modelConfirmed)
   throw Error('C20_FRESH_PROTECTED_WLAN_READ_REQUIRED');
 if(!req.password&&e.map.ssid24===req.ssid24&&e.map.ssid5===req.ssid5)
   return{noChanges:true,verified:true};
 const expected={ssid24:req.ssid24,ssid5:req.ssid5};
 // Lock before sending. A dropped Wi-Fi link is an UNKNOWN result, not a
 // reason to repeat the write automatically.
 await setPending({at:Date.now(),expected,passwordChanged:!!req.password,stage:'SENDING'});
 const args={ssid24:req.ssid24,ssid5:req.ssid5,password:req.password,
   old24:e.map.ssid24,old5:e.map.ssid5,stack24:e.map.stack24,stack5:e.map.stack5};
 let receipt;
 try{
   const output=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',
     func:vendorWifiTransaction,args:[args]});
   receipt=output?.[0]?.result;
 }catch(ex){
   await setPending({...pendingWrite,stage:'UNKNOWN_AFTER_INJECTION'});nativeEvidence=null;
   return{submitted:'UNKNOWN',verified:false,reason:'CONNECTION_INTERRUPTED_AFTER_WRITE_ATTEMPT',
     retrySafe:false,check:'RECONNECT_AND_READ_WIFI'};
 }
 nativeEvidence=null;
 if(!receipt){await setPending({...pendingWrite,stage:'UNKNOWN_NO_RECEIPT'});
   return{submitted:'UNKNOWN',verified:false,reason:'NO_VENDOR_RECEIPT',retrySafe:false};}
 if(!receipt.submitted){await setPending(null);
   return {submitted:false,verified:false,preflightFailed:true,safeToRetry:true,reason:'C20_VENDOR_PRECHECK_'+receipt.reason};}
 await setPending({...pendingWrite,stage:'PENDING_VERIFICATION'});
 if(receipt.ack!=='ACK_ZERO')return{submitted:true,verified:false,ack:receipt.ack,
    reason:'WRITE_RESULT_NOT_CONFIRMED',retrySafe:false,check:'RECONNECT_AND_READ_WIFI'};
 // Best-effort verification. If wireless restarts we must NOT resend the write.
 try{
   await new Promise(r=>setTimeout(r,1000));
   const after=await nativeRead();
   const mapped=after.wifi.mapped;
   const namesMatch=mapped?.ssid24===expected.ssid24&&mapped?.ssid5===expected.ssid5;
   if(namesMatch){await setPending({...pendingWrite,stage:'CONFIG_SAVED_AWAIT_APPLY'});
     return{submitted:true,verified:false,configVerified:true,applied:false,
       ssidVerified:true,passwordVerificationRequired:!!req.password,
       applyRequired:true,ack:receipt.ack,
       proof:'PROTECTED_VENDOR_LIST_READ_AFTER_SET',retrySafe:false};}
   await setPending({...pendingWrite,stage:'PENDING_VERIFICATION'});
   return{submitted:true,verified:false,configVerified:false,ssidVerified:false,
     passwordVerificationRequired:!!req.password,ack:receipt.ack,
     check:'RECONNECT_AND_READ_WIFI',retrySafe:false};
 }catch(ex){
   await setPending({...pendingWrite,stage:'PENDING_VERIFICATION'});
   return{submitted:true,verified:false,ack:receipt.ack,
     reason:'LINK_OR_READ_LOST_AFTER_SET',retrySafe:false,check:'RECONNECT_AND_READ_WIFI'};
 }
}
// Distinguish a safe failed preflight from an ambiguous post-submit result.
// A missing/expired MV3 proof or a changed SSID does NOT imply that any
// settings have been submitted. Preserve the write lock only after enqueue.
async function nativeSetWifi(req){
 try{return await nativeSetWifiCore(req)}catch(err){
   await recoverPending();
   if(/^C20_PENDING_WRITE_/.test(String(err?.message||'')))
     return {submitted:false,verified:false,preflightFailed:true,pending:true,
       safeToRetry:false,reason:messageSafe(err)};
   if(!pendingWrite)return {submitted:false,verified:false,preflightFailed:true,
     safeToRetry:true,reason:messageSafe(err)};
   throw err;
 }
}
async function checkPendingWifi(){
 await recoverPending();
 if(!pendingWrite)return {pending:false,reason:'NO_PENDING_WRITE'};
 const before=pendingWrite;
 const after=transport==='offscreen'?(await offscreenDiscover())?.radio:(await nativeRead()).wifi.mapped;
 const namesMatch=after?.ssid24===before.expected.ssid24&&after?.ssid5===before.expected.ssid5;
 if(namesMatch)return{pending:true,verified:false,configVerified:true,
   ssidVerified:true,applyRequired:!before.stage.startsWith('REBOOT_CONTROL_'),
   nativeRebootRequested:before.stage.startsWith('REBOOT_CONTROL_'),
   needsPhysicalConfirmation:before.stage.startsWith('REBOOT_CONTROL_'),
   passwordVerificationRequired:before.passwordChanged,
   reason:before.stage.startsWith('REBOOT_CONTROL_')?
     'REBOOT_REQUESTED_VERIFY_ON_AIR_WITH_CLIENT':'CONFIG_SAVED_REBOOT_REQUIRED',wifi:after};
 return {pending:true,verified:false,ssidVerified:false,
    reason:'CONFIGURATION_DIFFERS_OR_NOT_YET_APPLIED_DO_NOT_RETRY_AUTOMATICALLY'};
}

// The stock reboot control is captured as #topReboot on the C20 v5.
// It may open a vendor confirmation dialog rather than reboot immediately.
// The explicit call never claims radio activation; physical validation remains
// necessary. This is NOT a guessed /cgi_gdpr or reboot RPC.
async function requestStockReboot(){
 await recoverPending();
 if(!pendingWrite)throw Error('C20_NO_PENDING_WIFI_CHANGE');
 const before=await checkPendingWifi();
 if(!before.configVerified)throw Error('C20_WIFI_CONFIG_NOT_VERIFIED_NO_REBOOT');
 if(['REBOOT_CONTROL_ACTIVATED','REBOOT_CONTROL_MAY_HAVE_BEEN_ACTIVATED'].includes(pendingWrite.stage))
   return {requestedBefore:true,repeatBlocked:true,physicalConfirmationRequired:true};
 if(transport==='offscreen'){
   const current=await offscreenDiscover();
   if(!current?.readConfirmed)throw Error('C20_OFFSCREEN_REBOOT_REQUIRES_PROTECTED_READ');
   await setPending({...pendingWrite,stage:'REBOOT_CONTROL_MAY_HAVE_BEEN_ACTIVATED'});
   let clicked;
   try{clicked=await offscreenCommand('reboot')}catch{return{requested:'UNKNOWN',reason:'OFFSCREEN_REBOOT_RESULT_UNKNOWN',repeatBlocked:true}}
   if(!clicked?.requested){await setPending({...pendingWrite,stage:'CONFIG_SAVED_AWAIT_APPLY'});
     return{requested:false,reason:clicked?.reason||'NO_STOCK_REBOOT_CONTROL'};}
   await setPending({...pendingWrite,stage:'REBOOT_CONTROL_ACTIVATED'});
   return{requested:true,confirmationMayBeRequired:true,physicalConfirmationRequired:true};
 }
 const n=await inspectNative();
 if(n.stage!=='CONFIGURED_AUTHENTICATED')throw Error('C20_ROUTER_NOT_AUTHENTICATED');
 // Lock BEFORE injection: if the router disconnects after the click, we
 // cannot safely assume it was not rebooted and send the click again.
 await setPending({...pendingWrite,stage:'REBOOT_CONTROL_MAY_HAVE_BEEN_ACTIVATED'});
 let result;
 try{result=await Promise.race([chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
   if(location.origin!=='http://192.168.0.1')return{clicked:false,reason:'ORIGIN'};
   const button=document.getElementById('topReboot');
   if(!button||!button.getClientRects().length)return{clicked:false,reason:'NO_STOCK_REBOOT_CONTROL'};
   if(button.disabled)return{clicked:false,reason:'STOCK_REBOOT_DISABLED'};
   button.click();return{clicked:true,confirmationMayBeRequired:true};
 }}).then(a=>a?.[0]?.result),new Promise((_,reject)=>
    setTimeout(()=>reject(Error('REBOOT_CONTROL_TIMEOUT')),4500))]);}
 catch{return {requested:'UNKNOWN',repeatBlocked:true,reason:'ROUTER_MAY_HAVE_RESTARTED_OR_STOCK_CONFIRM_WAITING'};}
 if(!result?.clicked){await setPending({...pendingWrite,stage:'CONFIG_SAVED_AWAIT_APPLY'});
   return{requested:false,reason:result?.reason||'NO_RECEIPT'};}
 await setPending({...pendingWrite,stage:'REBOOT_CONTROL_ACTIVATED'});
 return {requested:true,verified:false,confirmationMayBeRequired:true,
   note:'STOCK_REBOOT_CONTROL_CLICKED_NOT_PROOF_OF_REBOOT'};
}
async function confirmPhysicalWifi(){
 await recoverPending();
 if(!pendingWrite||!['REBOOT_CONTROL_ACTIVATED','REBOOT_CONTROL_MAY_HAVE_BEEN_ACTIVATED'].includes(pendingWrite.stage))
   throw Error('C20_NO_REBOOT_REQUEST_PHYSICAL_CONFIRMATION_BLOCKED');
 const check=await checkPendingWifi();
 if(!check.configVerified)throw Error('C20_CONFIG_READBACK_NOT_VERIFIED');
 await setPending(null);
 return {verified:true,method:'USER_CONFIRMED_ON_AIR_AFTER_STOCK_REBOOT',
   note:'Physical join was affirmed by user, not automatically detected by Chrome'};
}
// Existing configured login: delegate to actual one-password TP-Link form. This
// avoids replaying an RSA/AES login after the vendor page has a valid session.
async function nativeLogin(password){
 if(typeof password!=='string'||!password||password.length>80)throw Error('ADMIN_PASSWORD_REQUIRED');
 const n=await inspectNative();
 if(n.stage==='QUICK_SETUP_ACTIVE'||n.stage==='CONFIGURED_AUTHENTICATED')
   return {alreadyLoggedIn:true,stage:n.stage,verifiedBy:'VISIBLE_VENDOR_SCREEN',apiVerified:false};
 if(n.stage!=='LOGIN_FORM')throw Error('C20_NOT_LOGIN_SCREEN_'+n.stage);
 let out;
 try{out=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:(pw)=>{
   if(location.origin!=='http://192.168.0.1')return {ok:false,reason:'ORIGIN_MISMATCH'};
   const visible=e=>!e.disabled&&e.getClientRects().length>0;
   const passwords=[...document.querySelectorAll('input[type="password"]')].filter(visible);
   if(passwords.length!==1)return {ok:false,reason:'EXPECTED_ONE_PASSWORD_FIELD'};
   const actions=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')]
     .filter(visible).filter(x=>/вход|войти|log\s*in|login|sign\s*in/i.test((x.innerText||x.value||'').trim()));
   if(actions.length!==1)return {ok:false,reason:'LOGIN_BUTTON_NOT_UNIQUE',count:actions.length};
   if(passwords[0].value)return {ok:false,reason:'FORM_ALREADY_HAS_PASSWORD'};
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
   if(!setter)return {ok:false,reason:'INPUT_SETTER_MISSING'};
   setter.call(passwords[0],pw);
   for(const type of ['input','change','blur'])passwords[0].dispatchEvent(new Event(type,{bubbles:true}));
   actions[0].click();return {ok:true,submitted:true};
 },args:[password]});}catch(e){
   // The login click may synchronously navigate and destroy the injected frame.
   // Never submit a second login; inspect the new screen instead.
   out=null;
 }
 if(out?.[0]?.result && !out[0].result.ok)throw Error('C20_NATIVE_LOGIN_'+out[0].result.reason);
 // Verify the screen has actually transitioned. A click does not prove login.
 for(let i=0;i<12;i++){
   await new Promise(r=>setTimeout(r,350));
   const probe=await inspectNative().catch(()=>null);
   if(['QUICK_SETUP_ACTIVE','CONFIGURED_AUTHENTICATED'].includes(probe?.stage)){
     transport='native';lastProbeStage=probe.stage;
     return{authenticated:true,stage:probe.stage,verifiedBy:'STOCK_UI_TRANSITION',apiVerified:false,createdTabs:0};
   }
 }
 throw Error('C20_NATIVE_LOGIN_SUBMITTED_NOT_VERIFIED');
}

// Hidden login path used by the legacy authorizeSmart command. The proposed
// "ghost" fetch/cookie recipe is not viable in MV3: Cookie is a forbidden
// fetch header, and a CGI ACK or scraped TokenID is not proof of a session.
// Reuse the audited same-origin offscreen XHR, cookie bridge, login fence and
// protected WLAN read instead. A submitted-but-unverified login is terminal;
// never fall through to another password-bearing transport.
async function ghostEncryptedLogin(password){
  if(typeof password!=='string'||!password||password.length>80||/[\r\n\0]/.test(password))
    throw Error('ADMIN_PASSWORD_REQUIRED');
  const result=await offscreenEncryptedLogin(password);
  const verified=result?.stage==='CONFIGURED_AUTHENTICATED'&&result.readConfirmed===true;
  return {authenticated:verified,submitted:result?.submitted===true,
    stage:result?.stage||'LOGIN_STATE_UNRESOLVED',transport:'OFFSCREEN_VENDOR_ORIGIN',
    wifi:verified?result.radio:null,verifiedBy:verified?'PROTECTED_WLAN_READ':null,
    diagnostic:result?.diagnostic||{reason:'NO_LOGIN_DIAGNOSTIC'}};
}

// One user action. Reuses an authenticated stock page when available; otherwise
// uses one fenced hidden encrypted login and requires a protected WLAN read.
async function authorizeSmart(password){
 if(typeof password!=='string'||!password||password.length>80)throw Error('ADMIN_PASSWORD_REQUIRED');
 const n=await inspectNative().catch(()=>null);
 if(n?.isC20 && (n.stage==='QUICK_SETUP_ACTIVE'||n.stage==='CONFIGURED_AUTHENTICATED')){
   const verified=await nativeRead();
   return {authenticated:verified.apiVerified,transport:'NATIVE_VENDOR_API',stage:n.stage,
     wifi:verified.wifi,verifiedBy:'PROTECTED_VENDOR_LIST_READ',loginSubmitted:false};
 }
 if(n?.isC20 && n.stage==='FACTORY_PASSWORD')throw Error('FIRST_PASSWORD_REQUIRED_NO_LOGIN');
 if(n?.isC20 && n.stage==='LOGIN_FORM'){
    const auth=await ghostEncryptedLogin(password);
    if(!auth.authenticated){
      const reason=auth.diagnostic?.reason||auth.stage;
      throw Error('C20_GHOST_LOGIN_UNVERIFIED_'+String(reason).replace(/[^a-z0-9_-]/ig,'_').slice(0,80));
    }
    return {...auth,loginSubmitted:auth.submitted};
 }
 if(transport==='unselected')await probe();
 if(transport!=='direct')throw Error('C20_DIRECT_SESSION_UNAVAILABLE_EXPLICIT_VENDOR_WINDOW_REQUIRED');
 const auth=await login('user',password);
 // Login token is not sufficient: require a fresh protected identity + WLAN read.
 const verified=await read();
 return {authenticated:!!auth.authenticated&&!!verified.wifi?.readConfirmed,
   transport:transport==='direct'?'SERVICE_WORKER_DIRECT':'INACTIVE_TAB_SAME_ORIGIN',
   wifi:verified.wifi,wan:verified.wan,identity:verified.identity,
   verifiedBy:'ENCRYPTED_IDENTITY_AND_WLAN_READ',loginSubmitted:true};
}
async function readSmart(){
 const n=await inspectNative().catch(()=>null);
 if(n?.isC20 && ['QUICK_SETUP_ACTIVE','CONFIGURED_AUTHENTICATED'].includes(n.stage)){
   const r=await nativeRead();return {mode:'native',...r};
 }
 if(session.token){const r=await read();return {mode:'direct',...r};}
 throw Error('C20_NO_VERIFIED_SESSION_LOGIN_REQUIRED');
}
async function gdpr(plain){
 if(!session.crypto||(transport!=='offscreen-rpc'&&!session.token))throw Error('C20_LOGIN_REQUIRED');
 const {sign,data}=await session.crypto.encrypt(plain,false);
 const headers={'Content-Type':'text/plain'};
 // The supplied Archer C20 stock lib.js explicitly comments out its
 // xhr.setRequestHeader('TokenID', $.tokenid). Do not add a non-stock header
 // to the router-origin encrypted CGI. Token evidence is diagnostic only.
 if(session.token&&transport!=='offscreen-rpc')headers.TokenID=session.token;
 const operation=plain.startsWith('5\r\n')&&plain.includes('[LAN_WLAN#')?'READ_WLAN':
   plain.includes('IGD_DEV_INFO')?'READ_IDENTITY':plain.includes('WAN_IP_CONN')?'READ_WAN':'OTHER_GDPR';
 const r=await http('/cgi_gdpr','POST',`sign=${sign}\r\ndata=${data}\r\n`,headers,operation);
 if(r.http!==200)throw Error('C20_GDPR_HTTP_'+r.http);
 let result;try{result=await session.crypto.decrypt(r.text)}catch{throw Error('C20_DECRYPT_FAILED')}
 return{raw:result,error:C20Protocol.parseErrors(result)};
}
async function gdprRead(payload){const x=await gdpr(payload);if(x.error!==null&&x.error!==0)throw Error('C20_ACT_GET_ERROR_'+x.error);return x.raw}
async function read(){
 // A successful decrypted WLAN reply is actual protected data access; a root
 // HTTP 200, a TokenID or a loaded JS library are never enough.
 if(!session.crypto||(transport!=='offscreen-rpc'&&!session.token))throw Error('C20_PROTECTED_LOGIN_REQUIRED');
 let wlanRaw=null,wlan=null,lastError=null;
 const attempts=transport==='offscreen-rpc'?1:3;
 for(let i=0;i<attempts;i++)try{
   wlanRaw=await gdprRead(i===2?C20Protocol.wifiReadFallback():C20Protocol.wifiRead());
   wlan=C20Protocol.parseWifi(wlanRaw);
   if(!wlan.dynamicStacksVerified)throw Error('C20_WLAN_BAND_STACK_MAPPING_NOT_PROVEN');break;
 }catch(e){lastError=e;if(i<attempts-1)await new Promise(r=>setTimeout(r,250));}
 if(!wlan?.dynamicStacksVerified)throw lastError||Error('C20_WIFI_READ_FAILED');
 let identity={model:'',hardware:'',firmware:'',allowed:false};
 if(transport!=='offscreen-rpc')try{identity=C20Protocol.parseIdentity(await gdprRead(C20Protocol.versionRead()))}catch{}
 // The identity read command is not confirmed from the physical trace.
 // WLAN read may be useful even if it is unsupported: report read-only.
 let wan=null;if(transport!=='offscreen-rpc')try{wan=C20Protocol.parseWan(await gdprRead(C20Protocol.wanRead()))}catch{}
 session.identity=identity;session.radio=wlan;session.wan=wan;session.lastRead=Date.now();
 return {identity,wifi:{ssid24:wlan.radio24.ssid,ssid5:wlan.radio5.ssid,readConfirmed:true,
    dynamicStacksVerified:true},
   wan:wan?{dhcp:wan.dhcp,schema:wan.hasWanIpConn&&wan.hasAddressingType}:null,
   canWrite:false,status:'PROTECTED_WLAN_READ_CONFIRMED',
   note:'Protected WLAN access verified. Version/WAN reads and writes need separate physical evidence.'};
}
async function setWifi(request){
 if(request?.confirm!==true)throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 if(!session.identity?.allowed||!session.radio||Date.now()-session.lastRead>120000)throw Error('FRESH_READ_REQUIRED');
 if(transport!=='direct'||!session.radio?.verifiedPhysicalContract||!session.radio?.radio24?.stack||!session.radio?.radio5?.stack)throw Error('C20_WIFI_WRITE_REQUIRES_VERIFIED_DEVICE_STACKS');
 const packet=C20Protocol.wifiSet({...request,stack24:session.radio.radio24.stack,stack5:session.radio.radio5.stack});
 const result=await gdpr(packet);
 if(result.error!==null&&result.error!==0)throw Error('C20_ACT_SET_ERROR_'+result.error);
 // The response may precede Wi-Fi restart. Do not claim success here.
 session.lastRead=0;
 return{setAccepted:true,verified:false,reconnectRequired:true,
  message:'Команда изменения отправлена. После восстановления Wi-Fi повторно войдите и проверьте SSID/пароль.'};
}
async function setDhcp(request){
 if(request?.confirm!==true)throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 if(!session.identity?.allowed||!session.wan||Date.now()-session.lastRead>120000)throw Error('FRESH_READ_REQUIRED');
 if(session.wan.dhcp)return{alreadyDhcp:true,verified:true};
 if(transport!=='direct'||!session.wan?.validatedPhysicalSchema)throw Error('C20_DHCP_WRITE_REQUIRES_VERIFIED_PHYSICAL_SCHEMA');
 const payload=C20Protocol.wanSetDhcp(session.wan);
 const r=await gdpr(payload);if(r.error!==null&&r.error!==0)throw Error('C20_DHCP_SET_ERROR_'+r.error);
 session.lastRead=0;return{setAccepted:true,verified:false,message:'DHCP SET отправлен. Требуется повторная проверка WAN.'};
}
async function bootstrap(m){
 if(m?.confirm!==true)throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 if(lastProbeStage==='QUICK_SETUP_ACTIVE'||lastProbeStage==='CONFIGURED_AUTHENTICATED'||transport==='native')
   return await nativeContinue();
 if(!m.password)throw Error('ADMIN_PASSWORD_REQUIRED');
 const step=s=>chrome.runtime.sendMessage({type:'c20.progress',step:s}).catch(()=>{});
 await step('Вход через зашифрованный TP-Link CGI');
 const auth=await login(m.username,m.password);
 await step('Чтение модели, прошивки, WAN и Wi-Fi');
 const before=await read();
 if(!session.identity?.allowed)throw Error('ROUTER_IDENTITY_NOT_CONFIRMED');
 if(!before.wan?.schema)throw Error('C20_WAN_SCHEMA_NOT_CONFIRMED_NO_WRITE');
 const out={model:'Archer C20 v5',firmware:'200821',login:true,wan:null,wifi:null,verified:false};
 if(before.wan.dhcp){out.wan={alreadyDhcp:true,verified:true};}
 else{
   await step('Настройка WAN DHCP');
   out.wan=await setDhcp({confirm:true});
   // Refresh READ for subsequent Wi-Fi SET; never reuse stale state.
   await step('Повторная проверка WAN после записи');
   const wanAfter=await read();
   if(!wanAfter.wan?.dhcp)throw Error('C20_DHCP_NOT_VERIFIED_WIFI_NOT_TOUCHED');
   out.wan.verified=true;
 }
 const req={confirm:true,ssid24:m.ssid24||before.wifi.ssid24,ssid5:m.ssid5||before.wifi.ssid5};
 if(m.wifiPassword!==undefined&&m.wifiPassword!=='')req.password=m.wifiPassword;
 if(!req.password&&req.ssid24===before.wifi.ssid24&&req.ssid5===before.wifi.ssid5){
   out.wifi={unchanged:true,verified:true};out.verified=true;
   await step('Готово: WAN и Wi-Fi уже соответствуют параметрам');return out;
 }
 await step('Применение Wi-Fi на обоих диапазонах');
 out.wifi=await setWifi(req);
 await step('Ожидаем восстановление Wi-Fi. Переподключитесь при необходимости.');
 // The link may drop before we can read back. Never assert success on receipt alone.
 out.verified=false;
 return out;
}

// The ONE primary user workflow. Never claims that loaded stock JS alone is
// authentication. It probes/read-verifies; if necessary it opens ONE inactive
// vendor tab, preserving it and reusing it for the whole session.
// Optional fallback. Chrome cannot run TP-Link's page-owned $.act/$.exe in
// a Service Worker: this creates a SEPARATE minimized vendor popup window,
// not a new tab next to RouterLab. It happens ONLY after an explicit click.
// The popup may have to be shown if the stock page displays a native dialog.
async function openVendorSession(){
 nativeSessionOptIn=true; // user explicitly requested the separate stock context
 let n=await inspectNative().catch(()=>null);
 if(n?.isC20)return {reused:true,stage:n.stage,windowCreated:false};
 if(!chrome.windows?.create)throw Error('C20_WINDOWS_API_UNAVAILABLE');
 const win=await chrome.windows.create({url:URL,type:'popup',state:'minimized',focused:false});
 const id=win?.tabs?.[0]?.id;
 if(!Number.isInteger(id))throw Error('C20_MINIMIZED_VENDOR_TAB_ID_MISSING');
 tabId=id;tabOwned=true;vendorWindowId=win.id;
 for(let i=0;i<35;i++){
   const info=await chrome.tabs.get(id).catch(()=>null);
   if(info?.status==='complete')break;
   await new Promise(resolve=>setTimeout(resolve,200));
 }
 n=await inspectNative().catch(()=>null);
 if(!n?.isC20)return {windowCreated:true,stage:n?.stage||'UNVERIFIED',
   note:'VENDOR_WINDOW_CREATED_BUT_IDENTITY_NOT_YET_CONFIRMED'};
 return {windowCreated:true,stage:n.stage,transport:'MINIMIZED_VENDOR_WINDOW',
   nativeApiPresent:!!n.stockIoReady};
}
async function showVendorSession(){
 const n=await inspectNative().catch(()=>null);
 if(!n?.tabExists)throw Error('C20_NO_EXISTING_VENDOR_WINDOW');
 const tab=await chrome.tabs.get(tabId);
 if(!Number.isInteger(tab.windowId))throw Error('C20_VENDOR_WINDOW_ID_NOT_FOUND');
 await chrome.windows.update(tab.windowId,{state:'normal',focused:true});
 return {shown:true,stage:n.stage};
}
async function discoverUnified(hiddenOverride=null){
 await recoverPending();
 // The stock tab and offscreen iframe have distinct login/session lifecycles.
 // Never report native Quick Setup as RouterLab's own authenticated state.
 let n=nativeSessionOptIn?await inspectNative().catch(()=>null):null;
 const stateArea=chrome.storage?.session;
 const adminFence=stateArea?(await stateArea.get(ADMIN_PENDING_KEY))[ADMIN_PENDING_KEY]:null;
 const quickFence=stateArea?(await stateArea.get(QUICK_PENDING_KEY))[QUICK_PENDING_KEY]:null;
 const loginFence=stateArea?(await stateArea.get(LOGIN_STATE_KEY))[LOGIN_STATE_KEY]:null;
 const nativeWizardSeen=stateArea?(await stateArea.get(NATIVE_WIZARD_KEY))[NATIVE_WIZARD_KEY]:null;
 if(n?.isC20&&n.stage==='QUICK_SETUP_ACTIVE'&&stateArea)
   await stateArea.set({[NATIVE_WIZARD_KEY]:{at:Date.now(),stage:'QUICK_SETUP_ACTIVE'}});
 if(!n?.isC20){
   // During first-run / unresolved login, the real visible wizard must take
   // precedence over a readable but not-yet-final wireless configuration.
   let wizardFirst=null;
   if(loginFence||adminFence||lastProbeStage==='QUICK_SETUP_ACTIVE')wizardFirst=await offscreenCommand('quickStage').catch(()=>null);
   const isConfirmedWizard=['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(wizardFirst?.stage);
   // Preserve a verified worker session across page rescans in the same MV3
   // lifetime. A new probe MUST NOT send the user back to the login screen.
   // A protected WLAN read completed milliseconds ago during LOGIN.
   // Use that verified in-memory snapshot instead of immediately querying
   // the router a second time during continueUnified()->discoverUnified().
   if(!loginFence&&!isConfirmedWizard&&transport==='offscreen-rpc'&&
      session.crypto&&session.radio?.dynamicStacksVerified&&
      Date.now()-session.lastRead<30000){
     return {mode:'KNOWN_PASSWORD',phase:'WIFI_EDITOR',action:'READ_WIFI',
       verified:true,radio:{ssid24:session.radio.radio24.ssid,ssid5:session.radio.radio5.ssid},
       routerTabUsed:false,directOnly:true,requiresVendorWrite:true,
       transport:'OFFSCREEN_ROUTER_ORIGIN_RPC',pendingWifiWrite:!!pendingWrite,
       evidence:'FRESH_PROTECTED_WLAN_SNAPSHOT_NO_EXTRA_CGI'};
   }
   if(!loginFence && !isConfirmedWizard && (session.token||(transport==='offscreen-rpc'&&session.crypto))){
     try{
       const verified=await read();
       if(verified.wifi?.readConfirmed){
         if(loginFence&&stateArea){await stateArea.remove(LOGIN_STATE_KEY);await clearPendingLoginCrypto();}
         const completion=quickFence?.stage==='SUMMARY'&&!!verified.wan?.dhcp&&!!verified.wan?.schema;
         if(completion&&stateArea)await stateArea.remove(QUICK_PENDING_KEY);
         return {mode:'KNOWN_PASSWORD',phase:'WIFI_EDITOR',action:'READ_WIFI',
           quickAppliedPending:quickFence?.stage==='SUMMARY'&&!completion,
           quickSetupVerified:completion,
           verified:true,radio:{ssid24:verified.wifi.ssid24,ssid5:verified.wifi.ssid5},
           wanType:verified.wan?.dhcp?'DHCP':'UNKNOWN',routerTabUsed:false,
           directOnly:true,requiresVendorWrite:true,transport:transport==='offscreen-rpc'?'OFFSCREEN_ROUTER_ORIGIN_RPC':'SERVICE_WORKER_DIRECT',
           pendingWifiWrite:!!pendingWrite};
       }
     }catch{clearSession();transport='unselected';}
   }
   // The physical C20 returned valid RSA parameters in a router-origin iframe
   // (v0.6.2), even though the extension-origin Service Worker got HTTP 500.
   // Reuse that exact context as a live authenticated vendor transport.
   let hidden=null,hiddenError=null;
   try{hidden=loginFence?await offscreenCommand('pageState'):(hiddenOverride||await offscreenDiscover())}catch(e){hiddenError=messageSafe(e)}
   // The first administrator-password click belongs to the factory wizard,
   // NOT to the normal-login workflow. Physical v0.7.1 briefly displayed a
   // LOGIN_FORM during stock navigation. Keep the factory fence until the
   // wizard is positively identified; never send a second password here.
   if(adminFence && hidden?.stage==='LOGIN_FORM'){
     // An immediate login form after first admin creation can be a stock
     // navigation transient. After a sustained timeout do not guess either
     // 'Quick Setup' or 'wrong password': ask for user confirmation, then
     // check the stock login screen again before releasing the factory fence.
     if(Date.now()-Number(adminFence.at||0)>=20000){
       transport='offscreen';lastProbeStage='FACTORY_LOGIN_STALLED';
       return {mode:'FIRST_CONNECT',phase:'VERIFY_STATE',action:'ASK_FACTORY_LOGIN_TRANSITION',
         factoryLoginStalled:true,verified:false,
         routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',
         evidence:'FIRST_PASSWORD_SUBMITTED_STOCK_LOGIN_PERSISTS',radio:null,pendingWifiWrite:!!pendingWrite};
     }
     transport='offscreen';lastProbeStage='FACTORY_TRANSITION_PENDING';
     return {mode:'FIRST_CONNECT',phase:'QUICK_SETUP',action:'WAIT_FACTORY_WIZARD',
       verified:false,factoryTransitionPending:true,
       factoryObservedStage:'LOGIN_FORM',pendingAdminCreate:false,
       routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',radio:null,
       pendingWifiWrite:!!pendingWrite};
   }
   if(hidden?.stage==='LOGIN_LOCKED'){
     transport='offscreen';lastProbeStage='LOGIN_LOCKED';
     return{mode:'KNOWN_PASSWORD',phase:'AUTH_LOCKED',action:'WAIT_LOCKOUT',
       verified:false,routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',
       evidence:'STOCK_LOGIN_LOCKOUT_VISIBLE',radio:null,pendingWifiWrite:!!pendingWrite};
   }
   if(loginFence && hidden?.stage==='LOGIN_FORM'){
     // Keep the unverified crypto context for ONE read on explicit refresh.
     // This is not authentication proof and must never enable writes.
     if(!(transport==='offscreen-rpc'&&session.crypto))transport='offscreen';
     lastProbeStage='LOGIN_STATE_UNRESOLVED';
     return{mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'VERIFY_WITHOUT_PASSWORD',
       verified:false,routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',
       evidence:'ZERO_ACK_BUT_STOCK_LOGIN_FORM',radio:null,pendingWifiWrite:!!pendingWrite};
   }
   if(hidden?.stage==='LOGIN_FORM'){
     transport='offscreen';lastProbeStage='LOGIN_REQUIRED';
     // Passive inspection only: examine already-loaded vendor JS for login
     // field names. Never send credentials or rely on a heuristic as proof.
     const loginSchema=await offscreenCommand('loginSchema').catch(()=>null);
     return{mode:'KNOWN_PASSWORD',phase:'LOGIN',action:'LOGIN',verified:false,
       routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',radio:null,
       quickAppliedPending:quickFence?.stage==='SUMMARY',
       previousNativeWizard:!!(nativeWizardSeen&&Date.now()-Number(nativeWizardSeen.at||0)<900000),
       loginSchema:loginSchema||null,pendingWifiWrite:!!pendingWrite};
   }
   if(hidden?.stage==='CONFIGURED_AUTHENTICATED'&&hidden.readConfirmed===true){
     if(loginFence&&stateArea){await stateArea.remove(LOGIN_STATE_KEY);await clearPendingLoginCrypto();}
     if(adminFence&&stateArea)await stateArea.remove(ADMIN_PENDING_KEY);
     transport='offscreen';lastProbeStage='CONFIGURED_AUTHENTICATED';
     const wan=await offscreenCommand('wanRead').catch(()=>null);
     const completed=quickFence?.stage==='SUMMARY'&&wan?.status==='WAN_PROTECTED_READ_OK'&&wan.dhcpVerified;
     if(completed&&stateArea)await stateArea.remove(QUICK_PENDING_KEY);
     return{mode:'KNOWN_PASSWORD',phase:'WIFI_EDITOR',action:'READ_WIFI',verified:true,
       routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',radio:{ssid24:hidden.radio.ssid24,ssid5:hidden.radio.ssid5},
       wanType:wan?.dhcpVerified?'DHCP':'UNKNOWN',quickAppliedPending:quickFence?.stage==='SUMMARY'&&!completed,
       quickSetupVerified:!!completed,pendingWifiWrite:!!pendingWrite};
   }
   // No false factory claim on a script-only source hit: only the actual
   // two-password form may identify a first-use router.
   if(hidden?.stage==='QUICK_SETUP_ACTIVE'){
     const wizard=await offscreenCommand('quickStage').catch(()=>null);
     if(!['ISP_WAN','VLAN_DEFAULTS','WIRELESS','SUMMARY'].includes(wizard?.stage))
       return{mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'VERIFY_WITHOUT_PASSWORD',verified:false,
         routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',evidence:'WIZARD_STAGE_UNCONFIRMED'};
     if(loginFence&&stateArea){await stateArea.remove(LOGIN_STATE_KEY);await clearPendingLoginCrypto();}
     if(adminFence&&stateArea)await stateArea.remove(ADMIN_PENDING_KEY);
     if(stateArea)await stateArea.remove(NATIVE_WIZARD_KEY);
     transport='offscreen';lastProbeStage='QUICK_SETUP_ACTIVE';
     return{mode:'KNOWN_PASSWORD',phase:'QUICK_SETUP',action:'RESUME_QUICK',verified:false,
       routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',radio:null,
       quickAppliedPending:quickFence?.stage==='SUMMARY',
       pendingWifiWrite:!!pendingWrite};
   }
   if(hidden?.stage==='FACTORY_PASSWORD'){
     transport='offscreen';lastProbeStage='FACTORY_CANDIDATE';
     return{mode:'FIRST_CONNECT',phase:'CREATE_ADMIN',action:'CREATE_ADMIN',verified:false,
       routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',radio:null,
       pendingAdminCreate:!!adminFence,pendingWifiWrite:!!pendingWrite};
   }
   // A just-created password can also leave a transient loading/unknown
   // stock document. Preserve the one-time submission fence until we see
   // the real wizard, rather than treating an unknown page as a failed login.
   if(adminFence){
     transport='offscreen';lastProbeStage='FACTORY_TRANSITION_PENDING';
     return {mode:'FIRST_CONNECT',phase:'QUICK_SETUP',action:'WAIT_FACTORY_WIZARD',
       verified:false,factoryTransitionPending:true,
       factoryObservedStage:hidden?.stage||hiddenError||'UNKNOWN',
       pendingAdminCreate:false,routerTabUsed:false,
       transport:'OFFSCREEN_VENDOR_ORIGIN',radio:null,
       pendingWifiWrite:!!pendingWrite};
   }
   if(loginFence){
     if(!(transport==='offscreen-rpc'&&session.crypto))transport='offscreen';
     lastProbeStage='LOGIN_STATE_UNRESOLVED';
     return{mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'VERIFY_WITHOUT_PASSWORD',
       verified:false,routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',
       evidence:hidden?.stage||hiddenError||'NO_CONFIRMED_SCREEN',radio:null,pendingWifiWrite:!!pendingWrite};
   }
   // A direct-only try does not create a router tab and is useful on future
   // firmware. Physical C20 currently replies HTTP 500 for GDPR parameters.
   const audit=await directAudit().catch(()=>null);
   n=nativeSessionOptIn?await inspectNative().catch(()=>null):null;
   if(!n?.isC20){
     // The stock UI cannot be mounted inside a service worker; do not silently
     // create a visible router tab. Try the existing direct transport first.
     // A factory password screen is only safely identifiable through stock UI.
     const directReady=!!audit?.gdprParamsValid && audit?.rootHttp===200;
     if(directReady){
       transport='direct';lastProbeStage='LOGIN_REQUIRED';
       return {mode:'KNOWN_PASSWORD',phase:'LOGIN',action:'LOGIN',verified:false,
         routerTabUsed:false,directCandidate:true,transport:'SERVICE_WORKER_DIRECT',
         transportEvidence:audit,radio:null,pendingWifiWrite:!!pendingWrite};
     }
     return {mode:'UNAVAILABLE',phase:'TRANSPORT_SETUP',action:'EXPLICIT_VENDOR_SESSION',
       verified:false,routerTabUsed:false,radio:null,pendingWifiWrite:!!pendingWrite,
       transport:'SERVICE_WORKER_PROBE',transportEvidence:audit||null,
       reason:audit?.reason||'SW_DIRECT_PROBE_FAILED',offscreenFailure:hiddenError||hidden?.reason||hidden?.stage||null,
       next:'USER_CAN_OPT_IN_TO_MINIMIZED_VENDOR_WINDOW'};
   }
 }
 const f=C20Flow.classifyNative(n);
 lastProbeStage=nativeStage(n)||'UNKNOWN';
 if(f.phase==='QUICK_SETUP'||f.phase==='WIFI_EDITOR')transport='native';
 if(f.mode==='UNAVAILABLE')throw Error('C20_UNSUPPORTED_SCREEN_'+(n?.stage||'NONE'));
 const store=chrome.storage?.session;
 const adminPending=store?(await store.get(ADMIN_PENDING_KEY))[ADMIN_PENDING_KEY]:null;
 if(adminPending&&f.phase!=='CREATE_ADMIN')await store.remove(ADMIN_PENDING_KEY);
 const result={...f,routerTabUsed:!!n.tabExists,radio:null,verified:false,
   pendingWifiWrite:!!pendingWrite,
   pendingAdminCreate:!!adminPending&&f.phase==='CREATE_ADMIN'};
 const nativeQuickFence=store?(await store.get(QUICK_PENDING_KEY))[QUICK_PENDING_KEY]:null;
 if(nativeQuickFence?.stage==='SUMMARY'){
   result.quickAppliedPending=true;
   if(f.phase==='WIFI_EDITOR'&&result.verified){ /* checked below after protected read */ }
 }
 if(f.phase==='WIFI_EDITOR'||f.phase==='QUICK_SETUP'){
   // Protected list-read is the proof; not the presence of $.io.
   try{
     const r=await nativeRead();
     result.verified=!!r.apiVerified;
     result.radio=r.wifi.mapped;
   }catch(e){result.readError=messageSafe(e)}
 }
 // The only completion criterion after Quick Setup is a NEW protected WLAN
 // read AND a fresh WAN DHCP read on the configured stock page. Neither a
 // page redirect nor an ACK from Save is proof of persisted configuration.
 if(f.phase==='WIFI_EDITOR' && result.verified){
   try{
     const wan=await nativeWanDhcpEvidence();
     result.wanType=wan?.dhcpVerified?'DHCP':'UNKNOWN';
     if(result.quickAppliedPending && wan?.dhcpVerified && result.radio?.ssid24 && result.radio?.ssid5){
       await store.remove(QUICK_PENDING_KEY);
       result.quickAppliedPending=false;
       result.quickSetupVerified=true;
     }else if(result.quickAppliedPending)result.quickVerificationReason=wan?.reason||'WAN_DHCP_NOT_CONFIRMED';
   }catch(e){if(result.quickAppliedPending)result.quickVerificationReason='READBACK_PENDING';}
 }
 return result;
}
// Explicit, non-mutating recovery for stock firmware that persists on LOGIN_FORM
// after the first administrator password. Never click another login here.
async function resolveFactoryLogin(request){
 if(request?.confirm!==true)throw Error('C20_EXPLICIT_CONFIRM_REQUIRED');
 const area=chrome.storage?.session;
 if(!area)throw Error('C20_SESSION_STORAGE_NOT_AVAILABLE');
 const pending=(await area.get(ADMIN_PENDING_KEY))[ADMIN_PENDING_KEY];
 if(!pending||Date.now()-Number(pending.at||0)<20000)throw Error('C20_FACTORY_TRANSITION_NOT_SETTLED');
 if((await area.get(LOGIN_STATE_KEY))[LOGIN_STATE_KEY])throw Error('C20_LOGIN_ZERO_ACK_STILL_UNRESOLVED');
 const visible=await offscreenDiscover().catch(()=>null);
 const step=await offscreenCommand('quickStage').catch(()=>null);
 if(visible?.stage!=='LOGIN_FORM'||step?.stage!=='LOGIN_FORM')throw Error('C20_PERSISTENT_LOGIN_FORM_NOT_CONFIRMED');
 await area.remove(ADMIN_PENDING_KEY);
 return await discoverUnified(); // ordinary login is now user-initiated, not automatic
}
async function continueUnified(request){
 if(request?.confirm!==true)throw Error('C20_EXPLICIT_CONFIRM_REQUIRED');
 const flow=await discoverUnified();
 if(flow.pendingWifiWrite) return {...flow,outcome:'PENDING_WIFI_VERIFICATION',mustNotRepeat:true};
 const wifi=C20Flow.cleanWifi(request);
 if(flow.phase==='CREATE_ADMIN'){
   const pw=request?.adminPassword;
   if(typeof pw!=='string'||pw.length<8)throw Error('C20_NEW_ADMIN_PASSWORD_REQUIRED');
   if(pw!==request.adminConfirm)throw Error('C20_ADMIN_PASSWORD_CONFIRM_MISMATCH');
   const area=chrome.storage?.session;
   if(!area)throw Error('C20_ADMIN_SESSION_FENCE_UNAVAILABLE');
   const previous=(await area.get(ADMIN_PENDING_KEY))[ADMIN_PENDING_KEY];
   if(previous)return {...flow,outcome:'ADMIN_PENDING',reason:'FIRST_PASSWORD_ALREADY_ATTEMPTED_VERIFY_ROUTER'};
   // Lock before the native click: a page redirect or SW restart must never
   // make a second click without proof of the previous result.
   await area.set({[ADMIN_PENDING_KEY]:{at:Date.now(),stage:'SUBMISSION_UNCERTAIN'}});
   let setup;
   try{setup=flow.transport==='OFFSCREEN_VENDOR_ORIGIN'
     ?await offscreenFactoryCreate({password:pw,passwordConfirm:request.adminConfirm,confirm:true})
     :await factoryCreate({password:pw,passwordConfirm:request.adminConfirm,confirm:true});}
   catch(e){
     const reason=messageSafe(e);
     if(/C20_FACTORY_(?:FACTORY_PASSWORD_FIELDS_NOT_EXACT|FACTORY_START_BUTTON_NOT_EXACT|EXISTING_FORM_DATA_BLOCKED|NO_INPUT_SETTER|VENDOR_BUTTON_DISABLED|NOT_TPLINK_C20_PAGE|ORIGIN_MISMATCH|ADMIN_FIELDS_NOT_EMPTY_EXACT|ADMIN_BUTTON_NOT_UNIQUE|ADMIN_INPUT_SETTER_MISSING|ADMIN_INPUT_NOT_STABLE|FACTORY_SCREEN_NOT_CONFIRMED)/.test(reason))
       await area.remove(ADMIN_PENDING_KEY); // proved no click
     return {...flow,outcome:'ADMIN_PENDING',reason:'VERIFY_AFTER_FACTORY_CLICK_OR_PRECHECK_'+reason};
   }
   const next=await discoverUnified().catch(()=>null);
   return {...flow,outcome:'ADMIN_SUBMITTED',adminVerified:setup.verified,
      next:next?{mode:next.mode,phase:next.phase}:null,
      note:'Verify new router stage; do not create first password a second time.'};
 }
 if(flow.phase==='LOGIN'){
   if(chrome.storage?.session && (await chrome.storage.session.get(LOGIN_STATE_KEY))[LOGIN_STATE_KEY])
     return {...flow,outcome:'LOGIN_PENDING',reason:'PREVIOUS_ZERO_ACK_REQUIRES_STATE_CHECK'};
   const pw=request?.adminPassword;
   if(typeof pw!=='string'||!pw)throw Error('C20_EXISTING_ADMIN_PASSWORD_REQUIRED');
   if(flow.transport==='OFFSCREEN_VENDOR_ORIGIN'){
     // No synthetic click: the vendor login button navigated and aborted GDPR
     // on physical Archer v5 (network error). Send one encrypted same-origin XHR.
     const hidden=await offscreenEncryptedLogin(pw);
     if(hidden.stage==='QUICK_SETUP_ACTIVE'){
       const next=await discoverUnified();
       if(next.phase==='QUICK_SETUP')return {...next,outcome:'LOGIN_ROUTED_QUICK_SETUP',
         loginDiagnostic:hidden.diagnostic||null};
     }
     if(hidden.stage!=='CONFIGURED_AUTHENTICATED'){
       const next=await discoverUnified();
       return {...next,outcome:'LOGIN_PENDING',submitted:hidden.submitted!==false,
         reason:'ENCRYPTED_ROUTER_ORIGIN_LOGIN_NOT_VERIFIED',loginDiagnostic:hidden.diagnostic||null};
     }
     const next=await discoverUnified();
     return {...next,outcome:'LOGIN_VERIFIED',verifiedBy:'OFFSCREEN_ENCRYPTED_PROTECTED_WLAN_READ',
       loginRecovery:hidden.diagnostic?.recoveryRead==='CONFIRMED'?'PROTECTED_READ_AFTER_LOST_REPLY':null,
       loginDiagnostic:hidden.diagnostic||null};
   }
   const auth=await authorizeSmart(pw);
   if(!auth.authenticated)throw Error('C20_PROTECTED_LOGIN_FAILED');
   const next=await discoverUnified();
   return {...next,outcome:'LOGIN_VERIFIED',verifiedBy:'PROTECTED_VENDOR_LIST_READ'};
 }
 if(flow.phase==='QUICK_SETUP'){
   if(flow.transport==='OFFSCREEN_VENDOR_ORIGIN')return await offscreenAutoQuick({wifi:request.quickWifi||{}});
   if(!flow.verified)throw Error('C20_QUICK_SETUP_PROTECTED_READ_REQUIRED');
   return await autoQuick({wifi:request.quickWifi||{}});
 }
 if(flow.phase==='WIFI_EDITOR'){
   if(flow.directOnly)throw Error('C20_DIRECT_READ_ONLY_USE_EXPLICIT_VENDOR_SESSION_FOR_WRITE');
   if(!flow.verified||!flow.radio)throw Error('C20_WIFI_PROTECTED_READ_REQUIRED');
   if(!wifi.hasNames&&!wifi.hasKey)return {...flow,outcome:'READY_EDIT_WIFI'};
   const new24=wifi.ssid24||flow.radio.ssid24;
   const new5=wifi.ssid5||flow.radio.ssid5;
   const args={confirm:true,ssid24:new24,ssid5:new5,
     old24:flow.radio.ssid24,old5:flow.radio.ssid5,
     ...(wifi.hasKey?{password:wifi.password}:{})};
   const r=flow.transport==='OFFSCREEN_VENDOR_ORIGIN'?await offscreenSetWifi(args):await nativeSetWifi(args);
   return {...flow,outcome:'WIFI_SET',write:r};
 }
 throw Error('C20_FLOW_NOT_READY_'+flow.phase);
}
// Execute exactly one stock Quick Setup transition per explicit user action.
// Do not guess ISP or VLAN choices; never submit when the stock wizard page
// lacks an unambiguous validated action. A single click may advance and cause
// network restart, so no retry occurs automatically.
async function runQuickStep(wifi){
 const n=await inspectNative();
 if(n.stage!=='QUICK_SETUP_ACTIVE')throw Error('C20_QUICK_SETUP_NOT_ACTIVE');
 const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',
   func:vendorQuickSetupStep,args:[{ssid24:wifi.ssid24,ssid5:wifi.ssid5,password:wifi.password}]});
 const r=result?.[0]?.result;
 if(!r) return {outcome:'STEP_RESULT_UNKNOWN',stage:'QUICK_SETUP',mustNotRepeat:true};
 if(r.submitted) return {outcome:'QUICK_STEP_SUBMITTED',step:r.step,submitted:true,
   mustNotRepeat:true,next:'RESCAN_BEFORE_NEXT_CLICK'};
 return {outcome:'QUICK_STEP_BLOCKED',step:r.step||'UNKNOWN',reason:r.reason,
   submitted:false,next:'CORRECT_OR_INSPECT_STATE'};
}
// Runs in the TP-Link document MAIN world, keeping the stock encryption,
// browser cookie and vendor-provided validation. No arbitrary CGI payloads.
function vendorQuickSetupStep(wifi){
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
   buttons[0].click();return{step,submitted:true};
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

async function nativeWanDhcpEvidence(){
 const n=await inspectNative();
 if(!n?.isC20||n.stage!=='CONFIGURED_AUTHENTICATED')return{dhcpVerified:false,reason:'ROUTER_NOT_CONFIGURED'};
 const out=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
   if(location.origin!=='http://192.168.0.1')return{ok:false,reason:'ORIGIN'};
   const $=window.$;
   if(typeof $?.act!=='function'||typeof $.exe!=='function')return{ok:false,reason:'NATIVE_API_MISSING'};
   if($.as?.length||$.ds?.length)return{ok:false,reason:'QUEUE_BUSY'};
   const type=typeof window.ACT_GL==='number'?window.ACT_GL:5;
   try{
     const rows=$.act(type,'WAN_IP_CONN','0,0,0,0,0,0','0,0,0,0,0,0',
       ['enable','name','addressingType','X_TP_IPv4Enabled']);
     if(!Array.isArray(rows))return{ok:false,reason:'WAN_LIST_NOT_ARRAY'};
     const code=$.exe();
     if(code!==0)return{ok:false,reason:'WAN_READ_CODE',code};
     const enabled=rows.filter(x=>String(x?.enable)==='1'&&String(x?.X_TP_IPv4Enabled)==='1');
     const dhcp=enabled.filter(x=>x?.addressingType==='DHCP');
     return{ok:true,dhcpVerified:enabled.length===1&&dhcp.length===1,
        enabledCount:enabled.length,dhcpCount:dhcp.length};
   }catch(e){return{ok:false,reason:'WAN_READ_EXCEPTION_'+(e?.name||'Error')}}
 }});
 return out?.[0]?.result||{ok:false,reason:'WAN_READ_EMPTY'};
}
async function verifiedQuickFinish(steps,started){
 try{
   const wifi=await nativeRead();
   const wan=await nativeWanDhcpEvidence();
   if(wifi?.apiVerified&&wifi?.wifi?.allBandsConfirmed&&wan?.dhcpVerified)
     return{outcome:'AUTO_QUICK_DONE',steps,verified:{wifi:true,wanDhcp:true},elapsedMs:Date.now()-started};
   return{outcome:'AUTO_QUICK_PENDING',stage:'VERIFY_WAN_WIFI',reason:wan?.reason||'DHCP_NOT_VERIFIED',
     verified:{wifi:!!wifi?.wifi?.allBandsConfirmed,wanDhcp:!!wan?.dhcpVerified},steps,elapsedMs:Date.now()-started};
 }catch(e){return{outcome:'AUTO_QUICK_PENDING',stage:'VERIFY_WAN_WIFI',reason:'READBACK_NOT_AVAILABLE',steps,elapsedMs:Date.now()-started};}
}
// A bounded, single-click Quick Setup runner. Every vendor mutation is one-shot;
// a new step is permitted only after a different screen is observed. The full
// operation aims for 12 seconds, but applying Wi-Fi on hardware can take longer.
async function quickStageSnapshot(){
 const n=await inspectNative();
 if(!n?.isC20||n.stage!=='QUICK_SETUP_ACTIVE')
   return {stage:n?.stage||'UNKNOWN',signature:'OUTSIDE_WIZARD',isC20:!!n?.isC20};
 const out=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
   const shown=e=>!!e&&e.getClientRects().length>0;
   const get=id=>{let e=document.getElementById(id);
     if(shown(e))return e;
     return [...document.querySelectorAll('[id]')].find(x=>x.id?.toLowerCase()===id.toLowerCase()&&shown(x))||null;
   };
   let stage='UNKNOWN';
   const pane=get('quicksetup-process-content');
   const content=(pane?.innerText||'').replace(/\s+/g,' ').trim();
   // Order matters: stock UI can retain inactive wizard DOM nodes.
   // The HAR-confirmed VLAN form has a visible #quicksetup_dsl_container,
   // while its #prio <select> is display:none and must not drive visibility.
   if(get('save')&&/(?:обзор|summary|тип интернет.подключения)/i.test(content))stage='SUMMARY';
   else if(get('wl24gssid')&&get('wl5gssid'))stage='WIRELESS';
   else if(get('quicksetup_dsl_container'))stage='VLAN_DEFAULTS';
   else if(get('quicksetup_isp_container')&&document.getElementById('select_wan_type'))stage='ISP_WAN';
   // Log only non-sensitive structural markers. Avoid form values, SSID,
   // passwords, radio properties and text in diagnostic output.
   const markers={isp:!!get('quicksetup_isp_container'),vlan:!!get('quicksetup_dsl_container'),
     wlan:!!(get('wl24gssid')&&get('wl5gssid')),summary:!!get('save'),
     next:!!get('next'),nextButton:!!get('next_button')};
   return {stage,signature:stage,markers}; // no router content/SSID stored in session fence
 }});
 return {...out?.[0]?.result,isC20:true};
}

async function autoQuick(request={}){
 if(transport==='offscreen')return await offscreenAutoQuick(request);
 const wifi=C20Flow.cleanWifi(request.wifi||{});
 const started=Date.now(),steps=[],budgetMs=12000;
 // SW eviction must never cause a blind second click on the same wizard step.
 const area=chrome.storage?.session;
 if(!area)throw Error('C20_QUICK_SESSION_FENCE_UNAVAILABLE');
 const flow=await discoverUnified();
 if(flow.phase!=='QUICK_SETUP'||!flow.verified)
   return {outcome:'AUTO_QUICK_BLOCKED',stage:flow.phase,reason:'QUICK_PROTECTED_SESSION_NOT_VERIFIED',steps,elapsedMs:Date.now()-started};
 for(let i=0;i<7;i++){
   if(Date.now()-started>budgetMs)
     return {outcome:'AUTO_QUICK_PENDING',stage:'TIME_BUDGET_EXCEEDED',steps,elapsedMs:Date.now()-started};
   const before=await quickStageSnapshot();
   if(before.stage==='CONFIGURED_AUTHENTICATED')
     return await verifiedQuickFinish(steps,started);
   if(before.stage==='UNKNOWN'||before.stage==='LOGIN_FORM'||before.stage==='FACTORY_PASSWORD')
     return {outcome:'AUTO_QUICK_BLOCKED',stage:before.stage,reason:'STOCK_STAGE_UNVERIFIED',steps,elapsedMs:Date.now()-started};
   const saved=(await area.get(QUICK_PENDING_KEY))[QUICK_PENDING_KEY];
   if(saved?.stage==='SUMMARY')
     return {outcome:'AUTO_QUICK_RECONNECT_REQUIRED',stage:'SUMMARY',steps,
       reason:'SAVED_ON_ROUTER_AWAIT_RECONNECT',elapsedMs:Date.now()-started};
   if(saved){
     if(saved.stage===before.stage)
       return {outcome:'AUTO_QUICK_PENDING',stage:before.stage,reason:'PREVIOUS_STEP_MAY_HAVE_BEEN_SENT',steps,elapsedMs:Date.now()-started};
     await area.remove(QUICK_PENDING_KEY);
   }
   await area.set({[QUICK_PENDING_KEY]:{stage:before.stage,signature:before.signature,at:Date.now()}});
   let r;
   try{r=await runQuickStep({ssid24:wifi.ssid24,ssid5:wifi.ssid5,password:wifi.password});}
   catch(e){return {outcome:'AUTO_QUICK_PENDING',stage:before.stage,reason:'STOCK_STEP_RESULT_UNKNOWN',steps,elapsedMs:Date.now()-started}}
   if(!r.submitted)await area.remove(QUICK_PENDING_KEY);
   if(!r.submitted)
     return {outcome:'AUTO_QUICK_BLOCKED',stage:r.step,reason:r.reason||'UNKNOWN',steps,elapsedMs:Date.now()-started};
   steps.push(r.step);
   // A native Summary Save may reboot the router, change Wi-Fi credentials and
   // invalidate the current tab. Do not wait for a network-visible transition
   // or repeat Save. Let the user reconnect and prove the new state by readback.
   if(r.step==='SUMMARY')
     return {outcome:'AUTO_QUICK_RECONNECT_REQUIRED',stage:'SUMMARY',steps,
       reason:'SAVE_SENT_RECONNECT_THEN_VERIFY',elapsedMs:Date.now()-started};
   // Do not click the same step twice: wait for a different stage fingerprint.
   let changed=false,lastAfter=null;
   for(let n=0;n<20&&Date.now()-started<budgetMs;n++){
     await new Promise(resolve=>setTimeout(resolve,250));
     let after;
     try{after=await quickStageSnapshot();lastAfter=after}catch{
       return {outcome:'AUTO_QUICK_PENDING',stage:r.step,steps,reason:'ROUTER_RESTART_OR_LOST',elapsedMs:Date.now()-started};
     }
     if(after.stage==='CONFIGURED_AUTHENTICATED'){
       await area.remove(QUICK_PENDING_KEY);
       return await verifiedQuickFinish(steps,started);
     }
     if(after.stage!==before.stage && after.stage!=='UNKNOWN'){
       changed=true;await area.remove(QUICK_PENDING_KEY);break;
     }
   }
   if(!changed)return {outcome:'AUTO_QUICK_PENDING',stage:r.step,steps,
     reason:lastAfter?.stage==='UNKNOWN'?'NEXT_STAGE_UNRECOGNIZED_NO_RETRY':'STEP_TRANSITION_NOT_CONFIRMED_NO_RETRY',
     observedStage:lastAfter?.stage||'NO_SNAPSHOT',observedMarkers:lastAfter?.markers||null,
     elapsedMs:Date.now()-started};
 }
 return {outcome:'AUTO_QUICK_PENDING',stage:'STEP_LIMIT',steps,elapsedMs:Date.now()-started};
}
// An explicit user-requested state refresh is different from a passive scan.
// After zero-ACK login, a stale offscreen login DOM may never change until
// the embedded stock page is reloaded. Reload the hidden page once on click,
// then inspect actual stock markers. NEVER replay the CGI login or password.
async function refreshUnifiedState(){
 const area=chrome.storage?.session;
 let pending=area?(await area.get(LOGIN_STATE_KEY))[LOGIN_STATE_KEY]:null;
 const refreshContextBefore=await stateRefreshContextEvidence(pending);
 if(!pending){
   const flow=await discoverUnified();
   // A native stock logout may leave the offscreen iframe on a stale screen.
   // Refreshing state previously only rescanned that same DOM and fell back to
   // the C20's known-failing extension-origin GDPR HTTP 500 probe. On an
   // EXPLICIT user click, reload the hidden stock document once, then classify
   // its actual DOM. Never submit credentials from this path.
   if(flow.phase!=='TRANSPORT_SETUP' && flow.phase!=='VERIFY_STATE' && flow.phase!=='LOGIN')
     return {...flow,stateRefresh:{mode:'PASSIVE_NO_ZERO_ACK_FENCE',noPasswordSent:true}};
   const before=await offscreenCommand('pageState').catch(()=>null);
   // A concrete login form can be stale when the stock WebGUI session changed
   // in another tab. On an explicit refresh, reload only that login document
   // once, then do one stock-origin protected inspection. Never send LOGIN.
   // Factory, lockout, and wizard screens remain untouched.
   if(['FACTORY_PASSWORD','LOGIN_LOCKED','QUICK_SETUP_ACTIVE'].includes(before?.stage)){
     const observed=await discoverUnified();
     return {...observed,stateRefresh:{mode:'CONCRETE_SCREEN_RECHECK',
       before:before.stage,after:before.stage,noPasswordSent:true}};
   }
   const reload=await offscreenCommand('refresh').catch(()=>null);
   const didReload=reload?.refreshed===true;
   if(didReload)await new Promise(r=>setTimeout(r,350));
   const after=await offscreenCommand('pageState').catch(()=>null);
   const postRefreshInspection=didReload?await offscreenDiscover().catch(()=>null):null;
   const observed=await discoverUnified(postRefreshInspection);
   const diagnostics=after?.diagnostic||{};
   // An unrecognised screen is not a request for the Service Worker to
   // authenticate or an invitation to create a visible native tab.
   if(observed.phase==='TRANSPORT_SETUP'){
     return {mode:'KNOWN_PASSWORD',phase:'VERIFY_STATE',action:'VERIFY_WITHOUT_PASSWORD',
       verified:false,routerTabUsed:false,transport:'OFFSCREEN_VENDOR_ORIGIN',
       evidence:'OFFSCREEN_REFRESH_STAGE_UNRECOGNIZED',
       stateRefresh:{mode:didReload?'FRAME_RELOADED_UNKNOWN':'REFRESH_NOT_CONFIRMED',
         before:before?.stage||'UNKNOWN',after:after?.stage||'UNKNOWN',
         storageAccess:diagnostics.storageAccess||'NOT_REPORTED',
         cookieAccess:diagnostics.cookieAccess||'NOT_REPORTED',
         uiError:diagnostics.uiError||'NOT_REPORTED',
         protectedRefreshRead:'NOT_ATTEMPTED',noPasswordSent:true}};
   }
   return {...observed,stateRefresh:{mode:didReload?(before?.stage==='LOGIN_FORM'?'LOGIN_FORM_RELOADED':'FRAME_RELOADED_AFTER_UNAVAILABLE'):'REFRESH_NOT_CONFIRMED',
     before:before?.stage||'UNKNOWN',after:after?.stage||'UNKNOWN',
     storageAccess:diagnostics.storageAccess||'NOT_REPORTED',
     cookieAccess:diagnostics.cookieAccess||'NOT_REPORTED',
     uiError:diagnostics.uiError||'NOT_REPORTED',
     protectedRefreshRead:postRefreshInspection?.readConfirmed===true?'CONFIRMED':
       postRefreshInspection?.stage==='AUTH_UNCONFIRMED'?'UNCONFIRMED':'NOT_CONFIRMED',
     noPasswordSent:true}};
 }
 const explicitReadCount=Number.isInteger(pending?.explicitProtectedReadCount)?pending.explicitProtectedReadCount:
   (pending?.explicitProtectedReadAttempted===true?1:0);
 let recoveredCrypto=false;
 if(explicitReadCount>=2){
   await clearPendingLoginCrypto();
   session.crypto=null;session.token=null;session.identity=null;session.radio=null;
   transport='unselected';
 }else recoveredCrypto=await restorePendingLoginCrypto(pending);
 const before=await offscreenCommand('pageState').catch(()=>null);
 if(before?.stage==='QUICK_SETUP_ACTIVE'||
    (before?.stage==='CONFIGURED_AUTHENTICATED'&&before.readConfirmed===true)){
   const flow=await discoverUnified();
   return {...flow,stateRefresh:{mode:'ALREADY_CONFIRMED',before:before.stage,noPasswordSent:true}};
 }
 const refreshed=await offscreenCommand('refresh').catch(()=>null);
 const didRefresh=refreshed?.refreshed===true;
 if(didRefresh)await new Promise(r=>setTimeout(r,350));
 const after=await offscreenCommand('pageState').catch(()=>null);
 // An explicit "Refresh state" click may make one further protected read
 // after a zero-ACK login, even when the hidden frame cannot classify its DOM.
 // The AES context and cookie jar are still required; no password is replayed.
 let protectedRefreshRead='NOT_ATTEMPTED';
 let protectedRefreshReason=null;
 let refreshCookieBridgeConfirmed=false;
 let refreshCookieBridge='NOT_ATTEMPTED',refreshReadAudit=null;
 const refreshStage=after?.stage||'UNKNOWN';
 const safeReadStage=!['LOGIN_LOCKED','FACTORY_PASSWORD','QUICK_SETUP_ACTIVE'].includes(refreshStage);
 const readLimitReached=explicitReadCount>=2;
 if(safeReadStage&&recoveredCrypto&&transport==='offscreen-rpc'&&session.crypto&&
    pending?.state==='ACK_ZERO_POSTLOGIN_CHECK'&&!readLimitReached){
   // Persist a strict two-click limit before sending; worker eviction cannot
   // turn refresh into a loop, while one retry remains available after a
   // failed read or a newly established stock WebGUI session.
   const nextReadCount=explicitReadCount+1;
   await area.set({[LOGIN_STATE_KEY]:{...pending,explicitProtectedReadAttempted:true,
     explicitProtectedReadCount:nextReadCount,explicitProtectedReadAt:Date.now()}});
   pending={...pending,explicitProtectedReadAttempted:true,explicitProtectedReadCount:nextReadCount,
     explicitProtectedReadAt:Date.now()};
   refreshReadAudit={started:Date.now(),wire:[]};activeStateReadAudit=refreshReadAudit;
   try{
      refreshCookieBridge=await prepareRouterCookieBridge(await pendingLoginJsessionid());
    if(refreshCookieBridge!=='RULE_INSTALLED'){
      protectedRefreshRead='NOT_ATTEMPTED';
      protectedRefreshReason='COOKIE_BRIDGE_'+refreshCookieBridge;
    }else try{
      const raw=await gdprRead(C20Protocol.wifiRead());
      const wlan=C20Protocol.parseWifi(raw);
      if(!wlan.dynamicStacksVerified)throw Error('C20_REFRESH_WLAN_NOT_VERIFIED');
      session.radio=wlan;session.lastRead=Date.now();
      await area.remove(LOGIN_STATE_KEY);
      protectedRefreshRead='CONFIRMED';
      refreshCookieBridgeConfirmed=true;
    }catch(e){
      protectedRefreshRead='UNCONFIRMED';
      protectedRefreshReason=diagnosticReason(e);
      // Expose only transport metadata; never the protected response body.
      if(e?.httpTrace)protectedRefreshReason+='_'+e.httpTrace.event+
        '_RS'+(e.httpTrace.readyState??'NA')+'_MS'+(e.httpTrace.elapsedMs??'NA');
    }
   }finally{if(activeStateReadAudit===refreshReadAudit)activeStateReadAudit=null;}
   if(protectedRefreshRead==='CONFIRMED'||nextReadCount>=2)await clearPendingLoginCrypto();
 }else if(readLimitReached){
   protectedRefreshReason='EXPLICIT_READ_LIMIT_REACHED';
 }else if(!safeReadStage){
   protectedRefreshReason='STOCK_STAGE_BLOCKED';
 }else if(pending?.state!=='ACK_ZERO_POSTLOGIN_CHECK'){
   protectedRefreshReason='FENCE_NOT_ZERO_ACK';
 }else if(!recoveredCrypto){
   protectedRefreshReason='AES_CONTEXT_UNAVAILABLE';
 }else if(transport!=='offscreen-rpc'){
   protectedRefreshReason='TRANSPORT_UNAVAILABLE';
 }
 if(!refreshCookieBridgeConfirmed)await stopRouterCookieBridge();
 const flow=await discoverUnified();
 const diag=after?.diagnostic||{};
 const refreshContextAfter=await stateRefreshContextEvidence(pending);
 return {...flow,stateRefresh:{
    mode:didRefresh?'FRAME_RELOADED':'REFRESH_NOT_CONFIRMED',
    before:before?.stage||'UNKNOWN',after:after?.stage||'UNKNOWN',
    storageAccess:diag.storageAccess||'NOT_REPORTED',
    cookieAccess:diag.cookieAccess||'NOT_REPORTED',
    uiError:diag.uiError||'NOT_REPORTED',
    protectedRefreshRead,
    protectedRefreshReason,
    sessionTrace:{before:refreshContextBefore,after:refreshContextAfter,
      recoveredCrypto,cryptoRestored:recoveredCrypto,transportBefore:refreshContextBefore.transport,
      cookieBridge:refreshCookieBridge,readWire:refreshReadAudit?.wire||[]},
    noPasswordSent:true}};
}
async function runCommand(m){
 if(busy)throw Error('C20_OPERATION_BUSY');busy=true;
 try{switch(m.type){
  case 'c20.discoverUnified':return await discoverUnified();
  case 'c20.refreshUnifiedState':return await refreshUnifiedState();
  case 'c20.inspectBusyReadOnly':return await inspectBusyReadOnly();
  case 'c20.resolveFactoryLogin':return await resolveFactoryLogin(m);
  case 'c20.autoQuick':return await autoQuick(m);
  case 'c20.continueUnified':return await continueUnified(m);
  case 'c20.probe':return await probe();
  case 'c20.auditDirect':return await directAudit();
  case 'c20.auditOffscreen':return await probeOffscreenVendorFrame();
  case 'c20.openVendorSession':return await openVendorSession();
  case 'c20.showVendorSession':return await showVendorSession();
  case 'c20.requestStockReboot':return await requestStockReboot();
  case 'c20.confirmPhysicalWifi':return await confirmPhysicalWifi();
  case 'c20.probeTab':return await probe(true);
  case 'c20.login':return await login(m.username,m.password);
  case 'c20.authorizeSmart':return await authorizeSmart(m.password);
  case 'c20.readSmart':return await readSmart();
  case 'c20.factoryCreate':return await factoryCreate(m);
  case 'c20.inspectNative':return await inspectNative();
  case 'c20.nativeContinue':return await nativeContinue();
  case 'c20.nativeRead':return await nativeRead();
  case 'c20.nativeSetWifi':return await nativeSetWifi(m);
  case 'c20.checkPendingWifi':return await checkPendingWifi();
  case 'c20.writeStatus':return await writeStatus();
  case 'c20.nativeLogin':return await nativeLogin(m.password);
  case 'c20.read':return await read();
  case 'c20.setWifi':return await setWifi(m);
  case 'c20.setDhcp':return await setDhcp(m);
  case 'c20.bootstrap':return await bootstrap(m);
  case 'c20.end':await stopRouterCookieBridge();await clearPendingLoginCrypto();await chrome.storage?.session?.remove(LOGIN_STATE_KEY);await recoverPending();if(pendingWrite)throw Error('C20_PENDING_WRITE_VERIFY_BEFORE_END');await setPending(null);clearSession();postFactory=false;transport='unselected';if(tabOwned&&vendorWindowId!==null&&chrome.windows?.remove)await chrome.windows.remove(vendorWindowId).catch(()=>{});else if(tabOwned&&tabId!==null)await chrome.tabs.remove(tabId).catch(()=>{});tabId=null;tabOwned=false;vendorWindowId=null;nativeSessionOptIn=false;return{closed:true};
  default:throw Error('UNKNOWN_COMMAND');
 }}finally{busy=false;}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m?.type==='C20_OFFSCREEN_LOGIN_CLICK_SIGNAL'){
  // Only accept an extension-owned offscreen document; do not accept page
  // content script broadcasts as an authorization signal.
  if(!sender.tab&&sender.url===chrome.runtime.getURL('offscreen.html') && activeLoginAudit &&
     ['CLICK_ATTEMPT','CLICK_RETURNED','CLICK_EXCEPTION'].includes(m.result))activeLoginAudit.click=m.result;
  return false;
 }
 if(m?.type==='C20_OFFSCREEN_OPERATION')return false;
 if(m?.type==='C20_OFFSCREEN_FRAME_SIGNAL'){
   if(offscreenProbeSeen && !sender.tab && sender.url?.startsWith(URL) &&
      ['MODEL_NOT_CONFIRMED','FACTORY_PASSWORD','LOGIN_FORM','STOCK_API_NOT_READY',
       'VENDOR_QUEUE_BUSY','LIST_NOT_QUEUED','VENDOR_LIST_REJECTED',
       'VENDOR_PROTECTED_READ_OK','VENDOR_READ_INCOMPLETE','VENDOR_READ_EXCEPTION',
       'MAIN_WORLD_NO_REPLY','INVALID_VENDOR_REPLY'].includes(m.status) &&
      typeof m.isC20==='boolean' && typeof m.readConfirmed==='boolean')
      offscreenProbeSeen({status:m.status,isC20:m.isC20,readConfirmed:m.readConfirmed,
        recordCount:m.recordCount,has24:m.has24,has5:m.has5,
        gdprHttp:m.gdprHttp,gdprValid:m.gdprValid,gdprStatus:m.gdprStatus});
   return false;
 }
 if(sender.url!==PAGE||!m||!/^c20\./.test(m.type||''))return false;
 runCommand(m).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:messageSafe(e)}));return true;
});
