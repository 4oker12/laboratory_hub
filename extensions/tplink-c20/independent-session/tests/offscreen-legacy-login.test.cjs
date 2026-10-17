'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,generateKeyPairSync,privateDecrypt,constants,createDecipheriv,createCipheriv}=require('node:crypto');
const dir=path.resolve(__dirname,'..');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:512,publicExponent:65537});
const jwk=publicKey.export({format:'jwk'});
const nn=Buffer.from(jwk.n,'base64url').toString('hex'),ee=Buffer.from(jwk.e,'base64url').toString('hex');
const content=x=>fs.readFileSync(path.join(dir,x),'utf8');
const sigPlain=str=>(str.match(/.{128}/g)||[]).map(s=>privateDecrypt({key:privateKey,padding:constants.RSA_NO_PADDING},Buffer.from(s,'hex')).toString().replace(/\0+$/,'')).join('');
function environment(mode='success'){
 let runtimeHandler=null,iframe=false,loginRequests=0,readRequests=0,paramsRequests=0;
 const cookieHeaders=[],setCookieObservers=[];let issuedCookie=false,cookieRuleInstalled=false;
 const saved=new Map();
 let aes=null,stage='LOGIN_FORM',ready=false,frameLoads=1,authenticated=false,rootRequests=0;
 const encrypt=text=>{const ci=createCipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([ci.update(text),ci.final()]).toString('base64')};
 const decrypt=text=>{const ci=createDecipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([ci.update(Buffer.from(text,'base64')),ci.final()]).toString('utf8')};
 const chrome={
  runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,
   onInstalled:{addListener(){}},onMessage:{addListener:f=>runtimeHandler=f},
   getContexts:async()=>iframe?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
   sendMessage:async request=>{
    assert.equal(request.type,'C20_OFFSCREEN_OPERATION');
    if(request.command==='frameStatus')return{ok:true,result:{loaded:true,frameLoads}};
    if(request.command==='inspect')return{ok:true,result:{stage,readConfirmed:ready,
     ...(ready?{radio:{ssid24:'WIFI_24',ssid5:'WIFI_5',stack24:'1,3,0,0,0,0',stack5:'1,4,0,0,0,0'}}:{})}};
    if(request.command==='loginSchema')return{ok:true,result:{status:'INLINE_CALL_FOUND',legacyFields:true,lowercaseFields:false,callSites:3}};
    if(request.command==='login')throw Error('STOCK_BUTTON_CLICK_MUST_NOT_BE_CALLED');
    if(request.command!=='http')throw Error('UNEXPECTED_OFFSCREEN_COMMAND_'+request.command);
    const x=request.args;
    assert(['GET','POST'].includes(x.method));
    if(x.path==='/'){
      rootRequests++;
      return {ok:true,result:{http:200,url:'/',text:authenticated?
        '<script>var token=\"safeToken123\";</script>':'<title>Archer C20 login</title>'}};
    }
    if(x.path==='/cgi/getGDPRParm'){
      paramsRequests++;assert.equal(x.method,'POST');assert.equal(x.body,null);
      // The physical router sets a fresh JSESSIONID in the RSA response, but
      // Chrome's cookie store may not reflect it before LOGIN. WebRequest
      // headers arrive first and must be sufficient for pre-login bridging.
      for(const fn of (mode==='no-cookie'?[]:setCookieObservers))fn({url:'http://192.168.0.1/cgi/getGDPRParm',
        tabId:-1,initiator:'http://192.168.0.1',responseHeaders:[
        {name:'Set-Cookie',value:'JSESSIONID=fixtureFreshSession; HttpOnly'}]});
      return{ok:true,result:{http:200,url:x.path,text:`var nn="${nn}"; var ee="${ee}"; var seq=858738839;`}};
    }
    if(x.path==='/cgi/getBusy'){
      const headers=cookieRuleInstalled?[{name:'Cookie',value:'JSESSIONID=fixtureFreshSession'}]:[];
      for(const fn of cookieHeaders)fn({url:'http://192.168.0.1/cgi/getBusy',tabId:-1,requestHeaders:headers});
      return {ok:true,result:{http:200,text:'var isLogined=0; var isBusy=0;'}};
    }
    assert.equal(x.path,'/cgi_gdpr');assert.equal(x.method,'POST');
    assert.equal(x.headers['Content-Type'],'text/plain');
    const signature=String(x.body).split('\r\n')[0].slice(5);
    const plain=sigPlain(signature);
    if(plain.includes('key=')&&plain.includes('iv=')){
      loginRequests++;
      const key=plain.match(/key=([0-9]{16})/),iv=plain.match(/iv=([0-9]{16})/);
      assert(key&&iv);aes={key:key[1],iv:iv[1]};
      const ciphertext=String(x.body).split('\r\n')[1].slice(5);
      const loginBody=decrypt(ciphertext);
      assert.match(loginBody,/\[\/cgi\/login#/);assert.match(loginBody,/UserName=user\r\nPasswd=cHJpdmF0ZVBhc3N3b3JkMTIz/);
      if(mode==='network'||mode==='network-accepted'){
        if(mode==='network-accepted')authenticated=true;
        frameLoads++;
        return{ok:true,result:{http:0,error:'NETWORK_ERROR',readyState:4,elapsedMs:76}};
      }
      if(mode==='denied')return{ok:true,result:{http:200,text:encrypt('[cgi]0\r\n$.ret=71233;\r\n[error]0')}};
      authenticated=true;
      stage='LOGIN_FORM'; // DOM remains on login form even after successful encrypted CGI
      return{ok:true,result:{http:200,text:encrypt('[cgi]0\r\n$.ret=0;\r\n[error]0')}};
    }
    readRequests++;
    assert(aes,'read without initial crypto handshake');
    if(!authenticated)return{ok:true,result:{http:403,text:'NOT_LOGGED_IN'}};
    assert.equal(x.headers.TokenID,undefined,'stock TP-Link tpAjax has TokenID header disabled');
    const body=decrypt(String(x.body).split('\r\n')[1].slice(5));
    if(body.includes('LAN_WLAN'))return{ok:true,result:{http:200,text:encrypt(
      '[LAN_WLAN#1,3,0,0,0,0#0,0,0,0,0,0]0,4\r\nSSID=WIFI_24\r\nX_TP_Band=2.4GHz\r\n'+
      '[LAN_WLAN#1,4,0,0,0,0#0,0,0,0,0,0]1,4\r\nSSID=WIFI_5\r\nX_TP_Band=5GHz\r\n')}};
    if(body.includes('IGD_DEV_INFO'))return{ok:true,result:{http:200,text:encrypt('modelName=Archer C20\r\nhardwareVersion=Archer C20 v5 00000002\r\nsoftwareVersion=3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n')}};
    return{ok:true,result:{http:200,text:encrypt('[WAN_IP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,2\r\nAddressingType=DHCP')}};
   }},
  action:{onClicked:{addListener(){}}}, tabs:{query:async()=>[],onRemoved:{addListener(){}}},
  cookies:{getAll:async({partitionKey})=>partitionKey?[]:(issuedCookie?[{
    name:'JSESSIONID',value:'fixtureFreshSession',domain:'192.168.0.1',sameSite:'unspecified'}]:[])},
  declarativeNetRequest:{updateSessionRules:async ({addRules})=>{cookieRuleInstalled=!!addRules;}},
  webRequest:{onSendHeaders:{addListener:fn=>cookieHeaders.push(fn)},
    onHeadersReceived:{addListener:fn=>setCookieObservers.push(fn)},onCompleted:{addListener(){}},onErrorOccurred:{addListener(){}}},
  offscreen:{createDocument:async()=>{iframe=true}},
  storage:{session:{get:async k=>({[k]:saved.get(k)}),set:async v=>{for(const [k,x] of Object.entries(v))saved.set(k,x)},remove:async k=>saved.delete(k)}}
 };
 const ctx=vm.createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,
  AbortController,setTimeout:(cb,ms)=>setTimeout(cb,ms>800?2:ms),clearTimeout,console,btoa:global.btoa,atob:global.atob});
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(content(name),ctx,{filename:name}));
 vm.runInContext(content('background.js'),ctx,{filename:'background.js'});
 const rpc=(type,args={})=>new Promise(resolve=>{
  assert(runtimeHandler({type,...args},{url:chrome.runtime.getURL('setup.html')},resolve));
 });
 return{rpc,counters:()=>({loginRequests,readRequests,paramsRequests})};
}
(async()=>{
 const success=environment();
 let r=await success.rpc('c20.discoverUnified');assert(r.ok,r.error);assert.equal(r.data.phase,'LOGIN');
 r=await success.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_VERIFIED');
 assert.equal(r.data.verifiedBy,'OFFSCREEN_ENCRYPTED_PROTECTED_WLAN_READ');
 assert.equal(r.data.phase,'WIFI_EDITOR');
 assert.equal(r.data.radio.ssid24,'WIFI_24');
 assert.equal(r.data.loginDiagnostic?.wireProfile||'CGI_SLASH_LEGACY_USERNAME_PASSWD_B64_ACT_GL5','CGI_SLASH_LEGACY_USERNAME_PASSWD_B64_ACT_GL5');
 assert.equal(r.data.transport,'OFFSCREEN_ROUTER_ORIGIN_RPC');
 assert.equal(r.data.loginDiagnostic.cookieBridgeSource,'FRESH_RSA_SET_COOKIE',
   'fresh Set-Cookie from RSA must work even while Chrome cookie jar is empty');
 assert.equal(r.data.loginDiagnostic.cookieBridge,'RULE_INSTALLED');
 assert.equal(r.data.loginDiagnostic.cookieBridgeWire,'COOKIE_ATTACHED');
 assert.equal(success.counters().loginRequests,1);
 assert.equal(success.counters().readRequests,1,'exactly one WLAN read after the accepted login; no redundant post-login CGI');
 assert(!JSON.stringify(r).includes('privatePassword123'));
 // Repeated state discovery after login must reuse protected session, not submit login again.
 r=await success.rpc('c20.discoverUnified');assert(r.ok,r.error);
 assert.equal(r.data.phase,'WIFI_EDITOR');assert.equal(success.counters().loginRequests,1);
 assert.equal(success.counters().readRequests,1,'cached confirmed WLAN read after re-discovery');
 console.log('PASS: legacy UserName/Passwd Base64 encrypted router-origin login, protected WLAN read, persistent session and no stock button');
 const denied=environment('denied');await denied.rpc('c20.discoverUnified');
 r=await denied.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.loginDiagnostic.reason,'VENDOR_LOGIN_REJECTED');
 assert.equal(r.data.loginDiagnostic.vendorRetCode,71233);
 assert.equal(denied.counters().loginRequests,1);assert.equal(denied.counters().readRequests,0);
 const network=environment('network');await network.rpc('c20.discoverUnified');
 r=await network.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.loginDiagnostic.reason,'CGI_NETWORK_OR_NAVIGATION_FAILURE');
 assert.equal(r.data.loginDiagnostic.paramsHttp,200);
 assert.equal(r.data.loginDiagnostic.loginHttp,null,'RSA HTTP 200 must not be reported as login HTTP 200');
 assert.equal(r.data.loginDiagnostic.http,null);
 assert.equal(r.data.loginDiagnostic.errorType,'Error');
 assert.equal(r.data.loginDiagnostic.errorDetail,'C20_OFFSCREEN_HTTP_NETWORK_ERROR');
 assert.equal(r.data.loginDiagnostic.xhrEvent,'NETWORK_ERROR');
 assert.equal(r.data.loginDiagnostic.xhrReadyState,4);
 assert.equal(r.data.loginDiagnostic.xhrElapsedMs,76);
 assert.equal(r.data.loginDiagnostic.frameNavigation,true);
 assert.equal(r.data.loginDiagnostic.packetShapeOk,true);
 assert(!JSON.stringify(r).includes('privatePassword123'), 'never log password');
 assert.equal(network.counters().loginRequests,1);assert.equal(network.counters().readRequests,1);
 assert.equal(r.data.loginDiagnostic.recoveryRead,'UNCONFIRMED');
 assert.equal(r.data.loginDiagnostic.recoveryTokenPresent,false);
 const acknowledgedLost=environment('network-accepted');await acknowledgedLost.rpc('c20.discoverUnified');
 r=await acknowledgedLost.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_VERIFIED');
 assert.equal(r.data.verifiedBy,'OFFSCREEN_ENCRYPTED_PROTECTED_WLAN_READ');
 assert.equal(r.data.phase,'WIFI_EDITOR');
 assert.equal(r.data.loginRecovery,'PROTECTED_READ_AFTER_LOST_REPLY');
 assert.equal(acknowledgedLost.counters().loginRequests,1);
 assert(acknowledgedLost.counters().readRequests>=1);
 console.log('PASS: lost login reply recovered with a protected read and no repeat login');
 const missing=environment('no-cookie');
 await missing.rpc('c20.discoverUnified');
 r=await missing.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.submitted,false,'no credential request when fresh cookie is not obtainable');
 assert.equal(r.data.loginDiagnostic.reason,'COOKIE_BRIDGE_PREFLIGHT_FAILED');
 assert.equal(r.data.loginDiagnostic.cookieBridge,'COOKIE_NOT_PRESENT');
 assert.equal(missing.counters().loginRequests,0,'router must receive ZERO logins');
 assert(!JSON.stringify(r).includes('fixtureFreshSession'), 'no session cookie in diagnostics');
 console.log('PASS: missing RSA session cookie aborts before credential POST, with no retry');
 console.log('PASS: denied and network-error paths never retry or claim protected authentication');
})().catch(err=>{console.error(err);process.exitCode=1});
