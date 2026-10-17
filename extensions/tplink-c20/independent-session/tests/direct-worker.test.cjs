const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createDecipheriv,createCipheriv,generateKeyPairSync,privateDecrypt,constants}=require('node:crypto');
const basedir=path.join(__dirname,'..');const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:512,publicExponent:65537});
const jwk=publicKey.export({format:'jwk'}),nn=Buffer.from(jwk.n,'base64url').toString('hex'),ee=Buffer.from(jwk.e,'base64url').toString('hex');
let handler,tabExists=false,tabCreates=0,auth=false,aes=null,wanDhcp=false,wifi24='TPLink_24',wifi5='TPLink_5G',postLog=[];
const hexRe=/.{128}/g;
const rsaPlain=str=>str.match(hexRe).map(s=>privateDecrypt({key:privateKey,padding:constants.RSA_NO_PADDING},Buffer.from(s,'hex')).toString('utf8').replace(/\0+$/,'')).join('');
function decrypt(s){const decipher=createDecipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([decipher.update(Buffer.from(s,'base64')),decipher.final()]).toString('utf8')}
function encrypt(s){const cipher=createCipheriv('aes-128-cbc',Buffer.from(aes.key),Buffer.from(aes.iv));return Buffer.concat([cipher.update(s),cipher.final()]).toString('base64')}
async function mockRequest(arg){let {path:p,method,headers,body}=arg;postLog.push({path:p.split('?')[0],method});
 if(p==='/')return{http:200,url:p,text:auth?`<!doctype html><script>var token="abc123def";</script>`:'<!doctype html><title>Archer C20 Login</title><input type="password">'};
 if(p==='/cgi/getGDPRParm')return{http:200,url:p,text:`var nn="${nn}";var ee="${ee}";var seq=858738839;`};
 if(p==='/cgi_gdpr'){if(!headers.TokenID){
   assert.equal(method,'POST');assert.equal(headers['Content-Type'],'text/plain');
   const v=Object.fromEntries(String(body).trim().split('\r\n').map(x=>x.split('=',2)));
   const sig=rsaPlain(v.sign);const k=sig.match(/key=(\d{16})/)?.[1],iv=sig.match(/iv=(\d{16})/)?.[1];assert(k&&iv);aes={key:k,iv};
   const pl=decrypt(v.data);assert(pl.includes('[/cgi/login#'));assert(pl.includes('username=user'));assert(pl.includes('password=mySecret123'));auth=true;return{http:200,url:p,text:encrypt('[cgi]0\r\n$.ret=0;\r\n[error]0')};}
 assert.equal(headers.TokenID,'abc123def');const parts=Object.fromEntries(String(body).trim().split('\r\n').map(x=>x.split('=',2)));assert(parts.sign&&parts.data);
  const sign=rsaPlain(parts.sign);assert(sign.startsWith('h='));assert(!sign.includes('key='));
  const plain=decrypt(parts.data);let r='[cgi]0\r\n[error]0\r\n';
  if(plain.includes('IGD_DEV_INFO'))r+='modelName=Archer C20\r\nhardwareVersion=Archer C20 v5 00000002\r\nsoftwareVersion=3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n\r\n';
  if(plain.includes('LAN_WLAN')){if(plain.startsWith('2&2')){const ss=plain.match(/SSID=([^\r\n]+)/g)||[];const pw=plain.match(/X_TP_PreSharedKey=([^\r\n]+)/g)||[];if(ss[0])wifi24=ss[0].slice(5);if(ss[1])wifi5=ss[1].slice(5);assert.equal(pw.length,2)}
  else r+=`[LAN_WLAN#1,3,0,0,0,0#0,0,0,0,0,0]0,5\r\nSSID=${wifi24}\r\nX_TP_Band=2.4G\r\nX_TP_PreSharedKey=hidden\r\n[LAN_WLAN#1,4,0,0,0,0#0,0,0,0,0,0]1,5\r\nSSID=${wifi5}\r\nX_TP_Band=5G\r\nX_TP_PreSharedKey=hidden\r\n`;}
  if(plain.includes('WAN_IP_CONN')){if(plain.startsWith('2'))wanDhcp=true;else r+=`[WAN_IP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,3\r\nAddressingType=${wanDhcp?'DHCP':'Static'}\r\nEnable=1`}
  return{http:200,url:p,text:encrypt(r)};
 }
 throw Error('Unknown route '+p);
}
const listeners={},chrome={runtime:{sendMessage:async()=>{},getURL:()=> 'chrome-extension://test/setup.html',onInstalled:{addListener:f=>listeners.installed=f},onMessage:{addListener:f=>handler=f}},
 action:{onClicked:{addListener:()=>{}}},tabs:{create:async ({url,active})=>{if(url.startsWith('http')){assert.equal(active,false);tabCreates++;tabExists=true;return{id:777,url,status:'complete'}}return{id:778,url,status:'complete'}},get:async()=>tabExists?{id:777,url:'http://192.168.0.1/',status:'complete'}:Promise.reject(Error('not found')),onRemoved:{addListener:()=>{}},remove:async()=>{tabExists=false}},
 scripting:{executeScript:async ({args})=>[{result:await mockRequest(args[0])}]}};
