"use strict";
(() => {
 if(globalThis.__RouterLabC20Mounted){return;}
 const L=globalThis.RouterLabC20Logic;
 if(!L)throw Error("Missing logic.js");
 const host=document.createElement("div");host.id="routerlab-c20-root";
 const shadow=host.attachShadow({mode:"open"});shadow.innerHTML="<style>\n:host{all:initial}*{box-sizing:border-box}\naside{position:fixed;top:12px;right:12px;z-index:2147483647;width:355px;max-height:calc(100vh - 24px);max-width:calc(100vw - 24px);overflow:auto;padding:15px;border-radius:14px;border:1px solid #cbd5e1;box-shadow:0 10px 40px #0004;background:#fff;color:#172036;font:13px/1.4 system-ui}\nheader{display:flex;align-items:center;justify-content:space-between}h1{font-size:16px;margin:0}h2{font-size:13px;margin:10px 0 3px}\nlabel{display:block;margin:6px 0 2px}input,select{width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:#172036}input[type=radio]{width:auto}small{color:#64748b}\n.row,.modes{display:flex;gap:8px}.row>div{flex:1;min-width:0}.modes label{flex:1}\n.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}button{border:1px solid #cbd5e1;border-radius:7px;background:#f1f5f9;color:#172036;padding:8px;cursor:pointer;font:inherit}\nbutton.primary{background:#772450;color:white;border-color:#772450}button:disabled{opacity:.4;cursor:default}#msg{white-space:pre-wrap;background:#f1f5f9;border-radius:7px;padding:8px;margin-top:12px;max-height:155px;overflow:auto}#ppp,#admin{display:none}\n</style><aside aria-label=\"RouterLab\"><header><h1>RouterLab · TP-Link C20 v5</h1><button id=\"close\">×</button></header>\n<p><small>Локальное управление через штатный интерфейс. Пароли не сохраняются и не отправляются расширением.</small></p>\n<div class=\"modes\"><label><input name=\"mode\" type=\"radio\" value=\"first\" checked> Первый запуск</label><label><input name=\"mode\" type=\"radio\" value=\"edit\"> Изменить параметры</label></div>\n<p id=\"state\">Экран ещё не определён</p>\n<div id=\"admin\"><label><input id=\"confirmedFactory\" type=\"checkbox\" style=\"width:auto\"> Проверил наклейку: Archer C20 v5</label><h2>Создание пароля администратора</h2><label>Пароль</label><input id=\"adminPass\" type=\"password\"></div>\n<h2>WAN</h2><select id=\"wan\"><option value=\"dhcp\">Dynamic IP / DHCP</option><option value=\"pppoe\">PPPoE</option><option value=\"unchanged\">Не изменять</option></select>\n<div id=\"ppp\"><label>PPPoE логин</label><input id=\"pppoeUser\"><label>PPPoE пароль</label><input id=\"pppoePass\" type=\"password\"></div>\n<h2>Wi-Fi</h2><div class=\"row\"><div><label>SSID 2.4 ГГц</label><input id=\"ssid24\"></div><div><label>Пароль 2.4 ГГц</label><input id=\"pass24\" type=\"password\"></div></div>\n<div class=\"row\"><div><label>SSID 5 ГГц</label><input id=\"ssid5\"></div><div><label>Пароль 5 ГГц</label><input id=\"pass5\" type=\"password\"></div></div>\n<div class=\"actions\"><button id=\"scan\">Определить</button><button id=\"quick\">Quick Setup</button>\n<button id=\"openWan\">Открыть WAN</button><button id=\"openWifi\">Открыть Wi-Fi</button>\n<button id=\"fill\" class=\"primary\">Заполнить форму</button><button id=\"next\">Далее</button>\n<button id=\"save\" class=\"primary\">Сохранить</button><button id=\"verify\">Проверить</button></div>\n<div id=\"msg\" role=\"status\">Работаем со штатной страницей роутера. Перед сохранением проверьте её поля.</div>\n<p><small>Изменения WAN или Wi-Fi могут разорвать соединение. После повторного подключения проверьте результат.</small></p></aside>";
 document.documentElement.appendChild(host);
 const $=id=>shadow.getElementById(id);
 const msg=s=>$("msg").textContent=String(s);
 let last=null;
 function visible(el){
   if(!el||!el.isConnected||el.closest("#routerlab-c20-root"))return false;
   const s=el.ownerDocument.defaultView.getComputedStyle(el);
   return s.display!=="none"&&s.visibility!=="hidden"&&!!el.getClientRects().length;
 }
 function roots(){
   const a=[document];
   for(const f of document.querySelectorAll("iframe"))try{if(visible(f)&&f.contentDocument?.body)a.push(f.contentDocument)}catch{}
   return a;
 }
 function all(selector){return roots().flatMap(d=>Array.from(d.querySelectorAll(selector)).filter(visible))}
 function byId(id){return all("[id]").find(e=>e.id===id)||null}
 function key(el){return L.normalize([el.id,el.name,el.getAttribute("placeholder")].join(" "))}
 function state(){
   const fields=all("input,select,textarea");
   const controls=fields.map(el=>key(el));
   const text=roots().map(r=>r.body?.innerText||"").join(" ").slice(0,18000);
   return {title:document.title,device:byId("bot_hver")?.value||byId("bot_hver")?.textContent||"",
    firmware:byId("bot_sver")?.value||byId("bot_sver")?.textContent||"",
    text,ids:all("[id]").map(e=>e.id),fields:fields.filter(e=>e.tagName==="INPUT").map(e=>({type:e.type||"text"})),
    hasWanControl:controls.some(s=>/wan.*type|conn.*type|pppoe|pppuser|pppusr/.test(s)),
    hasWifiControl:controls.some(s=>/ssid/.test(s)),
    hasQuickSetupMenu:!!byId("qs")};
 }
 function form(){return Object.fromEntries(["wan","adminPass","pppoeUser","pppoePass","ssid24","pass24","ssid5","pass5"].map(k=>[k,$(k).value]));}
 function mode(){return shadow.querySelector('input[name="mode"]:checked').value}
 function scan(){
   const s=state(),screen=L.classify(s),v=L.verifyModel(s);
   if(!v.ok && screen==="factory" && /archer c20/i.test(s.title) && $("confirmedFactory").checked){v.ok=true;v.why="Подтверждено пользователем по наклейке устройства";}
   $("state").textContent="Экран: "+screen+" · "+(v.ok?"Archer C20 v5 подтверждён":"Запись заблокирована");
   $("admin").style.display=screen==="factory"?"block":"none";
   $("fill").disabled=!v.ok||!["factory","wizard_wifi","edit_wifi","wizard_isp","wan"].includes(screen);
   $("next").disabled=!v.ok||!["factory","wizard_isp","wizard_vlan","wizard_wifi","wan"].includes(screen);
   $("save").disabled=!v.ok||!["wizard_summary","wan","edit_wifi"].includes(screen);
   $("verify").disabled=!last||!v.ok;
   return {s,screen,v};
 }
 function guard(validate=true){
   const a=scan();if(!a.v.ok)throw Error(a.v.why);
   if(validate){const errors=L.validate(form(),mode());if(errors.length)throw Error(errors.join("\n"));}
   return a;
 }
 function write(el,value){
   if(!el)throw Error("Поле на странице роутера не найдено");
   const p=el.tagName==="SELECT"?el.ownerDocument.defaultView.HTMLSelectElement.prototype:
     el.tagName==="TEXTAREA"?el.ownerDocument.defaultView.HTMLTextAreaElement.prototype:el.ownerDocument.defaultView.HTMLInputElement.prototype;
   const setter=Object.getOwnPropertyDescriptor(p,"value")?.set;
   if(setter)setter.call(el,value);else el.value=value;
   const w=el.ownerDocument.defaultView;
   el.dispatchEvent(new w.Event("input",{bubbles:true}));el.dispatchEvent(new w.Event("change",{bubbles:true}));
   if(el.value!==value)throw Error("Устройство отклонило значение поля");
 }
 function field(ids,regex,type){
   for(const k of ids){const el=byId(k);if(el&&(!type||el.type===type))return el}
   const matches=all("input,textarea,select").filter(e=>regex.test(key(e))&&(!type||e.type===type));
   if(matches.length!==1)throw Error("Поле неоднозначно ("+matches.length+"): "+ids.join("/"));
   return matches[0];
 }
 function action(ids,rx){
   for(const k of ids){const b=byId(k);if(b&&visible(b))return b;}
   const found=all("button,a,input[type=submit],span").filter(el=>rx.test(L.normalize(el.innerText||el.value||"")) &&
     !Array.from(el.children).some(c=>rx.test(L.normalize(c.innerText||""))));
   if(found.length!==1)throw Error("Неоднозначное действие ("+found.length+"): "+rx);
   return found[0];
 }
 function clickNative(el){if(!visible(el))throw Error("Штатная кнопка скрыта");el.click()}
 function nav(which){
   guard(false);
   if(which==="quick"){const menu=byId("qs");clickNative((menu&&Array.from(menu.querySelectorAll("span,a")).find(visible))||menu||action([],/^(быстрая настройка|quick setup)$/));return;}
   clickNative(action([],which==="wan"?/^(интернет|internet)$/:/^(беспроводной режим|wireless)$/));
 }
 function wan(f){
   if(f.wan==="unchanged")return "WAN оставлен без изменений";
   const selects=all("select").filter(el=>Array.from(el.options).some(o=>/pppoe/i.test(o.text+" "+o.value)));
   if(selects.length!==1)throw Error("WAN-селектор не обнаружен однозначно. Нужна сверка штатной формы/прошивки.");
   const sel=selects[0],opt=Array.from(sel.options).find(o=>f.wan==="pppoe"?/pppoe/i.test(o.text+" "+o.value):/dhcp|dynamic|динамич/i.test(o.text+" "+o.value));
   if(!opt)throw Error("Запрошенный тип WAN отсутствует");
   write(sel,opt.value);
   if(f.wan==="pppoe"){
     write(field(["pppUser","pppoeUsername","pppoeUser","pppUsr"],/ppp.*(user|usr|name)/),f.pppoeUser.trim());
     write(field(["pppPassword","pppoePassword","pppoePass","pppPwd"],/ppp.*(password|pass|pwd)/),f.pppoePass);
   }
   return "WAN "+f.wan+" подготовлен в штатной форме";
 }
 function wifi(f){
   let count=0;
   for(const band of ["24","5"]){
     const name=f["ssid"+band],pass=f["pass"+band];
     if(!name&&!pass)continue;
     const b=band==="24"?"(?:24|2g|2\\.4)":"(?:5g|5ghz|5)";
     if(name){const e=field(band==="24"?["wl24gssid","ssid24"]:["wl5gssid","ssid5"],new RegExp("(?=.*ssid)(?=.*"+b+")","i"));write(e,name);count++;}
     if(pass){const e=field(band==="24"?["wl24gpwd","pass24"]:["wl5gpwd","pass5"],new RegExp("(?=.*(?:pwd|pass))(?=.*"+b+")","i"),"password");write(e,pass);count++;}
   }
   if(!count)throw Error("Для Wi-Fi не заданы параметры");
   return "Wi-Fi поля заполнены ("+count+"), но ещё не сохранены";
 }
 function fill(){
   const {screen}=guard(false),f=form();
   if(screen==="factory"){
     if(!f.adminPass)throw Error("Укажите первый пароль администратора");
     const fields=all('input[type="password"]');
     if(fields.length!==2)throw Error("Ожидалось два поля создания пароля");
     write(fields[0],f.adminPass);write(fields[1],f.adminPass);
     msg("Пароль введён в штатные поля. Нажмите «Далее» после проверки.");return;
   }
   if(["wizard_wifi","edit_wifi"].includes(screen)){msg(wifi(f));return}
   if(["wizard_isp","wan"].includes(screen)){msg(wan(f));return}
   throw Error("Неизвестный экран для заполнения: "+screen);
 }
 function next(){
   const {screen}=guard(false);
   if(screen==="factory"){clickNative(action([],/^(let.s begin|начать|сохранить|create|start|далее|подтвердить)$/));}
   else if(["wizard_isp","wizard_vlan","wizard_wifi","wan"].includes(screen)){clickNative(action(["next_button","next"],/^(далее|next)$/));}
   else throw Error("Невозможно перейти дальше с этого экрана");
   msg("Нажата штатная кнопка перехода. После загрузки проверьте новый экран.");
 }
 function save(){
   const {screen}=guard(false);
   const validation=L.validate(form(),mode());if(validation.length)throw Error(validation.join("\n"));
   if(!["wizard_summary","wan","edit_wifi"].includes(screen))throw Error("На этом экране сохранение не поддерживается");
   if(!window.confirm("Применить изменения на роутере? Возможен обрыв соединения."))return;
   const f=form();
   last={wan:f.wan,ssid24:f.ssid24,ssid5:f.ssid5,at:Date.now()};
   clickNative(action(["save"],/^(сохранить|save|применить|apply)$/));
   msg("Штатная кнопка сохранения нажата. РЕЗУЛЬТАТ НЕ ПОДТВЕРЖДЁН: вернитесь к настройкам и выполните проверку.");
 }
 function verify(){
   guard(false);if(!last)throw Error("Нет сохранённой попытки");
   const lines=[];
   for(const band of ["24","5"]){
     if(!last["ssid"+band])continue;
     const input=byId(band==="24"?"wl24gssid":"wl5gssid");
     lines.push("SSID "+band+": "+(!input?"недоступен":input.value===last["ssid"+band]?"совпадает":"РАСХОЖДЕНИЕ"));
   }
   if(last.wan!=="unchanged"){
     const sels=all("select").filter(el=>Array.from(el.options).some(o=>/pppoe/i.test(o.text+" "+o.value)));
     const val=sels.length===1?(sels[0].selectedOptions[0]?.text||"")+" "+sels[0].value:null;
     lines.push("WAN: "+(!val?"недоступен":last.wan==="pppoe"?(/pppoe/i.test(val)?"совпадает":"РАСХОЖДЕНИЕ"):(/dynamic|dhcp|динамич/i.test(val)?"совпадает":"РАСХОЖДЕНИЕ")));
   }
   msg((lines.length?lines.join("\n"):"Нет читаемых полей на этом экране")+
   "\nПроверка ограничена видимыми полями: пароль, перезагрузка и доступ в интернет требуют отдельной проверки.");
 }
 function safe(fn){try{fn();scan();}catch(e){msg("Остановлено: "+(e?.message||String(e)));scan()}}
 $("close").onclick=()=>{host.remove();delete globalThis.__RouterLabC20Mounted};
 $("confirmedFactory").onchange=scan;
 $("wan").onchange=()=>$("ppp").style.display=$("wan").value==="pppoe"?"block":"none";
 shadow.querySelectorAll('input[name="mode"]').forEach(el=>el.onchange=()=>{
   $("wan").value=mode()==="edit"?"unchanged":"dhcp";$("ppp").style.display="none";scan();
 });
 $("scan").onclick=()=>safe(()=>{const a=scan();msg("Экран: "+a.screen+"\n"+(a.v.ok?"Модель подтверждена":a.v.why));});
 $("quick").onclick=()=>safe(()=>nav("quick"));
 $("openWan").onclick=()=>safe(()=>nav("wan"));
 $("openWifi").onclick=()=>safe(()=>nav("wifi"));
 $("fill").onclick=()=>safe(fill);$("next").onclick=()=>safe(next);
 $("save").onclick=()=>safe(save);$("verify").onclick=()=>safe(verify);
 globalThis.__RouterLabC20Mounted={host};
 scan();
})();