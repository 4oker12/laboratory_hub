'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..');
function fixture({initial='QUICK_SETUP_ACTIVE',twoButtons=false,busyQueue=false,noStock=false,navigateOnClick=false,emptyRadioList=false}={}){
 let stage=initial,clicks=0,created=0,network=0,writeCalls=0,reads=0,handler;
 const passwd={disabled:false,value:'',getClientRects:()=>[1],dispatchEvent:()=>{}};
 const loginBtn={disabled:false,innerText:'Войти',getClientRects:()=>[1],click:()=>{clicks++;stage='QUICK_SETUP_ACTIVE';}};
 const extraBtn={...loginBtn,click:()=>{clicks++;}};
 const doc={title:'Archer C20',body:{get innerText(){return stage==='QUICK_SETUP_ACTIVE'?'Archer C20 Быстрая настройка WAN Страна':stage==='QUICK_SETUP_WIFI'?'Archer C20 Быстрая настройка Настройки беспроводного режима Wi-Fi':stage==='CONFIGURED_WIFI'?'Archer C20 Беспроводной режим SSID':'Archer C20 Вход'}},querySelectorAll:sel=>sel==='input[type="password"]'?(stage==='LOGIN_FORM'||stage==='QUICK_SETUP_WIFI'||stage==='CONFIGURED_WIFI'?[passwd]:[]):sel.startsWith('button')?(stage==='LOGIN_FORM'?(twoButtons?[loginBtn,extraBtn]:[loginBtn]):[]):[]};
 const vendor={as:busyQueue?[1]:[],ds:[],io:()=>{},act:(type,oid,stack,parent,attrs)=>{reads++;assert.equal(type,1);assert.equal(oid,'LAN_WLAN');assert.deepEqual(Array.from(attrs),['Enable','SSID','X_TP_Band','SSIDAdvertisementEnabled']);assert.equal(stack,'0,0,0,0,0,0');return vendor.row=[];},exe:()=>{if(emptyRadioList)return 0;vendor.row.push({SSID:'Test24',X_TP_Band:'2.4G',__stack:'0,0,0,0,0,0'},{SSID:'Test5',X_TP_Band:'5G',__stack:'1,0,0,0,0,0'});return 0;}};
 const window={ $:noStock?{}:vendor,ACT_GET:5};
 const MockInput=function(){};Object.defineProperty(MockInput.prototype,'value',{set:function(v){this.value=v}});
 const chrome={runtime:{getURL:()=> 'chrome-extension://test/setup.html',onInstalled:{addListener(){}},onMessage:{addListener:f=>handler=f},sendMessage:async()=>{}},action:{onClicked:{addListener(){}}},tabs:{query:async()=>[{id:3,url:'http://192.168.0.1/'}],get:async()=>({id:3,url:'http://192.168.0.1/',status:'complete'}),create:async()=>{created++;throw Error('unexpected tab')},onRemoved:{addListener(){}},remove:async()=>{}},scripting:{executeScript:async({func,args})=>{const result=vm.runInNewContext('('+func.toString()+')(...args)',{document:doc,window,location:{origin:'http://192.168.0.1'},args:args||[],HTMLInputElement:MockInput,Event:class{}});if(navigateOnClick && func.toString().includes('FORM_ALREADY_HAS_PASSWORD'))throw Error('Frame removed due to navigation');return[{result}]}}};
 // Fake native input setter, to avoid browser deps.
 const inputProto={set value(x){passwd.value=x}};
 const original=Object.getOwnPropertyDescriptor(Object.prototype,'value');
 const ctx=vm.createContext({chrome,fetch:async()=>{network++;throw Error('UNEXPECTED_NETWORK')},URL,AbortController,setTimeout,clearTimeout,TextEncoder,TextDecoder,console});
 ctx.importScripts=(...names)=>names.forEach(x=>vm.runInContext(fs.readFileSync(path.join(base,x),'utf8'),ctx));
 vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
 const command=(type,props={})=>new Promise(resolve=>handler({type,...props},{url:'chrome-extension://test/setup.html'},resolve));
 return{command,stats:()=>({stage,clicks,created,network,writeCalls,reads}),doc,window,ctx,setStage:value=>{stage=value}};
}
(async()=>{
 let f=fixture();let a=await f.command('c20.probe');assert(a.ok,a.error);assert.equal(a.data.stage,'QUICK_SETUP_ACTIVE');assert.equal(f.stats().network,0);
 let r=await f.command('c20.nativeRead');assert(r.ok,r.error);assert.equal(r.data.apiVerified,true);assert.equal(r.data.wifi.rows[0].ssid,'Test24');assert.equal(r.data.wifi.rows[1].ssid,'Test5');assert.equal(r.data.wifi.allBandsConfirmed,true);assert.equal(r.data.canWrite,false);assert.equal(f.stats().created,0);assert.equal(f.stats().network,0);console.log('PASS: native Quick Setup -> native ACT_GL WiFi list read with two bands, no login HTTP and no writes');
 f=fixture({emptyRadioList:true});await f.command('c20.probe');r=await f.command('c20.nativeRead');assert(!r.ok);assert.match(r.error,/VENDOR_LIST_EMPTY/);console.log('PASS: empty vendor WLAN list blocks verification');
 f=fixture({busyQueue:true});await f.command('c20.probe');r=await f.command('c20.nativeRead');assert(!r.ok);assert.match(r.error,/VENDOR_QUEUE_BUSY/);assert.equal(f.stats().reads,0);console.log('PASS: active vendor queue blocks injected read');
 f=fixture({initial:'LOGIN_FORM'});await f.command('c20.probe');r=await f.command('c20.nativeRead');assert(!r.ok);assert.match(r.error,/REQUIRES_AUTHENTICATED_SCREEN/);assert.equal(f.stats().network,0);console.log('PASS: login screen cannot be read as authenticated');
 f=fixture({initial:'LOGIN_FORM',twoButtons:true});await f.command('c20.probe');r=await f.command('c20.nativeLogin',{password:'pass123456'});assert(!r.ok);assert.match(r.error,/LOGIN_BUTTON_NOT_UNIQUE/);assert.equal(f.stats().clicks,0);console.log('PASS: ambiguous login buttons block submission');
 f=fixture({initial:'QUICK_SETUP_ACTIVE'});await f.command('c20.probe');r=await f.command('c20.nativeLogin',{password:'pass123456'});assert(r.ok,r.error);assert.equal(r.data.alreadyLoggedIn,true);assert.equal(f.stats().clicks,0);console.log('PASS: already logged in never attempts second login');
 f=fixture({initial:'QUICK_SETUP_ACTIVE'});await f.command('c20.probe');r=await f.command('c20.authorizeSmart',{password:'dummy-not-used'});assert(r.ok,r.error);assert.equal(r.data.authenticated,true);assert.equal(r.data.loginSubmitted,false);assert.equal(r.data.verifiedBy,'PROTECTED_VENDOR_LIST_READ');assert.equal(f.stats().clicks,0);assert.equal(f.stats().network,0);console.log('PASS: state-aware auth skips login and proves protected native API access');
 f=fixture({initial:'LOGIN_FORM'});await f.command('c20.probe');let ghostCalls=0;
 f.ctx.offscreenEncryptedLogin=async()=>{ghostCalls++;f.setStage('QUICK_SETUP_ACTIVE');return{stage:'CONFIGURED_AUTHENTICATED',submitted:true,readConfirmed:true,radio:{ssid24:'Test24',ssid5:'Test5'},diagnostic:{reason:'SINGLE_PROTECTED_WLAN_READ_CONFIRMED'}}};
 r=await f.command('c20.authorizeSmart',{password:'pass123456'});assert(r.ok,r.error);assert.equal(r.data.authenticated,true);assert.equal(r.data.loginSubmitted,true);assert.equal(r.data.transport,'OFFSCREEN_VENDOR_ORIGIN');assert.equal(r.data.verifiedBy,'PROTECTED_WLAN_READ');assert.equal(f.stats().clicks,0);assert.equal(f.stats().network,0);assert.equal(f.stats().created,0);assert.equal(ghostCalls,1);console.log('PASS: LOGIN_FORM uses one hidden fenced login and confirmed WLAN read, no visible login click/tab');
 r=await f.command('c20.authorizeSmart',{password:'pass123456'});assert(r.ok,r.error);assert.equal(r.data.loginSubmitted,false);assert.equal(f.stats().clicks,0);assert.equal(ghostCalls,1);console.log('PASS: verified native session is reused; no repeated hidden login');
 f=fixture({initial:'LOGIN_FORM'});await f.command('c20.probe');let fallbackLoginCalls=0;
 f.ctx.offscreenEncryptedLogin=async()=>({stage:'LOGIN_STATE_UNRESOLVED',submitted:true,readConfirmed:false,diagnostic:{reason:'LOGIN_ZERO_ACK_SINGLE_READ_UNCONFIRMED'}});
 f.ctx.nativeLogin=async()=>{fallbackLoginCalls++;throw Error('must not retry via visible form')};
 r=await f.command('c20.authorizeSmart',{password:'pass123456'});assert(!r.ok);assert.match(r.error,/C20_GHOST_LOGIN_UNVERIFIED/);assert.equal(fallbackLoginCalls,0);assert.equal(f.stats().clicks,0);console.log('PASS: ambiguous hidden login never falls back to a second visible password submission');
 f=fixture({initial:'QUICK_SETUP_WIFI'});r=await f.command('c20.probe');assert(r.ok,r.error);assert.equal(r.data.stage,'QUICK_SETUP_ACTIVE');console.log('PASS: Wi-Fi password field inside Quick Setup is not misclassified as admin login');
 f=fixture({initial:'CONFIGURED_WIFI'});r=await f.command('c20.probe');assert(r.ok,r.error);assert.equal(r.data.stage,'CONFIGURED_AUTHENTICATED');console.log('PASS: configured Wi-Fi password input with no login action is not admin login');
 f=fixture({initial:'LOGIN_FORM',twoButtons:true});await f.command('c20.probe');r=await f.command('c20.authorizeSmart',{password:'pass123456'});assert(!r.ok);assert.match(r.error,/C20_OFFSCREEN_API_UNAVAILABLE/);assert.equal(f.stats().clicks,0);console.log('PASS: hidden auth unavailable blocks workflow without clicking ambiguous vendor login');
})().catch(e=>{console.error(e);process.exitCode=1});
