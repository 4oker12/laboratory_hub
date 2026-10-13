(() => {
  'use strict';
  if (window !== window.top || document.getElementById('routerlab-field-test')) return;
  const host=document.createElement('div');
  host.id='routerlab-field-test';
  host.style.cssText='all:initial;position:fixed;right:14px;top:14px;z-index:2147483647';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>*{box-sizing:border-box}section{width:min(345px,calc(100vw - 28px));max-height:80vh;overflow:auto;background:white;color:#1b2636;border:1px solid #adbed3;border-top:3px solid #294875;border-radius:12px;padding:14px;box-shadow:0 8px 32px #0003;font:13px/1.5 system-ui,sans-serif}header{display:flex;align-items:center;justify-content:space-between;gap:8px}b{font-size:15px}p{color:#566379}button{font:inherit;cursor:pointer;border:1px solid #294875;border-radius:8px;background:#294875;color:white;padding:8px 11px}button:disabled{opacity:.55}.secondary{color:#294875;background:white}pre{background:#eff3f9;border-radius:8px;padding:9px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}.buttons{display:flex;flex-wrap:wrap;gap:8px}</style><section><header><b>RouterLab · Cudy</b><button class="secondary" id="close">×</button></header><p>Автономная проверка Cudy. Только чтение. Интернет не требуется.</p><div class="buttons"><button id="run">Проверить</button><button class="secondary" id="copy">Копировать</button></div><pre id="log">Ожидание запуска.</pre><small>0.1 · Без изменения настроек</small></section>`;
  document.documentElement.appendChild(host);
  const run=root.getElementById('run'),log=root.getElementById('log'),lines=[];
  function say(s){lines.push(s);log.textContent=lines.join('\n')}
  const request=(path,options={})=>fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(9000),...options});
  async function probe(){
    run.disabled=true;lines.length=0;say('Origin: '+location.origin);
    for(const [label,path,target] of [
      ['LuCI','/cgi-bin/luci',null],
      ['WAN','/cgi-bin/luci/admin/network/wan/config/detail?nomodal=&nextbtn=&proto=dhcp','cbid.network.wan.proto'],
      ['Wi-Fi','/cgi-bin/luci/admin/network/wireless/config/simple?embedded=&nextbtn=','cbid.wireless.wlan00.ssid']
    ]){
      try{
        const r=await request(path);
        const doc=new DOMParser().parseFromString(await r.text(),'text/html');
        const names=new Set([...doc.querySelectorAll('input[name],select[name]')].map(e=>e.getAttribute('name')));
        say(label+': HTTP '+r.status+(target?' field='+(names.has(target)?'YES':'NO'):'')+' login='+(names.has('luci_password')||names.has('luci_password2')?'YES':'NO'));
      }catch(e){say(label+': ERROR '+e.name)}
    }
    try{
      const r=await request('/cgi-bin/luci/rpc/app',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'wifi.getstatus',params:['wlan00']})});
      const j=await r.json();
      say('RPC wifi.getstatus: HTTP '+r.status+' result='+Boolean(j?.result!=null)+' error='+Boolean(j?.error!=null));
    }catch(e){say('RPC wifi.getstatus: ERROR '+e.name)}
    say('Complete: read-only');run.disabled=false;
  }
  root.getElementById('run').onclick=probe;
  root.getElementById('close').onclick=()=>host.remove();
  root.getElementById('copy').onclick=()=>{if(lines.length)navigator.clipboard?.writeText(lines.join('\n')).catch(()=>{})};
})();