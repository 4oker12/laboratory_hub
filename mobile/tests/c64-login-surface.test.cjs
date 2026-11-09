'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../RouterLabMobile/Resources/RouterLabC64Driver.js');
const c64=require(src);
let passwordRead=0;
const password={get value(){passwordRead++;throw Error('PASSWORD READ ATTEMPT')}};
const query={
  'form':[{},{}],
  'input[type=password]':[password],
  'input[type=text]':[{}],
  'button, input[type=submit]':[{},{}],
  'script[src]':[
    {getAttribute:()=>'/web/login/login.js?stok=PRIVATE_SESSION'},
    {getAttribute:()=>'/scripts/crypto/aes.js?key=PRIVATE_KEY'},
    {getAttribute:()=>'/ui/wizard/index.js'},
    {getAttribute:()=>'/modules/model/model.js'},
    {getAttribute:()=>'/assets/irrelevant.js'}
  ]
};
const doc={title:'TP-Link',querySelectorAll(sel){return query[sel]||[]}};
const su={Proxy:function(){},encryptor:{},modelManager:{},url:()=>{}};
Object.defineProperty(su,'SecretKey',{enumerable:true,get(){throw Error('Secret read')}});
const w={
  $:{su},
  location:{href:'http://192.168.0.1/',pathname:'/'}
};
const result=c64.inspectLoginSurface(doc,w);
assert.equal(result.form,'LOGIN_PASSWORD_CANDIDATE');
assert.equal(result.passwordFields,1);
assert.equal(result.forms,2);
assert.equal(result.textInputs,1);
assert.equal(result.buttons,2);
assert.equal(result.framework,'TP_LINK_SU');
assert.deepEqual([...result.suFeatures],['Proxy','encryptor','url','modelManager']);
assert(result.assetClasses.includes('LOGIN_MODULE'));
assert(result.assetClasses.includes('CRYPTO_MODULE'));
assert(result.assetClasses.includes('SETUP_MODULE'));
assert(result.assetClasses.includes('MODEL_PROXY_MODULE'));
assert.equal(result.credentialValuesRead,false);
assert.equal(result.readOnly,true);
assert.equal(passwordRead,0);
for(const secret of ['PRIVATE_SESSION','PRIVATE_KEY','192.168.0.1','/web/login/login.js']){
  assert(!JSON.stringify(result).includes(secret),'secret or URL leaked: '+secret);
}
const notFound=c64.inspectLoginSurface({querySelectorAll:()=>[]},{});
assert.equal(notFound.form,'UNKNOWN');
assert.equal(notFound.framework,'UNKNOWN');
const create=c64.inspectLoginSurface({querySelectorAll:sel=>
  sel==='input[type=password]'?[{},{}]:[]},{});
assert.equal(create.form,'CREATE_PASSWORD_CANDIDATE');
const source=fs.readFileSync(src,'utf8');
assert(!/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/.test(source),
  'C64 passive driver must never initiate a request');
console.log('PASS C64 login surface hints, no URL/credentials, no CGI, no mutation');
