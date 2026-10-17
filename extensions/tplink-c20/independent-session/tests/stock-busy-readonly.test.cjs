'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const bg=fs.readFileSync(path.join(root,'background.js'),'utf8');
const main=fs.readFileSync(path.join(root,'offscreen-vendor-control-main.js'),'utf8');
const setup=fs.readFileSync(path.join(root,'setup.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'setup.js'),'utf8');
const from=bg.indexOf('function parseBusyReply(body){');
const to=bg.indexOf('async function inspectBusyReadOnly()',from);
assert(from>=0&&to>from,'standalone strict busy parser found');
const parse=vm.runInNewContext(bg.slice(from,to)+'\nparseBusyReply;');
for(const [raw,login,busy] of [
  ['var isLogined=0;\nvar isBusy=1;',false,true],
  ['isLogined = true; isBusy=false;',true,false],
  ['isLogined=1;\r\nisBusy=0;',true,false],
  ['isLogined=1; isLogined=0; isBusy=1;',null,true],
  ['$.ret=0;',null,null],
  ['var isLogined="false"; isBusy="true";',null,null]
]){
 const result=parse(raw);
 assert.equal(result.isLogined,login,'isLogined '+raw);
 assert.equal(result.isBusy,busy,'isBusy '+raw);
}
assert.match(bg,/offscreenHttp\('\/cgi\/getBusy','POST',null,\{\},'STOCK_BUSY_READ_ONLY'\)/);
assert.match(bg,/case 'c20.inspectBusyReadOnly':return await inspectBusyReadOnly\(\)/);
assert.match(main,/\/cgi\/getBusy/);
assert.match(main,/path==='\/cgi\/getBusy'&&method!=='POST'/);
assert.match(setup,/id="inspectBusy"/);
assert.doesNotMatch(setup,/при ручном открытии 192\.168\.0\.1 появляется мастер/);
assert.match(ui,/STOCK_BUSY_CHECK http=/);
assert.match(ui,/passwordSent=false/);
console.log('PASS: stock getBusy probe is read-only, strictly parsed, and does not require manual stock login');