const mockFetch=async(input,opts={})=>{
 const url=new URL(String(input));const r=await mockRequest({path:url.pathname,method:opts.method||'GET',body:opts.body,headers:opts.headers||{}});
 return {status:r.http,url:String(input),text:async()=>r.text};
};
const context=vm.createContext({chrome,fetch:mockFetch,crypto:webcrypto,TextEncoder,TextDecoder,URLSearchParams,URL,setTimeout,clearTimeout,AbortController,console,btoa:global.btoa,atob:global.atob});
context.importScripts=(...names)=>{for(const filename of names)vm.runInContext(fs.readFileSync(path.join(basedir,filename),'utf8'),context,{filename})};
vm.runInContext(fs.readFileSync(path.join(basedir,'background.js'),'utf8'),context,{filename:'background.js'});
async function command(type,body={}){return await new Promise(resolve=>{assert(handler({type,...body},{url:'chrome-extension://test/setup.html'},resolve));})}
(async()=>{
 let p=await command('c20.probe');assert(p.ok,p.error);assert(p.data.protocolReady);assert.equal(p.data.transport,'SERVICE_WORKER_DIRECT');
 let l=await command('c20.authorizeSmart',{password:'mySecret123'});assert(l.ok,l.error);assert(l.data.authenticated);assert.equal(l.data.transport,'SERVICE_WORKER_DIRECT');assert.equal(l.data.verifiedBy,'ENCRYPTED_IDENTITY_AND_WLAN_READ');
 let r=await command('c20.readSmart');assert(r.ok,r.error);assert.equal(r.data.mode,'direct');assert.equal(r.data.identity.allowed,true);assert.equal(r.data.wifi.ssid24,'TPLink_24');
 // A rescan must retain a verified SW session and MUST NOT force login again.
 let d=await command('c20.discoverUnified');assert(d.ok,d.error);
 assert.equal(d.data.phase,'WIFI_EDITOR');assert.equal(d.data.directOnly,true);
 assert.equal(d.data.requiresVendorWrite,true);assert.equal(tabCreates,0);
 console.log('PASS: direct protected worker session persists across discovery without vendor tab or repeated login');
 // Read success must NOT authorize writes based solely on a mocked wire schema.
 // The earlier test treated invented radio/WAN stacks as proof of a real C20
 // write contract. A physical firmware contract is still required.
 let w=await command('c20.setWifi',{confirm:true,ssid24:'Home24',ssid5:'Home5',password:'Pass567890'});
 assert(!w.ok,'Wi-Fi write must be hardware-gated');
 let v=await command('c20.setDhcp',{confirm:true});
 assert(!v.ok,'WAN write must be hardware-gated');
 // Native Quick Setup must not silently fall through into the GDPR re-login.
 let full=await command('c20.bootstrap',{confirm:true,username:'user',password:'mySecret123',ssid24:'New2G',ssid5:'New5G',wifiPassword:'Pass567890'});
 assert(!full.ok,'bootstrap must stop before unverified physical WAN/Wi-Fi writes');
 const cgiWrites=postLog.filter(x=>x.path==='/cgi_gdpr'&&x.method==='POST');
 // Two or more POSTs can be authentication/read; assertions above confirm the
 // refused SET branch rather than inferring write success from HTTP 200.
 assert(cgiWrites.length>=1);
 let fin=await command('c20.end');assert(fin.ok);assert.equal(tabCreates,0);assert(!tabExists);
 console.log('PASS: direct SW (zero tabs), RSA/AES login, TokenID, Wi-Fi/WAN read; unverified physical writes blocked');
})().catch(e=>{console.error(e);process.exit(1)});
