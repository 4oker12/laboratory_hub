/* Original TP-Link AX23 SPA + genuine local admin authentication +
 * software-only CONFIG backend E2E in Chromium. Must target disposable
 * localhost viewer. No credential, crypto material or full URI is logged.
 */
import {randomBytes} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

const base=process.argv[2]||'http://127.0.0.1:18083';
if (!/^http:\/\/127[.]0[.]0[.]1:18\d{3}$/.test(base)) {
 console.error('AX23_SOFTDEVICE_E2E=NONLOCAL_TARGET_REFUSED');process.exit(2);
}
let sock;
function fail(reason){throw Error(reason)}
async function main(){
 const reg=await fetch('http://127.0.0.1:19225/json');
 if(!reg.ok)fail('CHROME_NOT_READY');
 const pages=await reg.json();
 const page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 if(!page)fail('CHROME_PAGE_NOT_READY');
 sock=new WebSocket(page.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{
   sock.addEventListener('open',resolve,{once:true});
   sock.addEventListener('error',()=>reject(Error('CDP_ERROR')),{once:true});
  }),
  pause(4000).then(()=>{throw Error('CDP_TIMEOUT')})
 ]);
 let n=0;const pending=new Map();
 sock.addEventListener('message',ev=>{
  let x;try{x=JSON.parse(ev.data)}catch(_){return}
  if(!x.id||!pending.has(x.id))return;
  const cb=pending.get(x.id);pending.delete(x.id);
  x.error?cb.reject(Error('CDP_METHOD_ERROR')):cb.resolve(x.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++n;pending.set(id,{resolve,reject});
  sock.send(JSON.stringify({id,method,params}));
 });
 const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{
   expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('STOCK_SCRIPT_EXCEPTION');
  return r.result.value;
 };
 const wait=async(expression,limit=35)=>{
  for(let i=0;i<limit;i++){
   const r=await evaluate(expression);
   if(r)return r;
   await pause(250);
  }
  return null;
 };
 const findVisiblePassword=()=>{
  return '(() => [...document.querySelectorAll("input[type=password]")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length)()';
 };
 await call('Page.enable');await call('Runtime.enable');
 await call('Page.navigate',{url:base+'/webpages/index.html'});
 if(!await wait('Boolean(window.jQuery&&window.jQuery.su&&window.jQuery.su.Connection&&window.RouterLabAX23SoftwareDevice)',50))
   fail('ORIGINAL_STOCK_BROWSER_OR_SOFTDEVICE_BRIDGE_NOT_READY');
 const attached=await evaluate('(() => ({mode:window.RouterLabAX23SoftwareDevice?.mode,applied:window.RouterLabAX23SoftwareDevice?.hardwareApplied,auth:window.RouterLabAX23SoftwareDevice?.nativeAuthentication}))()');
 if(attached.mode!=='software-only'||attached.applied!==false||attached.auth!==true)
   fail('SOFTWARE_ONLY_MARKER_MISSING');
 let count=await wait(findVisiblePassword(),25);
 const password='RL'+randomBytes(12).toString('base64url')+'A9!';
 if(count===2){
  for(let i=0;i<2;i++){
   await evaluate('(() => {const e=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);e['+i+'].focus();return true})()');
   await call('Input.insertText',{text:password});
   await evaluate('(() => {const e=[...document.querySelectorAll("input[type=password]")].filter(e=>e.getBoundingClientRect().width>0);e['+i+'].dispatchEvent(new Event("change",{bubbles:true}));return e['+i+'].value.length})()');
  }
  const clicked=await evaluate('(() => {const e=document.querySelector("#init-login-button a.button-button");if(!e)return false;e.click();return true})()');
  if(!clicked)fail('STOCK_INITIAL_PASSWORD_SUBMIT_MISSING');
  await pause(3100);
 }
 // On some vendor builds initial password creates a session; on others an
 // ordinary login form remains. Only the original vendor button is pressed.
 let token=await wait('Boolean(localStorage.getItem("token")&&window.jQuery?.su?.url?.stok===localStorage.getItem("token"))',15);
 if(!token && await evaluate(findVisiblePassword())===1){
  await evaluate('(() => {const x=[...document.querySelectorAll("input[type=password]")].find(e=>e.getBoundingClientRect().width>0);if(x)x.focus();return Boolean(x)})()');
  await call('Input.insertText',{text:password});
  await evaluate('(() => {const x=[...document.querySelectorAll("input[type=password]")].find(e=>e.getBoundingClientRect().width>0);if(x)x.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  const clicked=await evaluate('(() => {const b=document.querySelector("#login-lan-button a.button-button");if(!b)return false;b.click();return true})()');
  if(!clicked)fail('STOCK_ORDINARY_LOGIN_SUBMIT_MISSING');
  token=await wait('Boolean(localStorage.getItem("token")&&window.jQuery?.su?.url?.stok===localStorage.getItem("token"))',25);
 }
 if(!token)fail('GENUINE_VENDOR_LOGIN_TOKEN_NOT_PRESENT');
 console.log('AX23_SOFTDEVICE_VENDOR_LOGIN=CONFIRMED');

 const bridgeRequest=async (operation,data)=>{
  const source=String.raw`(async()=>new Promise((resolve,reject)=>{
    const w=window.jQuery.su;
    const c=new w.Connection();
    const url=w.url("/admin/quick_setup?form=quick_setup");
    const timer=setTimeout(()=>resolve({timeout:true}),4000);
    c.request({url,data:${JSON.stringify({operation,...data})},
      success:r=>{clearTimeout(timer);resolve({success:r?.success===true,
        mode:r?.routerlab?.mode,
        model:r?.data&&{network_conntype:r.data.network_conntype,
          wireless_2g_ssid:r.data.wireless_2g_ssid,
          auto_upgrade_enable:r.data.auto_upgrade_enable}})},
      error:()=>{clearTimeout(timer);resolve({error:true})}
    });
  }))()`;
  return await evaluate(source);
 };
 const initial=await bridgeRequest('read',{});
 if(initial?.success!==true||initial?.model?.network_conntype!=='dhcp')
   fail('SOFTWARE_QUICK_SETUP_READ_FAILED');
 const applied=await bridgeRequest('write',{
   network_conntype:'dhcp',
   wireless_2g_ssid:'RouterLab-Genuine-SPA-QS',
   auto_upgrade_enable:'off'
 });
 if(applied?.success!==true||applied?.mode!=='software_only')
   fail('SOFTWARE_QUICK_SETUP_WRITE_FAILED');
 const stored=await bridgeRequest('read',{});
 if(stored?.model?.wireless_2g_ssid!=='RouterLab-Genuine-SPA-QS')
   fail('SOFTWARE_QUICK_SETUP_READBACK_FAILED');
 console.log('AX23_SOFTDEVICE_ORIGINAL_BROWSER_MODEL_WRITE_READBACK=PASS');
 console.log('AX23_SOFTDEVICE_HARDWARE_EFFECTS=NONE');

 // Best-effort inspection of actual stock wizard, without fake Next clicks:
 // this phase is reported but does not claim completion unless confirmed.
 const wizard=await evaluate('(() => ({quickSetupView:Boolean(document.querySelector("#qs-choose-internet-type-next-btn,#qs-auto-update-next-step-btn,#qs-wireless-next-step-btn")),visibleContinue:[...document.querySelectorAll("[id*=qs-][id*=next]")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length}))()');
 console.log('AX23_SOFTDEVICE_ORIGINAL_STOCK_WIZARD_PRESENT='+String(wizard.quickSetupView));
 sock.close();
}
try{await main()}catch(err){
 console.error('AX23_SOFTDEVICE_E2E=FAIL_'+String(err.message||'OTHER').replace(/[^A-Z_]/g,'').slice(0,90));
 if(sock)sock.close();
 process.exitCode=1;
}
