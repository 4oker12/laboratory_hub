'use strict';
const el=id=>document.getElementById(id),journal=[];
let state=null,busy=false,baseline=null,pending=false,adminPending=false,wifiStage=null,loginPending=false;
let lastLoginSchemaDiagnostic=null;
let lastScan=0, reconnectTimer=null, reconnectAttempts=0;
const BUILD_ID='20261028-COOKIE-SESSION-CACHE-08';
// At most 12 read-only checks after a Wi-Fi/WAN interruption; no interval.
const reconnectLimit=12;
function scheduleReconnect(){
 if(reconnectTimer||busy||reconnectAttempts>=reconnectLimit)return;
 reconnectTimer=setTimeout(async()=>{
   reconnectTimer=null;if(busy){scheduleReconnect();return;}
   reconnectAttempts++;
   const wasFactoryTransition=!!state?.factoryTransitionPending;
   try{
     await discover();
     // The first admin password leads to the stock wizard automatically.
     // Resume it only after a REAL wizard stage was observed, never after
     // a transient login form or an ambiguous password submission.
     if(wasFactoryTransition && state?.phase==='QUICK_SETUP' &&
       !state.factoryTransitionPending && !state.quickAppliedPending){
       log('FACTORY_WIZARD_DETECTED autoContinue=true');
       await action(driveQuick);
       return;
     }
     if(state?.phase==='WIFI_EDITOR'||state?.phase==='LOGIN')return;
   }catch(e){log('RECONNECT_CHECK '+reconnectAttempts+' '+(e?.message||'UNAVAILABLE').slice(0,110));}
   if(state?.factoryTransitionPending || state?.quickAppliedPending || state?.phase==='QUICK_SETUP')scheduleReconnect();
 },2500);
}
function maybeReconnect(){
 if(Date.now()-lastScan<1200||busy)return;
 if(state?.quickAppliedPending||state?.phase==='QUICK_SETUP'||state?.phase==='LOGIN'){
   action(discover);
 }
}
window.addEventListener('online',maybeReconnect);
window.addEventListener('focus',maybeReconnect);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)maybeReconnect()});
const show=(id,on)=>el(id).classList.toggle('hidden',!on);
function log(msg){journal.push(new Date().toLocaleTimeString('ru-RU')+' '+msg);el('log').textContent=journal.join('\n')}
log('ROUTERLAB_BUILD_ID '+BUILD_ID);
function notify(msg,ok=false){el('status').textContent=msg;el('pill').textContent=ok?'Подключено':'Требует действия';el('pill').style.background=ok?'#e5f6ed':'#fff0e1';el('pill').style.color=ok?'#18744d':'#8e542a'}
async function rpc(type,args={}){let r=await chrome.runtime.sendMessage({type,...args});if(!r?.ok)throw Error(r?.error||'C20_NO_RESULT');return r.data}
async function action(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn()}catch(e){notify(e.message||String(e));log('ERROR '+(e.message||String(e)))}finally{busy=false;render();if(state?.factoryTransitionPending)scheduleReconnect()}}
function render(){
 const phase=state?.phase||'UNKNOWN';
 show('first',phase==='CREATE_ADMIN');show('known',phase==='LOGIN');
 show('stateCheck',phase==='VERIFY_STATE'||phase==='AUTH_LOCKED');
 show('confirmFactoryLogin',!!state?.factoryLoginStalled);
 show('quick',phase==='QUICK_SETUP');show('editor',phase==='WIFI_EDITOR');
 show('verify',pending);
 show('vendor',false); // RouterLab's main UX never asks the subscriber to open stock TP-Link.
 show('showVendor',!!state?.routerTabUsed);
 show('reboot',pending&&wifiStage==='CONFIG_SAVED_AWAIT_APPLY');
 show('confirmWifi',pending&&!!wifiStage?.startsWith('REBOOT_CONTROL_'));
 const labels={CREATE_ADMIN:'Создать пароль и настроить',LOGIN:'Войти',QUICK_SETUP:'Продолжить настройку',WIFI_EDITOR:'Сохранить Wi-Fi',UNKNOWN:'Распознать роутер'};
 el('primary').textContent=state?.factoryTransitionPending?'Ожидаем Quick Setup':labels[phase]||labels.UNKNOWN;
 el('primary').disabled=busy||phase==='VERIFY_STATE'||phase==='AUTH_LOCKED'||pending||adminPending||loginPending||!!state?.factoryTransitionPending||!!state?.requiresVendorWrite||!!state?.quickAppliedPending&&phase==='QUICK_SETUP';
 el('retry').disabled=busy;
 el('inspectBusy').disabled=busy;
 el('confirmFactoryLogin').disabled=busy;
 el('verify').disabled=busy||!pending;
 for(const id of ['vendor','showVendor','reboot','confirmWifi'])el(id).disabled=busy;
 if(phase==='WIFI_EDITOR'&&baseline){
   for(const id of ['ssid24','ssid5','changeKey'])el(id).disabled=busy||pending;
 }
}
function adapt(s){
 state=s;adminPending=!!s?.pendingAdminCreate;if(s?.phase!=='LOGIN')loginPending=false;lastScan=Date.now();
 if(s.quickSetupVerified){reconnectAttempts=reconnectLimit;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}}
 if(s?.phase==='TRANSPORT_SETUP'){
   notify('RouterLab не смог установить защищённое соединение с Archer C20 ('+(s.reason||'UNKNOWN')+'). Попробуйте «Обновить состояние». Пароль не отправлялся.');
   el('substatus').textContent='SW без вкладки: '+(s.transportEvidence?.reason||'Проверка не пройдена');
   log('DIRECT_PROBE '+(s.transportEvidence?.reason||'NOT_AVAILABLE')+' paramsHttp='+(s.transportEvidence?.paramsHttp??'none'));
   const diag=s.transportEvidence;
   if(Array.isArray(diag?.paramsAttempts))log('GDPR_VARIANTS '+diag.paramsAttempts.map(x=>x.variant+':'+x.http+(x.valid?':valid':'')).join(' | '));
   if(Array.isArray(diag?.headerAttempts)&&diag.headerAttempts.length)log('ORIGIN_VARIANTS '+diag.headerAttempts.map(x=>x.variant+':'+x.http+(x.valid?':valid':'')+(x.error?':'+x.error:'')).join(' | '));
   if(diag?.cookieDiagnostic)log('COOKIE_PRESENCE api='+diag.cookieDiagnostic.apiAvailable+' present='+diag.cookieDiagnostic.present+' count='+(diag.cookieDiagnostic.count??'unknown'));
   if(diag?.offscreenDiagnostic)log('OFFSCREEN_GDPR http='+(diag.offscreenDiagnostic.gdprHttp??'none')+' valid='+!!diag.offscreenDiagnostic.gdprValid+' status='+(diag.offscreenDiagnostic.gdprStatus||'UNKNOWN')+' transport=ROUTER_ORIGIN_XHR');
   if(diag?.offscreenDiagnostic)log('OFFSCREEN_VENDOR '+diag.offscreenDiagnostic.status+' vendorStatus='+(diag.offscreenDiagnostic.vendorStatus||'none')+' readConfirmed='+!!diag.offscreenDiagnostic.readConfirmed+' bands='+String(diag.offscreenDiagnostic.has24===true)+'/'+String(diag.offscreenDiagnostic.has5===true)+' count='+(diag.offscreenDiagnostic.recordCount??'none')+(diag.offscreenDiagnostic.detail?' detail='+diag.offscreenDiagnostic.detail:''));
   render();return;
 }
  if(s?.transportEvidence?.paramsVariant)log('SW_GDPR_PARAMS variant='+s.transportEvidence.paramsVariant+' verifiedRSA=true');
  if(s?.transportEvidence?.headerSelectedMode)log('SW_ORIGIN_MODE '+s.transportEvidence.headerSelectedMode+' (RSA only; login still unverified)');
  if(s?.phase==='WIFI_EDITOR')el('wanStatus').textContent=s.wanType==='DHCP'?
   'WAN: динамический IP (DHCP), подтверждён чтением. Изменение типа WAN требует отдельной проверки штатного контракта TP-Link.':
   'WAN: тип не подтверждён. Автоматическая запись WAN сейчас заблокирована, чтобы не отключить интернет.';
 if(s?.radio){
   baseline={ssid24:s.radio.ssid24,ssid5:s.radio.ssid5};
   if(s.phase==='WIFI_EDITOR'){el('ssid24').value=baseline.ssid24;el('ssid5').value=baseline.ssid5;}
 }
 const messages={VERIFY_STATE:'Пароль отправлен один раз, но защищённое чтение не подтвердило сессию RouterLab. Проверим состояние без повторного входа.',AUTH_LOCKED:'TP-Link заблокировал вход после нескольких попыток. Дождитесь окончания таймера.',CREATE_ADMIN:'Новый Archer: требуется создать первый пароль администратора.',LOGIN:'Пароль администратора уже создан. Для входа нужен пароль.',QUICK_SETUP:'Пароль создан. Quick Setup ещё не завершён.',WIFI_EDITOR:'Роутер настроен. Можно изменить имя и пароль Wi-Fi.'};
 const status=s.factoryTransitionPending?'Пароль администратора отправлен. Ждём штатный Quick Setup; обычный вход и повторное создание пароля запрещены.':s.requiresVendorWrite?(s.transport==='OFFSCREEN_ROUTER_ORIGIN_RPC'?'Вход без окна подтверждён защищённым чтением Wi-Fi. Запись по новому каналу пока заблокирована до физического подтверждения контракта.':'Service Worker прочитал конфигурацию. Запись через прямой CGI ещё не подтверждена; включите штатную сессию только если хотите изменить Wi-Fi.'):s.quickSetupVerified?'Первоначальная настройка завершена: WAN DHCP и Wi-Fi подтверждены чтением.':
    s.quickAppliedPending?(s.phase==='LOGIN'?'Параметры отправлены. Подключитесь к новой Wi-Fi сети и введите пароль администратора для проверки.':
     s.phase==='QUICK_SETUP'?'Сохранение отправлено. Возможна перезагрузка Wi-Fi. Не запускайте мастер повторно. После переподключения нажмите «Обновить состояние».':
     'Сохранение отправлено. Нужна повторная проверка WAN и Wi-Fi после переподключения.'):
    adminPending?'Проверяем, создан ли первый пароль. Повторная отправка заблокирована.':messages[s.phase]||'Требуется проверка состояния.';
 notify(s.phase==='LOGIN'&&s.previousNativeWizard?
   'Quick Setup был обнаружен в открытой штатной вкладке TP-Link. После её закрытия RouterLab видит собственную форму входа. Штатная сессия не переносится автоматически: для продолжения без штатной вкладки войдите здесь.':
   status,!!s.quickSetupVerified||!!s.verified&&!adminPending&&!s.quickAppliedPending);
 el('substatus').textContent=s.transport==='OFFSCREEN_ROUTER_ORIGIN_RPC'?'Зашифрованный router-origin XHR внутри RouterLab — без окна TP-Link.':s.transport==='OFFSCREEN_VENDOR_ORIGIN'?'Штатный контекст TP-Link внутри RouterLab (без отдельного окна).':s.routerTabUsed?'Штатная сессия TP-Link (отдельное окно).':s.directOnly?'Service Worker: прямое чтение без вкладки.':'Прямая проверка роутера.';
 if(s.previousNativeWizard&&s.phase==='LOGIN')log('CONTEXT_SWITCH previous=NATIVE_TAB_WIZARD now=OFFSCREEN_LOGIN nativeAuthNotConfirmed=true');
 if(s.transport==='OFFSCREEN_VENDOR_ORIGIN'||s.transport==='OFFSCREEN_ROUTER_ORIGIN_RPC')log('OFFSCREEN_ROUTE phase='+s.phase+' protected='+!!s.verified+' radio='+!!s.radio);
 if(s.phase==='VERIFY_STATE'||s.phase==='AUTH_LOCKED')log('STATE_CHECK evidence='+(s.evidence||'UNKNOWN')+' noResend=true');
 if(s.factoryTransitionPending)log('FACTORY_TRANSITION observed='+(s.factoryObservedStage||'UNKNOWN')+' noLogin=true');
 if(s.phase==='LOGIN'&&s.loginSchema){
   const schema=s.loginSchema;
   const summary='status='+schema.status+' lower='+!!schema.lowercaseFields+
     ' legacy='+!!schema.legacyFields+' sites='+(schema.callSites??0)+' confidence=HEURISTIC';
   if(summary!==lastLoginSchemaDiagnostic){log('OFFSCREEN_LOGIN_SCHEMA '+summary);lastLoginSchemaDiagnostic=summary;}
 }
 log('STATE mode='+s.mode+' phase='+s.phase+' protected='+!!s.verified+' radio='+!!s.radio);
 render();
}
async function discover(){const s=await rpc('c20.discoverUnified');adapt(s);
 if(s.pendingWifiWrite){pending=true;const w=await rpc('c20.writeStatus');wifiStage=w.stage;notify('Есть неподтверждённая запись Wi-Fi. Проверка сохранённых значений ещё не доказывает применение.');}
 if((s.quickAppliedPending&&s.phase==='QUICK_SETUP')||s.factoryTransitionPending)scheduleReconnect();
}
function requestedWifi(quick=false){
 if(quick)return{}; // zero-input stock Wi-Fi on first-time setup
 if(!baseline)throw Error('Не прочитаны текущие SSID');
 const names={ssid24:el('ssid24').value.trim(),ssid5:el('ssid5').value.trim()};
 if(el('changeKey').checked){const pw=el('wifiKey').value;if(pw!==el('wifiKey2').value)throw Error('Пароли Wi-Fi не совпадают');return {...names,wifiPassword:pw};}
 return names;
}
function requestedQuickWifi(){
 const entered={ssid24:el('quickSsid24').value,ssid5:el('quickSsid5').value,
   wifiPassword:el('quickWifiKey').value};
 const both=!!entered.ssid24.trim()&&!!entered.ssid5.trim();
 if((entered.ssid24.trim()||entered.ssid5.trim())&&!both)throw Error('Для Quick Setup укажите имена обеих Wi-Fi сетей или оставьте оба пустыми');
 if(entered.wifiPassword&&(entered.wifiPassword.length<8||entered.wifiPassword.length>63||!/^[\x20-\x7e]+$/.test(entered.wifiPassword)))
   throw Error('Пароль Wi-Fi: от 8 до 63 ASCII-символов');
 return entered;
}
async function driveQuick(){
 notify('Настраиваем Archer автоматически…');
 log('AUTO_QUICK start');
 const out=await rpc('c20.autoQuick',{wifi:requestedQuickWifi()});
 log('AUTO_QUICK status='+out.outcome+' steps='+(out.steps||[]).join(',')+' elapsedMs='+out.elapsedMs);
 if(out.outcome==='AUTO_QUICK_BLOCKED'){
   el('quickNote').textContent='Роутер запросил дополнительные параметры, которые RouterLab пока не может выбрать автоматически. Текущие настройки сохранены.';
   log('AUTO_QUICK_BLOCKED stage='+out.stage+' reason='+out.reason);
   notify('Для этой прошивки автоматическая настройка остановлена.');
 }else if(out.outcome==='AUTO_QUICK_PENDING'){
   log('AUTO_QUICK_PENDING stage='+out.stage+' reason='+out.reason+
     (out.observedStage?' observedStage='+out.observedStage:'')+
     (out.observedMarkers?' observedMarkers='+JSON.stringify(out.observedMarkers):''));
   notify('Следующий экран не подтверждён. Нажмите «Обновить состояние»; повторная отправка этого шага заблокирована.');
 }else if(out.outcome==='AUTO_QUICK_RECONNECT_REQUIRED'){
   log('QUICK_SAVE_SENT; RECONNECT_REQUIRED; NO_AUTO_RETRY');
   notify('Быстрая настройка отправлена. Wi-Fi может отключиться или роутер перезагрузиться. Подключитесь к сети заново, затем нажмите «Обновить состояние».');
   // Refresh will discover login / configured state; never click Save again.
   state={...state,quickAppliedPending:true};render();
   reconnectAttempts=0;scheduleReconnect();
 }else if(out.outcome==='AUTO_QUICK_DONE'){
   notify('WAN DHCP и обе сети Wi-Fi подтверждены чтением настроек. Реальное подключение проверьте отдельно.',true);
   await discover();
 }else notify('Проверка настройки нужна: '+out.outcome);
}
el('changeKey').onchange=()=>show('keys',el('changeKey').checked);
el('primary').onclick=()=>action(async()=>{
 if(!state){await discover();return;}
 const phase=state.phase;
 const r={confirm:true};
 if(phase==='CREATE_ADMIN'){
   r.adminPassword=el('firstPassword').value;r.adminConfirm=el('firstPasswordConfirm').value;
   if(r.adminPassword!==r.adminConfirm)throw Error('Пароли администратора не совпадают');
 }else if(phase==='LOGIN')r.adminPassword=el('knownPassword').value;
 else if(phase==='QUICK_SETUP'){
   if(state.factoryTransitionPending){notify('Ожидаем появление Quick Setup после создания первого пароля.');return;}
   await driveQuick();return;}
 else if(phase==='WIFI_EDITOR')Object.assign(r,requestedWifi());
 const result=await rpc('c20.continueUnified',r);
 el('firstPassword').value='';el('firstPasswordConfirm').value='';el('knownPassword').value='';
 if(result.outcome==='WIFI_SET'){
   const w=result.write;log(w.noChanges?'WIFI_NO_CHANGE':('WIFI_SET submitted='+String(w.submitted??false)+' configVerified='+!!w.configVerified+' applied='+!!w.applied+' ack='+(w.ack||'none')));
   el('wifiKey').value='';el('wifiKey2').value='';
   if(w.noChanges){notify('Настройки уже совпадают. Запись не отправлялась.',true);}
   else if(w.verified){notify('Результат подтверждён.',true);pending=false;wifiStage=null;baseline=null;await discover();}
   else if(w.preflightFailed){notify('Запись не отправлена: '+w.reason);pending=!!w.pending;}
   else{pending=true;wifiStage=w.configVerified?'CONFIG_SAVED_AWAIT_APPLY':'PENDING_VERIFICATION';notify(w.configVerified?'Изменения записаны, но Wi-Fi ещё не применён. Требуется штатная перезагрузка.':'Запись отправлена. Сначала проверьте конфигурацию; не отправляйте изменения повторно.');}
   return;
 }
 if(result.outcome==='ADMIN_PENDING'){
   log('ADMIN_PENDING '+result.reason);adminPending=true;notify('Первый пароль мог быть создан. Не отправляйте его снова; обновите состояние роутера.');return;
 }
 if(result.outcome==='ADMIN_SUBMITTED'){
   log('FIRST_PASSWORD_SUBMITTED verified='+!!result.adminVerified);
   notify('Первый пароль отправлен. Проверяем следующий экран.',!!result.adminVerified);
   await discover();
   // First-use password creation is immediately followed by stock Quick
   // Setup, not by the normal configured-router login. Login may flash during
   // navigation; keep polling only the screen, never re-send credentials.
   for(let attempt=0;attempt<28;attempt++){
     if(state?.phase==='QUICK_SETUP'&&!state.factoryTransitionPending)break;
     if(state?.phase==='WIFI_EDITOR')break;
     if(state?.phase==='LOGIN'&&!state.factoryTransitionPending)break;
     await new Promise(resolve=>setTimeout(resolve,450));
     try{await discover()}catch(e){log('ADMIN_TRANSITION_READ_'+(e?.name||'Error'));}
   }
   if(state?.phase==='QUICK_SETUP'&&!state.factoryTransitionPending&&!state.quickAppliedPending)await driveQuick();
   else if(state?.factoryTransitionPending){
     log('FACTORY_WIZARD_PENDING observed='+(state.factoryObservedStage||'UNKNOWN')+' noResubmit=true');
     notify('Первый пароль отправлен. Штатный мастер пока не обнаружен; не создавайте пароль повторно. Нажмите «Обновить состояние».');
   }
   return;
 }
 if(result.loginDiagnostic?.operationTrace){
   const d=result.loginDiagnostic;
   log('LOGIN_SESSION_TRACE loginPosts='+Number(d.loginSubmitIntentCount||0)+
     ' operations='+d.operationTrace.map(x=>x.operation+':'+x.status).join('|')+
     ' tokenHeader='+(d.tokenHeaderContract||'UNKNOWN')+
     ' cookieBridge='+(d.cookieBridge||'NOT_USED')+
     ' cookieBridgeSource='+(d.cookieBridgeSource||'UNKNOWN')+
     ' cookieBridgeAfterLogin='+(d.cookieBridgeAfterLogin||'NOT_USED')+
     ' cookieBridgeWire='+(d.cookieBridgeWire||'NOT_APPLICABLE')+
     ' loginTokenField='+(d.loginTokenFieldPresent===true)+
     ' frameBefore='+(d.frameStageBefore||'UNKNOWN')+
     ' frameTransition='+(d.postLoginFrameTransition||'NOT_APPLICABLE')+
     ' frameAfter='+(d.frameStageAfter||'UNKNOWN')+
     ' stockRead='+(d.nativeReadStatus||'NOT_APPLICABLE')+
     ' source=ROUTERLAB_OFFSCREEN'+
     ' cookiesBefore='+JSON.stringify(d.cookiesBefore||'UNKNOWN')+
     ' cookiesAfter='+JSON.stringify(d.cookiesAfterLogin||'UNKNOWN')+
     ' wire='+JSON.stringify(d.wireEvidence||[])+
     ' frameCookie='+(d.frameCookieAfterLogin||'UNKNOWN')+
     ' frameStorage='+(d.frameStorageAfterLogin||'UNKNOWN')+
     (d.readError?' readError='+d.readError:'')+
     (d.passiveStage?' passiveStage='+d.passiveStage:''));
 }
 if(result.outcome==='LOGIN_PENDING'){
   // HTTP 500 while obtaining RSA parameters is NOT a login attempt. Leave
   // the user's button available for a later explicit attempt; never auto-send.
   loginPending=result.submitted!==false;
   log(loginPending?'OFFSCREEN_LOGIN_UNVERIFIED':'OFFSCREEN_LOGIN_NOT_SUBMITTED');
   const d=result.loginDiagnostic;
   if(d?.method==='ROUTER_ORIGIN_ENCRYPTED_XHR'){
     log('OFFSCREEN_ENCRYPTED_LOGIN step='+d.step+' paramsHttp='+(d.paramsHttp??'none')+
       ' loginHttp='+(d.loginHttp??'none')+' decrypted='+!!d.decrypted+
       ' readConfirmed='+!!d.readConfirmed+' reason='+(d.reason||'NONE')+
       (d.rootBootstrapHttp!==undefined?' rootBootstrapHttp='+d.rootBootstrapHttp:'')+
       (d.rootBootstrapCookie?' rootBootstrapCookie='+d.rootBootstrapCookie:'')+
       (d.paramsRecovery?' paramsRecovery='+d.paramsRecovery:'')+
       (d.paramsPostRefreshStage?' paramsPostRefreshStage='+d.paramsPostRefreshStage:'')+
       (d.postLoginStage?' postLoginStage='+d.postLoginStage:'')+
       (d.postLoginEvidence?' postLoginEvidence='+d.postLoginEvidence:'')+
       (d.frameRefresh?' frameRefresh='+d.frameRefresh:'')+
       (d.wizardStep?' wizardStep='+d.wizardStep:'')+
       (d.cookieBridge?' cookieBridge='+d.cookieBridge:'')+
       (d.cookieBridgeSource?' cookieBridgeSource='+d.cookieBridgeSource:'')+
       (d.cookieBridgeWire?' cookieBridgeWire='+d.cookieBridgeWire:'')+
       (d.cookieBridgeAfterLogin?' cookieBridgeAfterLogin='+d.cookieBridgeAfterLogin:'')+
       (d.tokenHeaderContract?' tokenHeader='+d.tokenHeaderContract:'')+
       (d.loginTokenFieldPresent!==undefined?' loginTokenField='+!!d.loginTokenFieldPresent:'')+
       (d.loginCookieFieldPresent!==undefined?' loginCookieField='+!!d.loginCookieFieldPresent:'')+
       (d.frameStageBefore?' frameBefore='+d.frameStageBefore:'')+
       (d.postLoginFrameTransition?' postLoginFrame='+d.postLoginFrameTransition:'')+
       (d.frameStageAfter?' frameAfter='+d.frameStageAfter:'')+
       (d.nativeReadStatus?' stockRead='+d.nativeReadStatus:'')+
       (d.readError?' readError='+d.readError:'')+
       (d.recoveryRead?' recoveryRead='+d.recoveryRead:'')+
       (d.recoveryTokenPresent!==undefined?' recoveryTokenPresent='+!!d.recoveryTokenPresent:'')+
       (d.recoveryReason?' recoveryReason='+d.recoveryReason:'')+
       (d.errorType?' error='+d.errorType:'')+
       (d.errorDetail?' errorDetail='+d.errorDetail:'')+
       (d.xhrEvent?' xhrEvent='+d.xhrEvent:'')+
       (d.xhrReadyState!==null&&d.xhrReadyState!==undefined?' readyState='+d.xhrReadyState:'')+
       (d.xhrElapsedMs!==null&&d.xhrElapsedMs!==undefined?' xhrMs='+d.xhrElapsedMs:'')+
       (d.frameNavigation!==undefined?' frameNavigation='+d.frameNavigation:'')+
       (d.vendorReplyStatus?' vendorStatus='+d.vendorReplyStatus:'')+
       (d.vendorReplyShape?' vendorShape='+d.vendorReplyShape:'')+
       (d.vendorRetCode!==null&&d.vendorRetCode!==undefined?' vendorRet='+d.vendorRetCode:'')+
       (d.vendorErrorCode!==null&&d.vendorErrorCode!==undefined?' vendorError='+d.vendorErrorCode:'')+
       (d.wireProfile?' wireProfile='+d.wireProfile:'')+
       (d.packetShapeOk!==undefined?' packetShapeOk='+!!d.packetShapeOk:'')+
       (d.packetSignLength?' signBytesHex='+d.packetSignLength:'')+
       (d.packetDataLength?' dataChars='+d.packetDataLength:'')+
       (Array.isArray(d.webRequest)&&d.webRequest.length?' net='+d.webRequest.map(x=>x.netError||x.outcome||'UNKNOWN').join('|'):''));
   }else if(d){const http=Array.isArray(d.requests)&&d.requests.length?
     d.requests.map(x=>x.path+':'+x.http+':'+x.outcome).join('|'):'NO_CGI_REQUEST_OBSERVED';
     log('OFFSCREEN_LOGIN_DIAG click='+d.click+' http='+http+' frameNavigation='+d.frameNavigation+
       ' stage='+d.stage+' storageAccess='+d.storageAccess+' cookieAccess='+d.cookieAccess+
       ' cookiePresent='+d.cookiePresent+' uiError='+d.uiError);
   }
   if(result.phase)adapt(result);
   notify(result.submitted===false?(String(result.loginDiagnostic?.reason||'').includes('RATE_LIMIT')?'Защита RouterLab: три попытки входа за 10 минут уже выполнены. Новая команда не отправлена. Подождите до окончания интервала.':'Команда входа не отправлялась (проверка параметров или защита от повторов). Обновите состояние перед новой попыткой.'):
     result.phase==='VERIFY_STATE'?'Вход принят на уровне CGI, но чтение настроек не подтвердилось. Нажмите «Проверить состояние входа (без пароля)»; повторный ввод не требуется.':result.phase==='AUTH_LOCKED'?'TP-Link временно заблокировал авторизацию. Дождитесь окончания таймера.':'Штатный вход не подтверждён. Повторно пароль не отправляйте. Скопируйте диагностический журнал.');return;
  }
 if(result.outcome==='LOGIN_ROUTED_QUICK_SETUP'){
   log('LOGIN_STATE_CONFIRMED stage=QUICK_SETUP wizardStep='+(result.loginDiagnostic?.wizardStep||'UNKNOWN')+' noResend=true');
   adapt(result);notify('Авторизация принята. Обнаружен незавершённый Quick Setup. Проверьте параметры и нажмите «Продолжить настройку».');return;
 }
 if(result.outcome==='LOGIN_VERIFIED'){
   if(result.loginRecovery==='PROTECTED_READ_AFTER_LOST_REPLY')log('OFFSCREEN_LOGIN_RECOVERED protectedRead=true loginReply=LOST noResend=true');
   log('LOGIN_PROTECTED_READ_OK');adapt(result);
   return;
 }
 if(result.outcome==='QUICK_STEP_SUBMITTED'){
   log('QUICK_NEXT '+result.step+' submitted=true');
   notify('Этап '+result.step+' отправлен через штатный мастер. Проверяем следующее состояние.');
   await new Promise(resolve=>setTimeout(resolve,700));await discover();return;
 }
 if(result.outcome==='QUICK_STEP_BLOCKED'){
   log('QUICK_BLOCK '+result.step+' '+result.reason);
   el('quickNote').textContent='На этапе '+result.step+' требуется уточнение: '+result.reason+'. Автоматическое продолжение остановлено.';
   notify('Нужны дополнительные данные для мастера; настройки не отправлены.');return;
 }
 if(result.outcome==='PENDING_WIFI_VERIFICATION'){pending=true;notify('Сначала проверьте предыдущую запись Wi-Fi.');return;}
 log('RESULT '+result.outcome);
 if(result.phase)adapt(result);
});
el('confirmFactoryLogin').onclick=()=>action(async()=>{const next=await rpc('c20.resolveFactoryLogin',{confirm:true});log('FACTORY_LOGIN_CONFIRMED stockLoginVisible=true noPasswordSent=true');adapt(next);});
el('inspectBusy').onclick=()=>action(async()=>{
 const r=await rpc('c20.inspectBusyReadOnly');
 log('STOCK_BUSY_CHECK http='+r.http+' isLogined='+(r.isLogined===null?'UNKNOWN':r.isLogined)+
   ' isBusy='+(r.isBusy===null?'UNKNOWN':r.isBusy)+
   ' frame='+r.frameStage+' ownSessionVerified=false passwordSent=false'+(r.reason?' reason='+r.reason:''));
 notify(r.http===200?'Проверены признаки веб-сессии роутера. Они не подтверждают сессию RouterLab. Пароль не отправлялся.':'Не удалось прочитать штатный статус веб-сессии. Пароль не отправлялся.');
});
el('retry').onclick=()=>action(async()=>{
 const s=await rpc('c20.refreshUnifiedState');
 const d=s.stateRefresh||{};
 log('STATE_REFRESH mode='+(d.mode||'UNKNOWN')+
   ' before='+(d.before||'UNKNOWN')+' after='+(d.after||'UNKNOWN')+
   ' storageAccess='+(d.storageAccess||'NOT_REPORTED')+
   ' cookieAccess='+(d.cookieAccess||'NOT_REPORTED')+
   ' uiError='+(d.uiError||'NOT_REPORTED')+
   ' protectedRead='+(d.protectedRefreshRead||'NOT_ATTEMPTED')+
   ' readReason='+(d.protectedRefreshReason||'NONE')+' passwordSent=false');
 const t=d.sessionTrace;
 if(t){
   const b=t.before||{},a=t.after||{};
   log('STATE_REFRESH_CONTEXT pending='+((b.pendingState)||'UNKNOWN')+
     ' fenceReadAttempted='+!!b.fenceReadAttempted+
     ' explicitReadCount='+(b.explicitReadCount??0)+' maxExplicitReads=2'+
     ' pendingAgeSec='+(b.pendingAgeSec??'NA')+
     ' cryptoStored='+!!b.cryptoStored+
     ' cryptoAgeSec='+(b.cryptoAgeSec??'NA')+
     ' cryptoInMemoryBefore='+!!b.cryptoInMemory+
     ' cryptoRecovered='+!!t.cryptoRestored+
     ' transportBefore='+(t.transportBefore||'UNKNOWN')+
     ' cookieBridge='+(t.cookieBridge||'NOT_ATTEMPTED')+
     ' cookiesBefore='+JSON.stringify(b.cookieJar||{})+
     ' cookiesAfter='+JSON.stringify(a.cookieJar||{})+
     ' wire='+JSON.stringify(t.readWire||[]));
 }
 adapt(s);
 if(s.phase==='VERIFY_STATE')notify('Скрытая страница перепроверена. Собственная сессия RouterLab пока не подтверждена; пароль повторно не отправлялся.');
});
el('verify').onclick=()=>action(async()=>{
 const r=await rpc('c20.checkPendingWifi');log('WIFI_VERIFY verified='+!!r.verified+' pending='+!!r.pending);
 pending=!!r.pending;
 if(r.configVerified)wifiStage=r.nativeRebootRequested?'REBOOT_CONTROL_ACTIVATED':'CONFIG_SAVED_AWAIT_APPLY';
 if(r.verified){notify('Изменения Wi-Fi подтверждены.',true);wifiStage=null;await discover();}
 else if(r.configVerified)notify(r.nativeRebootRequested?'Настройки записаны. Проверьте, что роутер перезагрузился, подключитесь к новой Wi-Fi сети и подтвердите результат.':'Конфигурация записана. Wi-Fi может продолжать вещать прежние SSID до перезагрузки.');
 else if(r.passwordVerificationRequired)notify('SSID подтверждены. Пароль проверьте подключением к Wi-Fi с новым ключом.');
 else notify('Пока нет подтверждения записи. Не отправляйте её повторно.');
});
el('vendor').onclick=()=>action(async()=>{const r=await rpc('c20.openVendorSession');log('VENDOR_WINDOW '+(r.stage||'UNKNOWN'));notify('Штатная сессия запущена в отдельном свёрнутом окне. Пробуем распознать роутер.');await discover();});
el('showVendor').onclick=()=>action(async()=>{await rpc('c20.showVendorSession');notify('Штатное окно показано.');});
el('reboot').onclick=()=>action(async()=>{if(!confirm('Перезагрузить TP-Link для применения Wi-Fi? Соединение временно пропадёт. Изменения НЕ будут отправлены повторно.'))return;const r=await rpc('c20.requestStockReboot');log('REBOOT_REQUEST '+(r.requested?'STOCK_CONTROL_CLICKED':r.reason));if(r.requested===true){wifiStage='REBOOT_CONTROL_ACTIVATED';notify('Штатный элемент перезагрузки активирован. Может потребоваться подтверждение в окне TP-Link. Затем переподключитесь и проверьте Wi-Fi.');}else if(r.requested==='UNKNOWN'){wifiStage='REBOOT_CONTROL_ACTIVATED';notify('Соединение прервалось. Перезагрузка могла начаться; повторно команду не отправляем. Проверьте сеть и состояние роутера.');}else notify('Штатный контрол не найден: '+r.reason);});
el('confirmWifi').onclick=()=>action(async()=>{if(!confirm('Вы действительно подключились к Wi-Fi после перезагрузки с НОВЫМ именем и, при смене пароля, НОВЫМ ключом?'))return;const r=await rpc('c20.confirmPhysicalWifi');log('WIFI_PHYSICAL_CONFIRMED '+r.method);pending=false;wifiStage=null;notify('Результат подтверждён вами после переподключения.',true);await discover();});
el('copy').onclick=()=>navigator.clipboard.writeText(journal.join('\n')).catch(()=>{});
// Detection happens automatically; no separate Probe/Login/Read/Scan buttons.
action(discover);
