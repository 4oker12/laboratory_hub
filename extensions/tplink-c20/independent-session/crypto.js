/* RouterLab C20 — built-in crypto (offline, no external scripts). */
(function(root,factory){const x=factory();if(typeof module==='object'&&module.exports)module.exports=x;else root.C20Crypto=x})(typeof globalThis==='object'?globalThis:this,()=>{
'use strict';
const enc=new TextEncoder(),dec=new TextDecoder();
function md5(s){
 const raw=enc.encode(s), n=(((raw.length+8)>>6)+1)*64, bytes=new Uint8Array(n);bytes.set(raw);bytes[raw.length]=128;
 const view=new DataView(bytes.buffer);view.setUint32(n-8,(raw.length*8)>>>0,true);view.setUint32(n-4,Math.floor(raw.length/0x20000000)>>>0,true);
 let a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476;
 const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
 for(let off=0;off<n;off+=64){let A=a,B=b,C=c,D=d;
  for(let i=0;i<64;i++){let f,g,r;if(i<16){f=(B&C)|(~B&D);g=i;r=shifts[i%4]}else if(i<32){f=(D&B)|(~D&C);g=(5*i+1)%16;r=shifts[4+i%4]}else if(i<48){f=B^C^D;g=(3*i+5)%16;r=shifts[8+i%4]}else{f=C^(B|~D);g=(7*i)%16;r=shifts[12+i%4]}
   const k=Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0;
   const w=view.getUint32(off+4*g,true);const v=(A+f+k+w)>>>0;const next=(B+((v<<r)|(v>>>(32-r))))>>>0;
   A=D;D=C;C=B;B=next;
  }
  a=(a+A)>>>0;b=(b+B)>>>0;c=(c+C)>>>0;d=(d+D)>>>0;
 }
 return [a,b,c,d].map(x=>[x&255,(x>>>8)&255,(x>>>16)&255,(x>>>24)&255].map(t=>t.toString(16).padStart(2,'0')).join('')).join('');
}
function rand16(){const raw=new Uint8Array(16);crypto.getRandomValues(raw);return [...raw].map(x=>String(x%10)).join('')}
function fromBase64(s){const bin=atob(s.trim()),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function toBase64(a){let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s)}
function hexBytes(b){return [...b].map(x=>x.toString(16).padStart(2,'0')).join('')}
function powmod(b,e,m){let r=1n;for(b%=m;e>0n;e>>=1n,b=b*b%m)if(e&1n)r=r*b%m;return r}
// TP-Link's vendor implementation uses RSA-512 with no padding, 64-byte blocks
// zero padded at the end. This is protocol compatibility, NOT secure application crypto.
function rsaNoPad(text,nn,ee){if(!/^[a-f\d]{128}$/i.test(nn))throw Error('C20_RSA_MODULUS_UNSUPPORTED');if(!/^[a-f\d]{1,8}$/i.test(ee))throw Error('C20_RSA_EXPONENT_UNSUPPORTED');
 const N=BigInt('0x'+nn),E=BigInt('0x'+ee);let out='';const a=enc.encode(text);
 for(let i=0;i<a.length;i+=64){let chunk=new Uint8Array(64);chunk.set(a.slice(i,i+64));let m=BigInt('0x'+hexBytes(chunk));if(m>=N)throw Error('C20_RSA_CHUNK_TOO_LARGE');out+=powmod(m,E,N).toString(16).padStart(128,'0')}
 return out;
}
async function createContext(nn,ee,seq,user,password){
 return restoreContext(nn,ee,seq,rand16(),rand16(),md5(user+password));
}
async function restoreContext(nn,ee,seq,key,iv,h){
 if(!/^[a-f\d]{128}$/i.test(nn)||!/^[a-f\d]{1,8}$/i.test(ee)||
    !Number.isSafeInteger(Number(seq))||Number(seq)<0||
    !/^\d{16}$/.test(key)||!/^\d{16}$/.test(iv)||!/^[a-f\d]{32}$/i.test(h))
   throw Error('C20_CRYPTO_CONTEXT_INVALID');
 const aes=await crypto.subtle.importKey('raw',enc.encode(key),'AES-CBC',false,['encrypt','decrypt']);
 let counter=Number(seq);if(!Number.isSafeInteger(counter)||counter<0)throw Error('INVALID_SEQUENCE');
 async function encrypt(plaintext,login=false){const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:enc.encode(iv)},aes,enc.encode(plaintext)));
 const data=toBase64(ciphertext);const body=(login?`key=${key}&iv=${iv}&`:'')+`h=${h}&s=${counter+data.length}`;
 const sign=rsaNoPad(body,nn,ee);return{data,sign};
 }
 async function decrypt(content){const plain=await crypto.subtle.decrypt({name:'AES-CBC',iv:enc.encode(iv)},aes,fromBase64(content));return dec.decode(plain)}
 return{encrypt,decrypt,zero:()=>{counter=0;},
  serialize:()=>({nn,ee,seq:counter,key,iv,h}),
  metadata:()=>({aes:'AES-CBC',rsa:'RSA-512-no-padding',hasMd5:!!h})};
}
function getParams(body){
 let raw=String(body||'');let read=k=>{let re=new RegExp('(?:^|[;\\s,{])(?:var\\s+)?'+k+'\\s*[:=]\\s*[\'\"]?([0-9a-fA-F]+)','im');return raw.match(re)?.[1]||null};
 const nn=read('nn'),ee=read('ee'),seq=read('seq');
 if(!nn||!ee||!seq)throw Error('MISSING_GDPR_PARAMETERS');return{nn,ee,seq:Number(seq)};
}
return Object.freeze({md5,rsaNoPad,createContext,restoreContext,getParams,rand16});
});
