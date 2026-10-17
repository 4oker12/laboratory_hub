'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'..');
let docText='Archer C20 Быстрая настройка Основные настройки Тип подключения: Динамический IP-адрес Интернет';
let activeWizard=false;
const hidden={disabled:false,getClientRects:()=>[]},visible={disabled:false,getClientRects:()=>[1]};
const doc={title:'Archer C20',body:{get innerText(){return docText}},querySelectorAll:s=>{
 if(s==='input[type="password"]'||s.startsWith('button'))return [];
 if(s.includes('quicksetup_isp_container'))return activeWizard?[visible]:[hidden];
 return [];
}};
const chrome={runtime:{getURL:x=>'chrome-extension://test/'+x,onInstalled:{addListener(){}},onMessage:{addListener(){}}},action:{onClicked:{addListener(){}}},
 tabs:{onRemoved:{addListener(){}},query:async()=>[{id:1,url:'http://192.168.0.1/'}]},
 scripting:{executeScript:async({func,args})=>[{result:vm.runInNewContext('('+func.toString()+')(...args)',{document:doc,location:{origin:'http://192.168.0.1'},window:{$:{io(){}}},args:args||[]})}]}};
const ctx=vm.createContext({chrome,Date,Promise,setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,AbortController,console});
ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),ctx));
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
(async()=>{
 let r=await vm.runInContext('inspectNative()',ctx);
 assert.equal(r.stage,'CONFIGURED_AUTHENTICATED');
 docText='Archer C20 Быстрая настройка Выберите поставщика интернет-услуг Страна';activeWizard=true;
 r=await vm.runInContext('inspectNative()',ctx);
 assert.equal(r.stage,'QUICK_SETUP_ACTIVE');
 console.log('PASS: Quick Setup nav is not active wizard; active wizard is recognized');
})().catch(e=>{console.error(e);process.exitCode=1});
