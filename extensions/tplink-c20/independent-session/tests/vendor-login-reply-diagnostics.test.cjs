const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const proto=require('../protocol.js');
const ok=proto.parseLoginResult('[cgi]0\r\n$.ret=0;\r\n[error]0');
assert.deepEqual({status:ok.status,code:ok.code,errorCode:ok.errorCode,retCode:ok.retCode},
 {status:'ZERO_ACK_ONLY',code:null,errorCode:0,retCode:0});
const genuine=proto.parseLoginResult('[cgi]0\r\n$.ret=713;\r\n[error]713');
assert.equal(genuine.rejected,true);assert.equal(genuine.code,713);
// Real bug in 0.6.8: [error]0 concealed $.ret=904 in diagnostic.code.
const divergent=proto.parseLoginResult('[cgi]0\r\n$.ret=904;\r\n[error]0');
assert.equal(divergent.rejected,true);assert.equal(divergent.code,904);
assert.equal(divergent.retCode,904);assert.equal(divergent.errorCode,0);
const reverse=proto.parseLoginResult('[cgi]0\r\n$.ret=0;\r\n[error]999');
assert.equal(reverse.code,999);assert.equal(reverse.retCode,0);
const empty=proto.parseLoginResult('not a CGI status');assert.equal(empty.status,'NO_VENDOR_STATUS');
const bg=fs.readFileSync(path.join(root,'background.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'setup.js'),'utf8');
const vendor=fs.readFileSync(path.join(root,'offscreen-vendor-control-main.js'),'utf8');
const relay=fs.readFileSync(path.join(root,'offscreen-controller.js'),'utf8');
assert(bg.includes('vendorRetCode=verdict.retCode'));
assert(bg.includes('vendorErrorCode=verdict.errorCode'));
assert(bg.includes("offscreenCommand('loginSchema')"));
assert(ui.includes('OFFSCREEN_LOGIN_SCHEMA'));
assert(ui.includes(' vendorRet='));
assert(vendor.includes("e.data.command==='loginSchema'"));
assert(vendor.includes('HEURISTIC_NOT_WIRE_PROOF'));
assert(relay.includes("'loginSchema'"));
console.log('PASS: distinct vendor return codes and read-only login schema evidence');
