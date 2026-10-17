'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const P=require('../protocol.js');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const secret='SENSITIVE_TOKEN_DO_NOT_PRINT';
const hints=P.loginSessionHints('[cgi]0\r\n$.ret=0;\r\nvar token="'+secret+'";\r\nJSESSIONID=PRIVATE_COOKIE;');
assert.deepEqual(hints,{tokenFieldPresent:true,cookieFieldPresent:true});
assert(!JSON.stringify(hints).includes(secret));
assert.deepEqual(P.loginSessionHints('[cgi]0\r\n$.ret=0;\r\n[error]0'),{
 tokenFieldPresent:false,cookieFieldPresent:false
});
const bg=read('background.js');
const ui=read('setup.js');
assert.match(bg,/session\.token&&transport!=='offscreen-rpc'\)headers\.TokenID=session\.token/);
assert.match(bg,/postLoginFrameTransition/);
assert.match(bg,/STOCK_POSTLOGIN_PROTECTED_WLAN_READ_CONFIRMED/);
assert.match(bg,/noAutoReadRetry:true,noAutoLoginRetry:true/);
assert.match(ui,/loginTokenFieldPresent/);
assert.match(ui,/postLoginFrameTransition/);
console.log('PASS: real-stock TokenID header policy, safe marker-only login diagnostics, bounded post-login navigation');
