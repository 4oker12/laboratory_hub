'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const mod=require(path.join(__dirname,'../RouterLabMobile/Resources/RouterLabC64ReadOnly.js'));
const response=[
 '00000','id 0|1,0,0','modelName Archer%20C64',
 'hardVer Archer%20C64%201.0',
 'softVer 1.13.2%20Build%20230824%20Rel.74702n(4555)',
 'countryCode UA','privateUnknownKey DO_NOT_EXPORT'
].join('\r\n')+'\r\n';
async function main(){
 const v=mod.parseDeviceInfo(response);
 assert.equal(v.ok,true);
 assert.equal(v.model,'Archer C64');
 assert.equal(v.hardware,'V1.0');
 assert.equal(v.build,'230824');
 assert.equal(v.firmware,'1.13.2 Build 230824 Rel.74702n(4555)');
 assert.equal(v.firmwareProtocolVerified,false);
 assert.equal(v.authenticated,false);
 assert.equal(v.canWrite,false);
 assert(!JSON.stringify(v).includes('DO_NOT_EXPORT'));
 const mismatch=mod.parseDeviceInfo(response.replace('modelName Archer%20C64','modelName Archer%20C54'));
 assert.equal(mismatch.reason,'MODEL_MISMATCH');
 assert.equal(mod.parseDeviceInfo('00000\r\nid 100|1,0,0').ok,false);
 assert.equal(mod.parseDeviceInfo('bad').ok,false);
 const requests=[];
 const w={
  location:{protocol:'http:',hostname:'192.168.0.1'},
  document:{},
  RouterLabC64Driver:{detect:()=>({framework:'TPLINK_SU_CANDIDATE'})},
  async fetch(url,options){
    requests.push({url,options});
    return {status:200,text:async()=>response};
  }
 };
 const opts={profileId:'tplink-archer-c64',userInitiated:true};
 const ok=await mod.readIdentity(w,opts);
 assert.equal(ok.ok,true);
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/?code=2&asyn=1');
 assert.equal(requests[0].options.body,'0|1,0,0');
 assert.equal(requests[0].options.method,'POST');
 assert.equal(requests[0].options.credentials,'same-origin');
 assert.equal(requests[0].options.redirect,'error');
 assert.equal(requests[0].options.headers['Content-Type'],'text/plain;charset=UTF-8');
 assert.equal((await mod.readIdentity(w,{...opts,userInitiated:false})).ok,false);
 assert.equal((await mod.readIdentity(w,{...opts,profileId:'tplink-archer-c54'})).ok,false);
 assert.equal(requests.length,1,'No implicit/foreign-model requests');
 const bad={...w,location:{protocol:'http:',hostname:'remote.example.com'}};
 assert.equal((await mod.readIdentity(bad,opts)).ok,false);
 const otherFamily={...w,RouterLabC64Driver:{detect:()=>({framework:'UNKNOWN'})}};
 assert.equal((await mod.readIdentity(otherFamily,opts)).ok,false);
 assert.equal(requests.length,1);
 assert.equal(mod.privateIPv4('192.168.0.1'),true);
 assert.equal(mod.privateIPv4('10.9.0.1'),true);
 assert.equal(mod.privateIPv4('172.16.10.1'),true);
 assert.equal(mod.privateIPv4('172.32.0.1'),false);
 assert.equal(mod.privateIPv4('8.8.8.8'),false);
 console.log('PASS C64 V1 hardware/firmware real HAR read, opt-in private origin, no SET/auth/tokens');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
