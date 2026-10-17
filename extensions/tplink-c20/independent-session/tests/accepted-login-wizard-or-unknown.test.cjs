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
 const cookieHeaders=[],setCookieObservers=[],networkErrorObservers=[];let issuedCookie=false,cookieRuleInstalled=false;
 const saved=new Map(); let refreshes=0;
 let aes=null,stage='LOGIN_FORM',ready=false,frameLoads=1,authenticated=false,rootRequests=0,stockSessionActive=false;
 const encrypt=text=>{const ci=createCipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([ci.update(text),ci.final()]).toString('base64')};
 const decrypt=text=>{const ci=createDecipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([ci.update(Buffer.from(text,'base64')),ci.final()]).toString('utf8')};
 const chrome={
  runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,
   onInstalled:{addListener(){}},onMessage:{addListener:f=>runtimeHandler=f},
   getContexts:async()=>iframe?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
   sendMessage:async request=>{
    assert.equal(request.type,'C20_OFFSCREEN_OPERATION');
    if(request.command==='frameStatus')return{ok:true,result:{loaded:true,frameLoads}};
    if(request.command==='refresh'){refreshes++;frameLoads++;stage=(mode==='delayed-configured'||mode==='native-configured')?'POSSIBLY_AUTHENTICATED':mode==='refresh-recovery'?'MODEL_NOT_CONFIRMED':(mode==='wizard'||(mode==='delayed-wizard'&&refreshes>=1))?'QUICK_SETUP_ACTIVE':'LOGIN_FORM';return{ok:true,result:{refreshed:true,frameLoads}};}
    if(request.command==='quickStage')return{ok:true,result:{stage:stage==='QUICK_SETUP_ACTIVE'?'ISP_WAN':stage,markers:{isp:stage==='QUICK_SETUP_ACTIVE'}}};
    if(request.command==='pageState')return{ok:true,result:{stage,diagnostic:{storageAccess:'DENIED',cookieAccess:'NO_COOKIE_VISIBLE'}}};
    if(request.command==='inspect')return{ok:true,result:{stage:(mode==='native-configured'&&stage==='POSSIBLY_AUTHENTICATED')?'CONFIGURED_AUTHENTICATED':stage,readConfirmed:ready||(mode==='native-configured'&&stage==='POSSIBLY_AUTHENTICATED'),
     ...((ready||(mode==='native-configured'&&stage==='POSSIBLY_AUTHENTICATED'))?{radio:{ssid24:'WIFI_24',ssid5:'WIFI_5',stack24:'1,3,0,0,0,0',stack5:'1,4,0,0,0,0'}}:{})}};
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
      for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/cgi/getGDPRParm',
        tabId:-1,initiator:'http://192.168.0.1',responseHeaders:[
        {name:'Set-Cookie',value:'JSESSIONID=fixtureFreshSession; HttpOnly'}]});
      issuedCookie=true;
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
      if(mode==='network-login')return{ok:true,result:{http:0,error:'NETWORK_ERROR',readyState:4,elapsedMs:65}};
      authenticated=true;
      stage=mode==='wizard'?'QUICK_SETUP_ACTIVE':'LOGIN_FORM'; // wizard can already be visible after stock login
      return{ok:true,result:{http:200,text:encrypt('[cgi]0\r\n$.ret=0;\r\n[error]0')}};
    }
    readRequests++;
    assert(aes,'read without initial crypto handshake');
    const readHeaders=cookieRuleInstalled?[{name:'Cookie',value:'JSESSIONID=fixtureFreshSession'}]:[];
    for(const fn of cookieHeaders)fn({url:'http://192.168.0.1/cgi_gdpr',tabId:-1,
      initiator:'chrome-extension://'+'a'.repeat(32),requestHeaders:readHeaders});
    if(!authenticated)return{ok:true,result:{http:403,text:'NOT_LOGGED_IN'}};
    if((mode==='refresh-recovery'||mode==='cookie-store-loses-after-login')&&readRequests===1)return{ok:true,result:{http:0,error:'NETWORK_ERROR',elapsedMs:25,readyState:4}};
    if(mode==='stock-session-recovers'&&(readRequests===1||(readRequests===2&&!stockSessionActive)))return{ok:true,result:{http:0,error:'NETWORK_ERROR',elapsedMs:163,readyState:4}};
    if(mode==='transport-broken'){
      for(const fn of networkErrorObservers)fn({url:'http://192.168.0.1/cgi_gdpr',error:'net::ERR_CONNECTION_RESET'});
      return{ok:true,result:{http:0,error:'NETWORK_ERROR',elapsedMs:25,readyState:4}};
    }
    assert.equal(x.headers.TokenID,undefined,'stock TP-Link tpAjax has TokenID header disabled');
    const body=decrypt(String(x.body).split('\r\n')[1].slice(5));
    if(body.includes('LAN_WLAN')&&(mode==='wizard'||mode==='uncertain'||mode==='delayed-wizard'||(mode==='delayed-configured'&&refreshes===0)))return{ok:true,result:{http:200,text:encrypt('[error]0\r\n')} };
    if(body.includes('LAN_WLAN')){
      for(const fn of setCookieObservers)fn({url:'http://192.168.0.1/cgi_gdpr',tabId:-1,
        type:'xmlhttprequest',initiator:'chrome-extension://'+'a'.repeat(32),statusCode:200,responseHeaders:[]});
      return{ok:true,result:{http:200,text:encrypt(
      '[LAN_WLAN#1,3,0,0,0,0#0,0,0,0,0,0]0,4\r\nSSID=WIFI_24\r\nX_TP_Band=2.4GHz\r\n'+
      '[LAN_WLAN#1,4,0,0,0,0#0,0,0,0,0,0]1,4\r\nSSID=WIFI_5\r\nX_TP_Band=5GHz\r\n')}};
    }
    if(body.includes('IGD_DEV_INFO'))return{ok:true,result:{http:200,text:encrypt('modelName=Archer C20\r\nhardwareVersion=Archer C20 v5 00000002\r\nsoftwareVersion=3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n')}};
    return{ok:true,result:{http:200,text:encrypt('[WAN_IP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,2\r\nAddressingType=DHCP')}};
   }},
  action:{onClicked:{addListener(){}}}, tabs:{query:async()=>[],onRemoved:{addListener(){}}},
  cookies:{getAll:async({partitionKey})=>partitionKey||
    (mode==='cookie-store-loses-after-login'&&loginRequests>0)?[]:(issuedCookie?[{
    name:'JSESSIONID',value:'fixtureFreshSession',domain:'192.168.0.1',sameSite:'unspecified'}]:[])},
  declarativeNetRequest:{updateSessionRules:async ({addRules})=>{cookieRuleInstalled=!!addRules;}},
  webRequest:{onSendHeaders:{addListener:fn=>cookieHeaders.push(fn)},
    onHeadersReceived:{addListener:fn=>setCookieObservers.push(fn)},onCompleted:{addListener(){}},onErrorOccurred:{addListener:fn=>networkErrorObservers.push(fn)}},
  offscreen:{createDocument:async()=>{iframe=true}},
  storage:{session:{get:async key=>({[key]:saved.get(key)}),set:async obj=>{for(const [k,v] of Object.entries(obj))saved.set(k,v)},remove:async key=>saved.delete(key)}}
 };
 const ctx=vm.createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,
  AbortController,setTimeout:(cb,ms)=>setTimeout(cb,ms>800?2:ms),clearTimeout,console,btoa:global.btoa,atob:global.atob});
 ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(content(name),ctx,{filename:name}));
 vm.runInContext(content('background.js'),ctx,{filename:'background.js'});
 const rpc=(type,args={})=>new Promise(resolve=>{
  assert(runtimeHandler({type,...args},{url:chrome.runtime.getURL('setup.html')},resolve));
 });
 return{rpc,counters:()=>({loginRequests,readRequests,paramsRequests,refreshes}),saved,
  enableStockSession:()=>{stockSessionActive=true;},
  restartWorker:()=>vm.runInContext("session={crypto:null,token:null,identity:null,radio:null,wan:null,lastRead:0};transport='unselected';",ctx)};
}

