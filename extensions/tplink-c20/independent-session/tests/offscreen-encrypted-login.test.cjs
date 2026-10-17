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
 let firstPartyTabs=0,closedFirstPartyTabs=0;
 const cookieHeaders=[],setCookieObservers=[];let issuedCookie=false,cookieRuleInstalled=false;
 let cookieValue=['bootstrap-existing-cookie','bootstrap-cookie-deletion'].includes(mode)?'fixtureOldSession':'fixtureFreshSession',bridgedCookie='';
 if(['bootstrap-existing-cookie','bootstrap-cookie-deletion'].includes(mode))issuedCookie=true;
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
    if(request.command==='login')throw Error('STOCK_BUTTON_CLICK_MUST_NOT_BE_CALLED');
    if(request.command!=='http')throw Error('UNEXPECTED_OFFSCREEN_COMMAND_'+request.command);
    const x=request.args;
    assert(['GET','POST'].includes(x.method));
    if(x.path==='/'){
      rootRequests++;
      if(mode==='bootstrap-existing-cookie'){
        cookieValue='fixtureFreshSession';issuedCookie=true;
        for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/',tabId:-1,
          initiator:'http://192.168.0.1',responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureFreshSession; HttpOnly'}]});
      }else if(mode==='bootstrap-cookie-deletion'){
        for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/',tabId:-1,
          initiator:'http://192.168.0.1',responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureOldSession; Max-Age=0; Path=/'}]});
      }
      return {ok:true,result:{http:200,url:'/',text:authenticated?
        '<script>var token=\"safeToken123\";</script>':'<title>Archer C20 login</title>'}};
    }
    if(x.path==='/cgi/getGDPRParm'){
      paramsRequests++;assert.equal(x.method,'POST');assert.equal(x.body,null);
      // Some router responses issue a cookie before LOGIN. A response with no
      // session cookie must fail closed without opening a first-party tab.
      if(mode==='bootstrap-cookie-deletion'){
        for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/cgi/getGDPRParm',
          tabId:-1,initiator:'http://192.168.0.1',responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureOldSession; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/'}]});
      }else if(!['bootstrap-header','bootstrap-store','bootstrap-existing-cookie','bootstrap-no-cookie'].includes(mode)){
        issuedCookie=true;
        for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/cgi/getGDPRParm',
          tabId:-1,initiator:'http://192.168.0.1',responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureFreshSession; HttpOnly'}]});
      }
      return{ok:true,result:{http:200,url:x.path,text:`var nn="${nn}"; var ee="${ee}"; var seq=858738839;`}};
    }
    if(x.path==='/cgi/getBusy'){
      const headers=cookieRuleInstalled&&bridgedCookie?[{name:'Cookie',value:bridgedCookie}]:[];
      for(const fn of cookieHeaders)fn({url:'http://192.168.0.1/cgi/getBusy',tabId:-1,requestHeaders:headers});
      if(mode==='bootstrap-header'){
        cookieValue='fixtureBusySession';
        for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/cgi/getBusy',
          tabId:-1,initiator:'http://192.168.0.1',responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureBusySession; HttpOnly'}]});
      }
      return {ok:true,result:{http:200,text:'var isLogined=0; var isBusy=0;'}};
    }
    assert.equal(x.path,'/cgi_gdpr');assert.equal(x.method,'POST');
    assert.equal(x.headers['Content-Type'],'text/plain');
    const signature=String(x.body).split('\r\n')[0].slice(5);
    const plain=sigPlain(signature);
    if(plain.includes('key=')&&plain.includes('iv=')){
      if(mode==='bootstrap-header')assert.equal(bridgedCookie,'JSESSIONID=fixtureBusySession',
        'a cookie rotated by the read-only busy probe must be bridged before LOGIN');
      loginRequests++;
      const key=plain.match(/key=([0-9]{16})/),iv=plain.match(/iv=([0-9]{16})/);
      assert(key&&iv);aes={key:key[1],iv:iv[1]};
      const ciphertext=String(x.body).split('\r\n')[1].slice(5);
      const loginBody=decrypt(ciphertext);
      assert.match(loginBody,/\[\/cgi\/login#/);assert.match(loginBody,/username=user\r\npassword=privatePassword123/);
      if(mode==='network'||mode==='network-accepted'){
        if(mode==='network-accepted')authenticated=true;
        frameLoads++;
        return{ok:true,result:{http:0,error:'NETWORK_ERROR',readyState:4,elapsedMs:76}};
      }
      if(mode==='denied')return{ok:true,result:{http:200,text:encrypt('[cgi]0\r\n$.ret=713;\r\n[error]713')}};
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
  action:{onClicked:{addListener(){}}}, tabs:{query:async()=>[],get:async id=>({id,status:'complete'}),
   create:async options=>{firstPartyTabs++;assert.equal(options.active,false);assert.equal(options.url,'http://192.168.0.1/');
    if(mode==='bootstrap-first-party'){issuedCookie=true;cookieValue='fixtureFreshSession'}
    return{id:71,status:'complete'}},remove:async id=>{assert.equal(id,71);closedFirstPartyTabs++},
   onRemoved:{addListener(){}}},
  cookies:{getAll:async({partitionKey})=>partitionKey?[]:(issuedCookie?[{
    name:'JSESSIONID',value:cookieValue,domain:'192.168.0.1',sameSite:'unspecified'}]:[])},
  declarativeNetRequest:{updateSessionRules:async ({addRules})=>{
    cookieRuleInstalled=!!addRules;
    if(addRules?.length)bridgedCookie=addRules[0].action.requestHeaders.find(h=>h.header==='cookie')?.value||'';
  }},
  webRequest:{onSendHeaders:{addListener:fn=>cookieHeaders.push(fn)},
    onHeadersReceived:{addListener:fn=>setCookieObservers.push(fn)},onCompleted:{addListener(){}},onErrorOccurred:{addListener(){}}},
  offscreen:{createDocument:async()=>{
    iframe=true;
    if(['bootstrap-header','bootstrap-store'].includes(mode)){
      issuedCookie=true;cookieValue='fixtureFreshSession';
      if(mode==='bootstrap-header')for(const fn of setCookieObservers)fn({
        url:'http://192.168.0.1/',tabId:-1,type:'sub_frame',
        initiator:'chrome-extension://'+'a'.repeat(32),responseHeaders:[
          {name:'Set-Cookie',value:'JSESSIONID=fixtureFreshSession; HttpOnly'}]});
    }
  }},
  storage:{session:{get:async k=>({[k]:saved.get(k)}),set:async v=>{for(const [k,x] of Object.entries(v))saved.set(k,x)},remove:async k=>saved.delete(k)}}
 };
 const ctx=vm.createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,
  AbortController,setTimeout:(cb,ms)=>setTimeout(cb,ms>800?2:ms),clearTimeout,console,btoa:global.btoa,atob:global.atob});
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(content(name),ctx,{filename:name}));
 vm.runInContext(content('background.js'),ctx,{filename:'background.js'});
 const rpc=(type,args={})=>new Promise(resolve=>{
  assert(runtimeHandler({type,...args},{url:chrome.runtime.getURL('setup.html')},resolve));
 });
 return{rpc,counters:()=>({loginRequests,readRequests,paramsRequests,firstPartyTabs,closedFirstPartyTabs})};
}
(async()=>{
 const success=environment();
 let r=await success.rpc('c20.discoverUnified');assert(r.ok,r.error);assert.equal(r.data.phase,'LOGIN');
 r=await success.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_VERIFIED',JSON.stringify(r.data.loginDiagnostic));
 assert.equal(r.data.verifiedBy,'OFFSCREEN_ENCRYPTED_PROTECTED_WLAN_READ');
 assert.equal(r.data.phase,'WIFI_EDITOR');
 assert.equal(r.data.radio.ssid24,'WIFI_24');
 assert.equal(r.data.transport,'OFFSCREEN_ROUTER_ORIGIN_RPC');
 assert.equal(success.counters().loginRequests,1);
 assert(success.counters().readRequests>=1,'protected read must follow encrypted login');
 assert(!JSON.stringify(r).includes('privatePassword123'));
 for(const mode of ['bootstrap-header','bootstrap-store','bootstrap-existing-cookie']){
  const boot=environment(mode);await boot.rpc('c20.discoverUnified');
  const logged=await boot.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
  assert(logged.ok,logged.error);assert.equal(logged.data.outcome,'LOGIN_VERIFIED',mode);
  assert.equal(logged.data.phase,'WIFI_EDITOR',mode);
  assert.equal(boot.counters().loginRequests,1,mode);
  assert(boot.counters().readRequests>=1,mode+' must confirm protected WLAN data');
  const expectedSource=mode==='bootstrap-header'?'FRESH_OFFSCREEN_ROOT_SET_COOKIE':
    mode==='bootstrap-existing-cookie'?'FRESH_OFFSCREEN_ROOT_XHR_COOKIE':'FRESH_OFFSCREEN_ROOT_COOKIE_STORE';
  assert.equal(logged.data.loginDiagnostic.cookieBridgeSeedSource,expectedSource);
  assert(!JSON.stringify(logged).includes('fixtureFreshSession'));
  assert(!JSON.stringify(logged).includes('fixtureBusySession'));
 }
 const noVisibleFallback=environment('bootstrap-no-cookie');
 await noVisibleFallback.rpc('c20.discoverUnified');
 const blocked=await noVisibleFallback.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(blocked.ok,blocked.error);assert.equal(blocked.data.outcome,'LOGIN_PENDING',JSON.stringify({data:blocked.data,counters:noVisibleFallback.counters()}));
 assert.equal(blocked.data.loginDiagnostic.reason,'COOKIE_BRIDGE_PREFLIGHT_FAILED');
 assert.equal(noVisibleFallback.counters().firstPartyTabs,0,'cookie bootstrap must never open a visible tab');
 assert.equal(noVisibleFallback.counters().loginRequests,0,'missing fresh cookie must fail closed before credentials');
 const deletion=environment('bootstrap-cookie-deletion');await deletion.rpc('c20.discoverUnified');
 const deletionResult=await deletion.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(deletionResult.ok,deletionResult.error);assert.equal(deletionResult.data.outcome,'LOGIN_PENDING');
 assert.equal(deletionResult.data.loginDiagnostic.reason,'COOKIE_BRIDGE_PREFLIGHT_FAILED');
 assert.equal(deletionResult.data.loginDiagnostic.wireEvidence.find(x=>x.route==='ROOT'&&x.phase==='RESPONSE').sessionCookieEvidence,'EXPIRED_OR_DELETION');
 assert.equal(deletionResult.data.loginDiagnostic.wireEvidence.find(x=>x.route==='PARAMS'&&x.phase==='RESPONSE').sessionCookieEvidence,'EXPIRED_OR_DELETION');
 assert.equal(deletion.counters().loginRequests,0,'deletion Set-Cookie must not allow password submission');
 console.log('PASS: expired/deletion JSESSIONID responses are diagnosed and never bridged as fresh cookies');
 console.log('PASS: first offscreen JSESSIONID and busy-response rotation bridge through one login and protected WLAN read');
 // Repeated state discovery after login must reuse protected session, not submit login again.
 r=await success.rpc('c20.discoverUnified');assert(r.ok,r.error);
 assert.equal(r.data.phase,'WIFI_EDITOR');assert.equal(success.counters().loginRequests,1);
 console.log('PASS: one encrypted router-origin login, protected WLAN read, persistent session and no stock button');
 const denied=environment('denied');await denied.rpc('c20.discoverUnified');
 r=await denied.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.loginDiagnostic.reason,'VENDOR_LOGIN_REJECTED');
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
 console.log('PASS: denied and network-error paths never retry or claim protected authentication');
})().catch(err=>{console.error(err);process.exitCode=1});
