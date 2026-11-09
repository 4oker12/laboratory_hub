'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const script=fs.readFileSync(
  path.resolve(__dirname,'../../../devices/tplink/archer-ax23-v1-eu/softdevice-browser-bridge.js'),
  'utf8'
);
const stok='a'.repeat(32);
const base='http://127.0.0.1:18023/cgi-bin/luci/;stok='+stok;
function harness(hostname='127.0.0.1'){
 let forwarded=[],native=0;
 function Connection(){}
 Connection.prototype.request=function(){native++;};
 const window={
  location:{hostname, origin:'http://127.0.0.1:18023',
            href:'http://127.0.0.1:18023/webpages/index.html'},
  __ROUTERLAB_AX23_SOFTDEVICE__:{port:18024,key:'T'.repeat(64)}
 };
 window.jQuery={su:{Connection}};
 const ctx={window, URL, AbortController,
   fetch:async (url,init)=>{
    forwarded.push({url,init,model:JSON.parse(init.body)});
    return {ok:true,json:async()=>({success:true,data:
      {network_conntype:'dhcp',auto_upgrade_enable:'off'}})};
   }};
 vm.runInNewContext(script,ctx);
 return {window,Connection,get native(){return native},forwarded};
}

test('genuine stock login and factory setup remain on vendor native backend',()=>{
 const h=harness();
 const x=new h.Connection();
 x.request({url:'http://127.0.0.1:18023/cgi-bin/luci/login?form=login',
            data:{operation:'write'}});
 x.request({url:'http://127.0.0.1:18023/cgi-bin/luci/admin/quick_setup?form=quick_setup',
            data:{operation:'write'}});
 assert.equal(h.native,2);
 assert.equal(h.forwarded.length,0);
});
test('real stock QS token path resolves software device and original decorated callback',async()=>{
 const h=harness();
 let result;
 const x=new h.Connection();
 const op={url:base+'/admin/quick_setup?form=quick_setup',
           data:{operation:'write',auto_upgrade_enable:'off',network_conntype:'dhcp'},
           success:(r)=>{result=r;}};
 x.request(op);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.native,0);
 assert.equal(h.forwarded.length,1);
 assert.equal(h.forwarded[0].model.group,'quick_setup');
 assert.equal(h.forwarded[0].model.form,'quick_setup');
 assert.equal(h.forwarded[0].model.operation,'write');
 assert.equal(h.forwarded[0].model.data.operation,undefined);
 assert.equal(h.forwarded[0].model.data.network_conntype,'dhcp');
 assert.equal(op.noneEncrypt,true);
 assert.equal(result.success,true);
 assert.equal(result.data.network_conntype,'dhcp');
 assert.equal(h.window.RouterLabAX23SoftwareDevice.hardwareApplied,false);
});
test('unsupported form is forwarded to genuine stock handler',()=>{
 const h=harness();
 const x=new h.Connection();
 x.request({url:base+'/admin/parental_controls?form=rules',
            data:{operation:'read'}});
 assert.equal(h.native,1);
});
test('never activate outside localhost',()=>{
 const h=harness('example.invalid');
 const x=new h.Connection();
 x.request({url:base+'/admin/quick_setup?form=quick_setup'});
 assert.equal(h.native,1);
});
