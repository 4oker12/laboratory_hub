/* RouterLab iPhone Netis N2 FW4 Pilot
 * Runs INSIDE the stock Netis origin in WKWebView; no Chrome APIs, no server.
 * Hardware trace: Pilot 5 on N2-V4.0.1.4317/CIS. Single factory SET, never retry.
 */
(() => {
  'use strict';
  if (window.__RouterLabNetisPilot) return;
  const api = window.RouterLabNetisFW4;
  if (!api || !document.body) return;
  let driver;
  try {
    driver = new api.NetisFW4Adapter({
      transport: api.createFetchTransport({baseUrl: location.origin + '/'})
    });
  } catch (_) { return; }

  const exactFirmware = 'N2-V4.0.1.4317';
  const markerKey = 'routerlab_netis_n2_fw4_factory_apply_attempt_v1';
  let current = null, guide = null, busy = false, authenticated = false;
  const logs = [];
  const host = document.createElement('div');
  host.id = 'routerlab-netis-ios-pilot';
  const shadow = host.attachShadow({mode:'open'});
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:0;width:100vw;height:100dvh;min-height:100vh;background:#f3f7fa;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;';
  shadow.innerHTML = '<style>' +
    ':host{color-scheme:light}*{box-sizing:border-box}.panel{background:#fff;color:#14212d;box-shadow:0 4px 30px #0004;border:1px solid #d7e0e8;border-radius:0 0 14px 14px;overflow:hidden}' +
    '.top{background:#132b42;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}.top strong{font-size:15px;flex:1}.top button{width:auto;padding:6px 10px;color:#fff;background:#39546b;border:1px solid #678197}' +
    '.content{padding:12px 14px;max-height:72dvh;overflow-y:auto}p{font-size:13px;line-height:1.45;margin:8px 0}#status{font-weight:600}label{display:block;font-size:12px;font-weight:600;margin:10px 0 3px}' +
    'input{width:100%;font:inherit;font-size:15px;padding:10px 9px;border:1px solid #a8b8c6;border-radius:7px}button{cursor:pointer;font-size:13px;font-weight:600;border-radius:7px;padding:10px 11px;border:0;background:#11639c;color:white}' +
    'button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.muted{font-size:12px;color:#516577}.check{display:flex;gap:7px;align-items:flex-start}.check input{width:auto;margin-top:2px}' +
    '#details,#readback{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f0f4f7;border-radius:7px;padding:8px;max-height:130px;overflow:auto}#form,#auth,#pending{display:none}.collapsed .content{display:none}' +
    '</style><div class="panel"><div class="top"><strong>RouterLab · Netis N2</strong><button id="toggle" type="button">Диагностика</button></div>' +
    '<div class="content"><p id="status">Проверяем роутер…</p><p class="muted" id="info">Тестовая iOS-панель, запросы только к текущему роутеру.</p>' +
    '<div class="actions"><button id="refresh" type="button">Обновить состояние</button></div>' +
    '<div id="dashboard" style="display:none" aria-label="Состояние роутера">' +
    '<div class="dash-head">Состояние роутера</div>' +
    '<div class="dash-card"><span>Устройство</span><strong id="dash-device">Netis N2</strong><small id="dash-device-extra">Нет данных</small></div>' +
    '<div class="dash-card"><span>Интернет / WAN</span><strong id="dash-wan">—</strong></div>' +
    '<div class="dash-card"><span>Wi-Fi 2,4 ГГц</span><strong id="dash-2g">—</strong><small id="dash-2g-extra"></small></div>' +
    '<div class="dash-card"><span>Wi-Fi 5 ГГц</span><strong id="dash-5g">—</strong><small id="dash-5g-extra"></small></div>' +
    '<div class="dash-card"><span>IGMP</span><strong id="dash-igmp">—</strong></div>' +
    '<div class="actions"><button id="logout" type="button" class="secondary">Закрыть управление</button></div></div>' +
    '<details id="technical"><summary class="muted">Технические ответы CGI</summary><pre id="readback">CGI ещё не проверены.</pre></details>' +
    '<form id="form" autocomplete="off"><label>Пароль администратора</label><input id="admin" type="password" required autocomplete="new-password" maxlength="64">' +
    '<label>Wi-Fi 2.4 ГГц</label><input id="ssid2" required maxlength="32" autocomplete="off">' +
    '<label>Wi-Fi 5 ГГц</label><input id="ssid5" required maxlength="32" autocomplete="off">' +
    '<label>Пароль Wi-Fi (8–63 символа)</label><input id="wifi" type="password" required minlength="8" maxlength="63" autocomplete="new-password">' +
    '<p class="muted">WAN: DHCP. После применения телефон отключится от текущей сети. Подключитесь к новому Wi-Fi вручную и нажмите «Обновить» в приложении.</p>' +
    '<label class="check"><input id="confirm" type="checkbox">Я подтверждаю однократную запись заводской конфигурации.</label>' +
    '<div class="actions"><button id="apply" type="submit">Применить один раз</button></div></form>' +
    '<div id="pending"><p>Попытка SET уже зарегистрирована. Автоматический повтор запрещён. После ручного подключения к новому Wi-Fi нажмите «Проверить / обновить».</p></div>' +
    '<form id="auth" autocomplete="off"><h2 style="font-size:21px;margin:0 0 8px">Вход в Netis N2</h2>' +
    '<p class="muted">Роутер уже настроен. Введите пароль администратора для открытия RouterLab.</p>' +
    '<label for="login-pass">Пароль администратора Netis</label><input id="login-pass" type="password" required autocomplete="current-password" maxlength="128">' +
    '<p id="auth-error" role="alert" style="display:none;color:#aa2b31;font-size:13px"></p>' +
    '<div class="actions"><button id="login-submit" type="submit">Войти</button></div></form>' +
    '<details><summary class="muted">Диагностика (без паролей)</summary><pre id="details"></pre></details></div></div>';
  const fullScreenStyle = document.createElement('style');
  fullScreenStyle.textContent =
    '.panel{height:100dvh;min-height:100vh;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;background:#f3f7fa}' +
    '.top{padding:18px 16px;flex-shrink:0}.content{flex:1;max-height:none;overflow-y:auto;padding:16px;padding-bottom:32px}' +
    '.content>p#status{font-size:18px;line-height:1.45;margin:7px 0 12px}' +
    '.dash-head{font-size:20px;font-weight:750;margin:22px 0 14px}' +
    '.dash-card{background:#fff;border:1px solid #dbe4ec;border-radius:14px;padding:14px 15px;margin:10px 0;display:flex;flex-direction:column;gap:7px}' +
    '.dash-card span{color:#62768b;font-size:12px}.dash-card strong{color:#182d41;font-size:17px;overflow-wrap:anywhere}' +
    '.dash-card small{font-size:12px;color:#61768a}' +
    'button.secondary{background:#dce9f3;color:#15344e}' +
    '#technical{margin-top:18px}#readback{max-height:260px}form{background:#fff;padding:16px;border-radius:14px;margin-top:16px;border:1px solid #dbe4ec}' +
    '#pending{background:#fff0d9;padding:14px;border-radius:12px;margin-top:14px}' +
    '#dashboard[style*="block"]{padding-bottom:12px}#details{max-height:160px}';
  shadow.appendChild(fullScreenStyle);
  document.body.appendChild(host);
  const el = (name) => shadow.getElementById(name);
  const show = (name, value) => { el(name).style.display = value ? 'block' : 'none'; };
  const status = (value) => { el('status').textContent = value; log(value); };
  let discoveryReported = false;
  function reportDiscovery(supported, model='', version='') {
    if (discoveryReported) return;
    discoveryReported = true;
    // No passwords, cookies, DOM, SSIDs, or arbitrary router data in the bridge.
    try {
      window.webkit?.messageHandlers?.routerlab?.postMessage({
        type:'netisProbe', supported:!!supported, model, version
      });
    } catch (_) { /* Browser-based mock does not provide WebKit. */ }
  }
  function log(message) {
    logs.push(new Date().toLocaleTimeString() + '  ' + String(message).slice(0,160));
    if (logs.length > 28) logs.shift();
    el('details').textContent = logs.join('\n');
  }
  function attempt() {
    try { return JSON.parse(localStorage.getItem(markerKey) || 'null'); }
    catch (_) { return null; }
  }
  function saveAttempt() {
    // Without persistent attempt marker, do NOT send a destructive SET.
    localStorage.setItem(markerKey, JSON.stringify({firmware:exactFirmware,at:Date.now(),origin:location.origin}));
  }
  function clearAttempt() {
    try { localStorage.removeItem(markerKey); } catch (_) {}
  }
  function currentAttempt() {
    const v = attempt();
    return !!v && v.firmware === exactFirmware && v.origin === location.origin;
  }
  function setBusy(value) {
    busy = value;
    ['refresh','apply','login-submit'].forEach(id => { el(id).disabled = value; });
  }
  function freshValues() {
    const input = {adminPassword:el('admin').value,ssid2g:el('ssid2').value,
      ssid5g:el('ssid5').value,wifiPassword:el('wifi').value};
    api.buildFactoryDhcp(input, guide); // validate locally BEFORE recording SET attempt
    return input;
  }
  function errorCode(error) {
    return String(error && error.message || error).slice(0,75);
  }
  function decodeSSID(value) {
    if (typeof value !== 'string' || !value ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw Error('NETIS_WLAN_SSID_ENCODING_UNKNOWN');
    try {
      const raw = atob(value);
      if (raw.length > 32) throw Error('NETIS_SSID_TOO_LARGE');
      return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));
    } catch (_) { throw Error('NETIS_WLAN_SSID_DECODE_FAILED'); }
  }
  function wifiBand(data, key) {
    const index = Number(data[key]);
    if (!Number.isInteger(index) || index < 0 || !data.wlan?.[index])
      throw Error('NETIS_RADIO_MISSING');
    const radio = data.wlan[index];
    return {ssid:decodeSSID(radio.ssid),channel:radio.channel ?? 'Нет данных',
      enabled:radio.wlanEnabled, power:radio.rfPower ?? 'Нет данных'};
  }
  function radioState(value) {
    if (String(value) === '1') return 'включён';
    if (String(value) === '0') return 'выключен';
    return 'Нет данных';
  }
  async function readback() {
    // The stock FW4 flow reads CGI sequentially in one authenticated session.
    const replies = {};
    const lines = ['CGI base: OK', 'CGI guide: OK'];
    for (const app of ['wan_lan','wlan','igmp','routerState']) {
      try {
        const data = await driver.read(app);
        if (!api.fingerprint(data) || data.version !== exactFirmware)
          throw Error('NETIS_STATE_MODEL_MISMATCH');
        replies[app] = data;
        lines.push('CGI ' + app + ': OK');
        log('READBACK_OK ' + app);
      } catch (error) {
        lines.push('CGI ' + app + ': ERROR ' + errorCode(error));
        el('readback').textContent = lines.join('\n');
        log('READBACK_FAILED ' + app + ' ' + errorCode(error));
        throw error;
      }
    }
    try {
      const wan = replies.wan_lan, wlan = replies.wlan;
      const band2 = wifiBand(wlan,'wl2g_idx'), band5 = wifiBand(wlan,'wl5g_idx');
      const wanType = wan.wan?.[0]?.type;
      lines.push('WAN: ' + (String(wanType) === '1' ? 'DHCP' : 'тип ' + String(wanType ?? '?')) +
        ', связь ' + String(replies.routerState.connected ?? '?'));
      lines.push('Wi-Fi 2,4 ГГц: ' + band2.ssid + ', канал ' + band2.channel +
        ', питание ' + band2.power);
      lines.push('Wi-Fi 5 ГГц: ' + band5.ssid + ', канал ' + band5.channel +
        ', питание ' + band5.power);
      lines.push('IGMP: proxy ' + String(replies.igmp.igmpProxyEnabled ?? '?') +
        ', snooping ' + String(replies.igmp.igmpSnoopEnabled ?? '?'));
      el('dash-wan').textContent = String(wanType) === '1' ? 'DHCP' : 'Тип ' + String(wanType ?? '?');
      el('dash-2g').textContent = band2.ssid;
      el('dash-5g').textContent = band5.ssid;
      el('dash-2g-extra').textContent = 'Канал ' + band2.channel + ' · радиомодуль ' + radioState(band2.enabled) + ' · мощность ' + band2.power;
      el('dash-5g-extra').textContent = 'Канал ' + band5.channel + ' · радиомодуль ' + radioState(band5.enabled) + ' · мощность ' + band5.power;
      el('dash-igmp').textContent = 'Proxy ' + String(replies.igmp.igmpProxyEnabled ?? '?') +
        ' · Snooping ' + String(replies.igmp.igmpSnoopEnabled ?? '?');
      // Readable public CGI is not a valid administrator login.
      if (current?.mode === 'CONFIGURED' && authenticated) show('dashboard',true);
      el('readback').textContent = lines.join('\n');
      return {wanType:String(wanType),band2,band5};
    } catch (error) {
      lines.push('Разбор ответа: ERROR ' + errorCode(error));
      el('readback').textContent = lines.join('\n');
      log('READBACK_PARSE_FAILED ' + errorCode(error));
      throw error;
    }
  }
  async function check() {
    if (busy) return;
    setBusy(true);
    show('form',false); show('auth',false); show('pending',false); show('dashboard',false);
    el('auth-error').textContent = '';
    el('auth-error').style.display = 'none';
    el('readback').textContent = 'CGI: проверка выполняется…';
    status('Проверяем Netis N2…');
    try {
      const match = await driver.detect();
      el('readback').textContent = 'CGI base: OK';
      if (!match.supported || match.model !== 'N2' || match.version !== exactFirmware) {
        status('Роутер или версия прошивки не поддерживаются. Запись отключена.');
        el('info').textContent = 'Нужен Netis N2 / N2-V4.0.1.4317 / CIS';
        current = null;
        authenticated = false;
        reportDiscovery(false);
        return;
      }
      guide = await driver.read('guide');
      el('readback').textContent += '\nCGI guide: OK';
      if (!api.fingerprint(guide) || guide.version !== exactFirmware) {
        status('Несовпадение модели между ответами. Операции остановлены.');
        authenticated = false;
        current = null;
        reportDiscovery(false);
        return;
      }
      reportDiscovery(true,'N2',exactFirmware);
      current = api.stage(guide);
      el('info').textContent = 'Netis N2 · ' + match.version + ' · ' + current.mode;
      el('dash-device-extra').textContent = match.version + ' · http://' + location.host;
      log('DETECTED N2 FW4');
      if (current.mode === 'FACTORY') {
        if (currentAttempt()) {
          show('pending',true);
          status('Ожидается ручная проверка после попытки применения. Повтор SET заблокирован.');
        } else {
          show('form',true);
          status('Заводской режим подтверждён. Можно заполнить DHCP и Wi-Fi.');
          log('FACTORY_GUIDE_CONFIRMED');
        }
        try { await readback(); }
        catch (error) {
          log('FACTORY_ADDITIONAL_READ_INCOMPLETE ' + errorCode(error));
          // The independently verified factory guide remains sufficient for
          // local form validation; an incomplete diagnostic is visible above.
        }
      } else if (current.mode === 'CONFIGURED') {
        if (!authenticated) {
          // The Netis firmware can return WAN/WLAN CGI to unauthenticated
          // clients. We require real login.cgi SUCCESS before showing
          // the RouterLab management dashboard.
          show('auth',true);
          status(currentAttempt()
            ? 'После переподключения подтвердите пароль администратора Netis.'
            : 'Роутер настроен. Войдите с паролем администратора.');
          log('CONFIGURED_LOGIN_REQUIRED');
        } else {
          status('Авторизация подтверждена. Читаем состояние маршрутизатора…');
          try {
            const snapshot = await readback();
            log('READBACK_OK WAN WLAN IGMP AFTER_LOGIN');
            if (currentAttempt()) {
              clearAttempt();
              status('После переподключения: CONFIGURED. Сверьте SSID с заданными.');
              log('FACTORY_READBACK_AFTER_RECONNECT_OK');
            } else status('CONFIGURED: WAN ' + (snapshot.wanType === '1' ? 'DHCP' : 'тип ' + snapshot.wanType) +
              '; сети Wi-Fi и IGMP прочитаны после входа.');
          } catch (error) {
            show('dashboard',false);
            show('auth',true);
            status('Авторизация принята, но чтение параметров не завершено: ' +
              errorCode(error) + '. Повторите проверку или вход.');
            log('AUTH_READBACK_INCOMPLETE ' + errorCode(error));
          }
        }
      } else {
        status('Состояние роутера неоднозначно. Запись запрещена.');
      }
    } catch (e) {
      status('Нет подтверждённого ответа от Netis. Проверьте Wi-Fi и адрес роутера.');
      log('PROBE_FAILED ' + String(e && e.message || e).slice(0,75));
      reportDiscovery(false);
    } finally {setBusy(false);}
  }
  async function apply(e) {
    e.preventDefault();
    if (busy || !current || current.mode !== 'FACTORY' || !el('confirm').checked || currentAttempt()) return;
    let values;
    try {values = freshValues();}
    catch (e) {
      status('Проверьте введённые данные: ' + String(e.message || e));
      return;
    }
    setBusy(true);
    try {
      saveAttempt();
      status('Отправляем заводскую настройку один раз…');
      log('FACTORY_SET_SUBMITTED_ONCE');
      const result = await driver.factoryDhcp(values,{confirmed:true});
      values.adminPassword = ''; values.wifiPassword = '';
      el('admin').value = ''; el('wifi').value = '';
      if (result.status === 'REJECTED' || result.status === 'LOCKED') {
        clearAttempt();
        status('Роутер отклонил SET. Конфигурация не подтверждена.');
        log('FACTORY_SET_REJECTED');
      } else {
        show('form',false); show('pending',true);
        status('SET отправлен. Если Wi-Fi пропал — это ожидаемо. Переподключитесь вручную.');
        log('FACTORY_SET_APPLY_UNCONFIRMED_NO_AUTORETRY');
      }
    } catch (e) {
      // Never clear marker on an unknown error after the attempt.
      show('form',false); show('pending',true);
      status('Исход SET неизвестен. Подключитесь вручную и проверьте состояние; повтор заблокирован.');
      log('FACTORY_SET_INDETERMINATE_NO_AUTORETRY');
    } finally {setBusy(false);}
  }
  async function login(e) {
    e.preventDefault();
    if (busy || !current || current.mode !== 'CONFIGURED') return;
    const field = el('login-pass');
    const password = field.value;
    if (!password) return;
    setBusy(true);
    authenticated = false;
    el('auth-error').style.display = 'none';
    status('Проверяем пароль администратора…');
    let accepted = false;
    try {
      const result = await driver.login(password);
      // A public successful read of WLAN cannot override this result.
      if (result.status !== 'REQUEST_OK') {
        const reason = result.status === 'LOCKED'
          ? 'Маршрутизатор временно заблокировал вход. Не повторяйте попытки подряд.'
          : 'Пароль не принят маршрутизатором (' + result.status + '). Проверьте пароль.';
        el('auth-error').textContent = reason;
        el('auth-error').style.display = 'block';
        status(reason);
        log('LOGIN_REJECTED ' + result.status);
        return;
      }
      accepted = true;
      authenticated = true;
      log('LOGIN_REQUEST_OK');
      status('Вход подтверждён. Получаем настройки Netis…');
    } catch (error) {
      const reason = 'Вход не подтверждён: ' + errorCode(error);
      el('auth-error').textContent = reason;
      el('auth-error').style.display = 'block';
      status(reason);
      log('LOGIN_FAILED ' + errorCode(error));
    } finally {
      // Keep no copy of the password in our UI, JS state or diagnostic messages.
      field.value = '';
      setBusy(false);
    }
    // Never re-check on a failed login: public CGI can otherwise hide rejection.
    if (accepted) await check();
  }
  function logout() {
    authenticated = false;
    show('dashboard',false);
    show('auth',true);
    status('Вы вышли из RouterLab. Для управления введите пароль администратора.');
    log('LOCAL_AUTH_GATE_CLEARED');
    // This is a local RouterLab UI lock, not a Netis firmware logout.
    // Never present this as invalidating the router's stock cookie/session.
  }
  el('refresh').addEventListener('click',check);
  el('form').addEventListener('submit',apply);
  el('auth').addEventListener('submit',login);
  el('logout').addEventListener('click',logout);
  el('toggle').addEventListener('click',()=>{
    const tech=el('technical');
    tech.open=!tech.open;
    if (tech.open) tech.scrollIntoView({block:'nearest'});
  });
  window.__RouterLabNetisPilot = Object.freeze({check});
  check();
})();