(async()=>{
 const wizard=environment('wizard');
 let r=await wizard.rpc('c20.discoverUnified');assert(r.ok,r.error);assert.equal(r.data.phase,'LOGIN');
 r=await wizard.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_ROUTED_QUICK_SETUP');
 assert.equal(r.data.phase,'QUICK_SETUP');
 assert.equal(r.data.verified,false,'wizard not a configured read');
 assert.equal(r.data.loginDiagnostic.wizardStep,'ISP_WAN');
 assert.equal(wizard.counters().loginRequests,1);
 assert.equal(wizard.counters().refreshes,0);
 assert.equal(wizard.saved.has('c20PendingAcceptedLoginStateV1'),false);
 assert(!JSON.stringify(r).includes('privatePassword123'));
 console.log('PASS: zero-ack login + WLAN-unready routes to REAL Quick Setup, exactly one refresh, one login');
 const uncertain=environment('uncertain');
 r=await uncertain.rpc('c20.discoverUnified');assert(r.ok,r.error);
 r=await uncertain.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(r.data.loginDiagnostic.vendorRetCode,0);
 assert.equal(r.data.loginDiagnostic.reason,'LOGIN_ZERO_ACK_SINGLE_READ_UNCONFIRMED');
 assert.equal(r.data.loginDiagnostic.postLoginStage,'LOGIN_FORM');
 assert.equal(uncertain.counters().loginRequests,1);
 assert.equal(uncertain.counters().readRequests,1,'one protected WLAN read, no retries');
 assert.equal(uncertain.counters().refreshes,1,'accepted login navigates the hidden stock page once');
 assert(uncertain.saved.has('c20PendingAcceptedLoginStateV1'));
 r=await uncertain.rpc('c20.discoverUnified');assert(r.ok,r.error);assert.equal(r.data.phase,'VERIFY_STATE');
 // A real user click on "Refresh state" reloads the hidden iframe ONCE, not
 // the password request, and preserves unresolved-auth protection.
 const refreshBefore=uncertain.counters().refreshes;
 r=await uncertain.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(r.data.stateRefresh.mode,'FRAME_RELOADED');
 assert.equal(r.data.stateRefresh.before,'LOGIN_FORM');
 assert.equal(r.data.stateRefresh.after,'LOGIN_FORM');
 assert.equal(r.data.stateRefresh.noPasswordSent,true);
 assert.equal(uncertain.counters().refreshes,refreshBefore+1);
 assert.equal(uncertain.counters().loginRequests,1);
 assert.equal(uncertain.saved.has('c20PendingAcceptedLoginStateV1'),true);
 assert.equal(uncertain.saved.has('c20PendingLoginCryptoContextV1'),true,
   'one bounded retry keeps only the transient crypto context');
 assert.equal(r.data.stateRefresh.sessionTrace.cryptoRestored,true);
 assert.equal(r.data.stateRefresh.sessionTrace.readWire[0].cookiePresent,true,
   'wire trace records cookie presence without exposing its value');
 assert(!JSON.stringify(r.data.stateRefresh.sessionTrace).includes('fixtureFreshSession'));
 const consumedReadCount=uncertain.counters().readRequests;
 r=await uncertain.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'UNCONFIRMED');
 assert.equal(uncertain.counters().readRequests,consumedReadCount+1,'one explicit retry is allowed');
 assert.equal(uncertain.saved.has('c20PendingLoginCryptoContextV1'),false,
   'the second failed read clears transient crypto material');
 const maxReadCount=uncertain.counters().readRequests;
 r=await uncertain.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshReason,'EXPLICIT_READ_LIMIT_REACHED');
 assert.equal(uncertain.counters().readRequests,maxReadCount,'further clicks cannot exceed the two-read cap');
 r=await uncertain.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.ok,false,'must block second credential submission while zero-ack state unresolved');
 assert.equal(uncertain.counters().loginRequests,1);
 console.log('PASS: ambiguous accepted login prompts state verification, survives rescan, never retries password');
 const stockRecovery=environment('stock-session-recovers');
 r=await stockRecovery.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await stockRecovery.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.data.phase,'VERIFY_STATE');assert.equal(stockRecovery.counters().readRequests,1);
 r=await stockRecovery.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'UNCONFIRMED');
 assert.equal(r.data.stateRefresh.sessionTrace.readWire[0].cookiePresent,true);
 stockRecovery.enableStockSession(); // user logs in via the stock TP-Link page
 r=await stockRecovery.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'CONFIRMED');
 assert.equal(stockRecovery.counters().readRequests,3);
 assert.equal(stockRecovery.counters().loginRequests,1,'stock-session recovery never repeats LOGIN');
 r=await stockRecovery.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(stockRecovery.counters().readRequests,3,'confirmed session is not reread');
 console.log('PASS: one bounded read retry after stock WebGUI login confirms WLAN without another LOGIN');
 const cookieStoreLost=environment('cookie-store-loses-after-login');
 r=await cookieStoreLost.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await cookieStoreLost.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.data.phase,'VERIFY_STATE');assert.equal(cookieStoreLost.counters().readRequests,1);
 assert.equal(cookieStoreLost.saved.get('c20PendingLoginCryptoContextV1').routerJsessionid,'fixtureFreshSession',
   'only the fresh router-issued cookie is retained in transient extension session storage');
 r=await cookieStoreLost.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'CONFIRMED',
   'explicit read can use its own fresh cookie if Chrome has dropped it from the cookie store');
 assert.equal(r.data.stateRefresh.sessionTrace.before.cookieJar.unpartitioned.count,0);
 assert.equal(cookieStoreLost.counters().loginRequests,1,'cookie recovery never repeats LOGIN');
 assert(!JSON.stringify(r).includes('fixtureFreshSession'),'cookie is never returned in diagnostics');
 console.log('PASS: protected read restores only its own short-lived JSESSIONID after Chrome drops the cookie');
 const ambiguous=environment('network-login');
 r=await ambiguous.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await ambiguous.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(ambiguous.counters().loginRequests,1);
 assert(ambiguous.saved.has('c20PendingAcceptedLoginStateV1'),'lock written before ambiguous POST');
 r=await ambiguous.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.ok,false,'second password POST must be denied after lost reply');
 assert.equal(ambiguous.counters().loginRequests,1);
 console.log('PASS: TCP loss during credential POST persists a no-resend fence across later clicks');
 const limited=environment('denied');
 for(let attempt=1;attempt<=3;attempt++){
   r=await limited.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
   r=await limited.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
   assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_PENDING');
   assert.equal(limited.counters().loginRequests,attempt);
 }
 r=await limited.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);
 assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.submitted,false,'the fourth credential submission was blocked before POST');
 assert.match(r.data.loginDiagnostic.reason,/C20_LOGIN_RATE_LIMIT/);
 assert.equal(limited.counters().loginRequests,3,'never reach firmware five-attempt lockout via this UI');
 console.log('PASS: three password POSTs / ten minutes maximum; fourth attempt blocked before transmission');
 const broken=environment('transport-broken');
 r=await broken.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await broken.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);
 assert.equal(r.data.outcome,'LOGIN_PENDING');
 assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(broken.counters().loginRequests,1,'only one password POST');
 assert.equal(broken.counters().readRequests,1,'network error must STOP protected reads');
 assert.equal(broken.counters().refreshes,1,'one stock navigation follows accepted login, none after read failure');
 assert.equal(r.data.loginDiagnostic.noAutoReadRetry,true);
 assert.equal(r.data.loginDiagnostic.readError,'C20_OFFSCREEN_HTTP_NETWORK_ERROR');
 assert.equal(r.data.loginDiagnostic.loginSubmitIntentCount,1);
 assert.equal(r.data.loginDiagnostic.operationTrace.filter(x=>x.operation==='LOGIN').length,1);
 assert.equal(r.data.loginDiagnostic.operationTrace.filter(x=>x.operation==='READ_WLAN').length,1);
 assert.equal(r.data.loginDiagnostic.operationTrace.filter(x=>x.operation==='READ_WLAN')[0].status,'NETWORK_ERROR');
 r=await broken.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'UNCONFIRMED');
 assert.equal(broken.counters().readRequests,2,'one explicit read after the failed login-time read');
 const wireError=r.data.stateRefresh.sessionTrace.readWire.find(x=>x.phase==='ERROR');
 assert.equal(wireError?.route,'CGI');assert.equal(wireError?.outcome,'NETWORK_ERROR');
 assert.equal(wireError?.netError,'net::ERR_CONNECTION_RESET',
   'explicit read exposes only the browser network error code, not headers or body');
 assert(!JSON.stringify(r).includes('privatePassword123'));
 r=await broken.rpc('c20.discoverUnified');assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(broken.counters().readRequests,2,'passive re-discovery cannot issue extra CGI');
 console.log('PASS: real-like ERR_EMPTY_RESPONSE emits LOGIN/READ trace and exactly one failed WLAN CGI; no hidden retries');
 const configured=environment('delayed-configured');
 r=await configured.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await configured.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.data.phase,'VERIFY_STATE');
 assert.equal(configured.counters().readRequests,0,'failed native stage must not cascade to encrypted read');
 r=await configured.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.phase,'WIFI_EDITOR','one user-clicked refresh can verify configured WLAN');
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'CONFIRMED');
 assert.equal(configured.counters().readRequests,1,'one explicit protected refresh');
 assert.equal(configured.counters().loginRequests,1);
 assert(!configured.saved.has('c20PendingAcceptedLoginStateV1'));
 console.log('PASS: explicit state refresh can confirm configured session with one extra protected read and no login');
 const recovery=environment('refresh-recovery');
 r=await recovery.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await recovery.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert.equal(r.data.phase,'VERIFY_STATE');assert.equal(r.data.loginDiagnostic.readError,'C20_OFFSCREEN_HTTP_NETWORK_ERROR');
 assert.equal(recovery.counters().readRequests,1);
 assert(recovery.saved.has('c20PendingLoginCryptoContextV1'),'transient AES recovery context survives worker suspension');
 assert(!JSON.stringify(recovery.saved.get('c20PendingLoginCryptoContextV1')).includes('privatePassword123'),
   'only derived session material is kept; never the password');
 recovery.restartWorker();
 r=await recovery.rpc('c20.refreshUnifiedState');assert(r.ok,r.error);
 assert.equal(r.data.stateRefresh.after,'MODEL_NOT_CONFIRMED');
 assert.equal(r.data.stateRefresh.protectedRefreshRead,'CONFIRMED',
   'explicit read is allowed from an unclassified frame when the pending AES context and router cookie exist');
 assert.equal(recovery.counters().readRequests,2,'exactly one explicit protected retry after the initial failed read');
 assert.equal(recovery.counters().loginRequests,1,'state recovery never replays credentials');
 assert.equal(recovery.saved.has('c20PendingLoginCryptoContextV1'),false,'confirmed read clears transient crypto material');
 assert(!recovery.saved.has('c20PendingAcceptedLoginStateV1'));
 console.log('PASS: explicit read-only refresh restores transient AES context after worker restart and confirms WLAN without LOGIN retry');
 const native=environment('native-configured');
 r=await native.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await native.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.outcome,'LOGIN_VERIFIED');
 assert.equal(r.data.phase,'WIFI_EDITOR');
 assert.equal(r.data.transport,'OFFSCREEN_VENDOR_ORIGIN',
   'verified stock postlogin page should enable existing vendor Wi-Fi path');
 assert.equal(r.data.loginDiagnostic.reason,'STOCK_POSTLOGIN_PROTECTED_WLAN_READ_CONFIRMED');
 assert.equal(native.counters().loginRequests,1);
 assert.equal(native.counters().readRequests,0,
   'do not send additional raw AES CGI when native stock reader proved WLAN');
 assert.equal(native.counters().refreshes,1);
 assert(!native.saved.has('c20PendingAcceptedLoginStateV1'));
 console.log('PASS: accepted login navigates offscreen frame and verifies native WLAN without extra CGI or repeated password');
 const late=environment('delayed-wizard');
 r=await late.rpc('c20.discoverUnified');assert.equal(r.data.phase,'LOGIN');
 r=await late.rpc('c20.continueUnified',{confirm:true,adminPassword:'privatePassword123'});
 assert(r.ok,r.error);assert.equal(r.data.phase,'QUICK_SETUP','stock wizard discovered during postlogin navigation');
 assert.equal(late.counters().loginRequests,1,'no second password submission');
 assert.equal(late.counters().refreshes,1);
 assert.equal(late.saved.has('c20PendingAcceptedLoginStateV1'),false);
 console.log('PASS: explicit read-only refresh recovers late wizard without second login');
})().catch(e=>{console.error(e);process.exitCode=1});
