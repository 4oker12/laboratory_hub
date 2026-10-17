'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const ranges=[
 ['async function nativeSetWifiCore(req)','async function nativeSetWifi(req)'],
 ['async function checkPendingWifi()','// The stock reboot control'],
 ['async function requestStockReboot()','async function confirmPhysicalWifi()']
];
const segments=ranges.map(([a,b])=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert(i!==-1&&j>i);return source.slice(i,j)}).join('\n');
// Static regression for the signal separation and fencing around the vendor reboot click.
assert.match(segments,/configVerified:true,applied:false/);
assert.match(segments,/stage:'CONFIG_SAVED_AWAIT_APPLY'/);
assert.match(segments,/REBOOT_CONTROL_MAY_HAVE_BEEN_ACTIVATED/);
assert.match(segments,/STOCK_REBOOT_CONTROL_CLICKED_NOT_PROOF_OF_REBOOT/);
assert.doesNotMatch(segments,/if\(namesMatch&&!req\.password\)\{await setPending\(null\)/);
new vm.Script(segments);
console.log('PASS: WLAN readback remains CONFIG_SAVED; stock reboot fenced before click, on-air confirmation separated');
