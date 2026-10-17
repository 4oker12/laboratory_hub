'use strict';
// Minimal native tpSelect mock based on physical C20 trace:
// #_select_country -> #_select_city -> #_select_isp -> #_select_wan_type.
const choices={
 select_country:['Украина'],
 select_city:['все'],
 select_isp:['Воля'],
 select_wan_type:['Динамический IP-адрес']
};
function mock(opts={}){
 const missing=new Set(opts.missing||[]),calls=[],vendorData=new Map();
 let nextClicks=0;
 const createSelect=(id)=>({id,value:'0',options:[{value:'0',text:'-Выберите из списка-'}],getClientRects:()=>[1],dispatchEvent(){} });
 const country=createSelect('select_country');
 country.options.push({value:'Украина',text:'Украина'});
 const city=createSelect('select_city'),isp=createSelect('select_isp'),wan=createSelect('select_wan_type');
 const next={id:'next_button',disabled:false,getClientRects:()=>[1],click(){nextClicks++;calls.push('NEXT')}};
 const container={id:'quicksetup_isp_container',getClientRects:()=>[1]};
 const el={select_country:country,select_city:city,select_isp:isp,select_wan_type:wan,next_button:next,quicksetup_isp_container:container};
 const dependent={select_country:city,select_city:isp,select_isp:wan};
 function setSelection(id,value){
  const s=el[id];s.value=value;vendorData.set(s,value);calls.push(id+'='+value);
  const child=dependent[id];
  if(child){
   vendorData.delete(child);child.value='0';child.options=[{value:'0',text:'-Выберите из списка-'}];
   const nextId=child.id;
   for(const text of choices[nextId])child.options.push({value:text,text});
  }
 }
 for(const id of Object.keys(choices)){
  el['_'+id]={id:'_'+id,querySelector(selector){
   if(selector!=='.tp-select .select-box'||missing.has('box_'+id))return null;
   return {click(){calls.push('open:'+id)}};
  },querySelectorAll(selector){
   if(selector!=='li.option-item[data-val]')return[];
   return el[id].options.slice(1).map(o=>({
     getAttribute:k=>k==='data-val'?o.value:null,
     click(){if(!missing.has('ack_'+id))setSelection(id,o.value)}
   }));
  }};
 }
 for(const id of missing)if(el[id])delete el[id];
 function $(node){return{data(key){return key==='value'?vendorData.get(node):undefined}}}
 const document={title:'Archer C20',body:{innerText:'Быстрая настройка WAN'},
  getElementById:id=>el[id]||null,querySelectorAll:()=>Object.values(el)};
 return {el,document,$,calls,get nextClicks(){return nextClicks}};
}
module.exports={mock};
