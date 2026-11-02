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
  let current = null, guide = null, busy = false;
  const logs = [];
  const host = document.createElement('div');
  host.id = 'routerlab-netis-ios-pilot';
  const shadow = host.attachShadow({mode:'open'});
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:env(safe-area-inset-top,0px);right:0;width:min(420px,100vw);font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;';
  shadow.innerHTML = '<style>' +
    ':host{color-scheme:light}*{box-sizing:border-box}.panel{background:#fff;color:#14212d;box-shadow:0 4px 30px #0004;border:1px solid #d7e0e8;border-radius:0 0 14px 14px;overflow:hidden}' +
    '.top{background:#132b42;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}.top strong{font-size:15px;flex:1}.top button{width:auto;padding:6px 10px;color:#fff;background:#39546b;border:1px solid #678197}' +
    '.content{padding:12px 14px;max-height:72dvh;overflow-y:auto}p{font-size:13px;line-height:1.45;margin:8px 0}#status{font-weight:600}label{display:block;font-size:12px;font-weight:600;margin:10px 0 3px}' +
    'input{width:100%;font:inherit;font-size:15px;padding:10px 9px;border:1px solid #a8b8c6;border-radius:7px}button{cursor:pointer;font-size:13px;font-weight:600;border-radius:7px;padding:10px 11px;border:0;background:#11639c;color:white}' +
    'button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.muted{font-size:12px;color:#516577}.check{display:flex;gap:7px;align-items:flex-start}.check input{width:auto;margin-top:2px}' +
    '#details{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f0f4f7;border-radius:7px;padding:8px;max-height:130px;overflow:auto}#form,#auth,#pending{display:none}.collapsed .content{display:none}' +
    '</style><div class="panel"><div class="top"><strong>RouterLab · Netis N2</strong><button id="toggle" type="button">Свернуть</button></div>' +
    '<div class="content"><p id="status">Проверяем роутер…</p><p class="muted" id="info">Тестовая iOS-панель, запросы только к текущему роутеру.</p>' +
    '<div class="actions"><button id="refresh" type="button">Проверить / обновить</button></div>' +
    '<form id="form" autocomplete="off"><label>Пароль администратора</label><input id="admin" type="password" required autocomplete="new-password" maxlength="64">' +
    '<label>Wi-Fi 2.4 ГГц</label><input id="ssid2" required maxlength="32" autocomplete="off">' +
    '<label>Wi-Fi 5 ГГц</label><input id="ssid5" required maxlength="32" autocomplete="off">' +
    '<label>Пароль Wi-Fi (8–63 символа)</label><input id="wifi" type="password" required minlength="8" maxlength="63" autocomplete="new-password">' +
    '<p class="muted">WAN: DHCP. После применения телефон отключится от текущей сети. Подключитесь к новому Wi-Fi вручную и нажмите «Обновить» в приложении.</p>' +
    '<label class="check"><input id="confirm" type="checkbox">Я подтверждаю однократную запись заводской конфигурации.</label>' +
    '<div class="actions"><button id="apply" type="submit">Применить один раз</button></div></form>' +
    '<div id="pending"><p>Попытка SET уже зарегистрирована. Автоматический повтор запрещён. После ручного подключения к новому Wi-Fi нажмите «Проверить / обновить».</p></div>' +
    '<form id="auth" autocomplete="off"><label>Админ-пароль Netis</label><input id="login-pass" type="password" autocomplete="current-password">' +
    '<div class="actions"><button type="submit">Войти и проверить</button></div></form>' +
    '<details><summary class="muted">Диагностика (без паролей)</summary><pre id="details"></pre></details></div></div>';
  document.body.appendChild(host);
  const el = (name) => shadow.getElementById(name);
  const show = (name, value) => { el(name).style.display = value ? 'block' : 'none'; };
  const status = (value) => { el('status').textContent = value; log(value); };
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
    ['refresh','apply'].forEach(id => { el(id).disabled = value; });
  }
  function freshValues() {
    const input = {adminPassword:el('admin').value,ssid2g:el('ssid2').value,
      ssid5g:el('ssid5').value,wifiPassword:el('wifi').value};
    api.buildFactoryDhcp(input, guide); // validate locally BEFORE recording SET attempt
    return input;
  }
  async function check() {
    if (busy) return;
    setBusy(true);
    show('form',false); show('auth',false); show('pending',false);
    status('Проверяем Netis N2…');
    try {
      const match = await driver.detect();
      if (!match.supported || match.model !== 'N2' || match.version !== exactFirmware) {
        status('Роутер или версия прошивки не поддерживаются. Запись отключена.');
        el('info').textContent = 'Нужен Netis N2 / N2-V4.0.1.4317 / CIS';
        current = null;
        return;
      }
      guide = await driver.read('guide');
      if (!api.fingerprint(guide) || guide.version !== exactFirmware) {
        status('Несовпадение модели между ответами. Операции остановлены.');
        current = null;
        return;
      }
      current = api.stage(guide);
      el('info').textContent = 'Netis N2 · ' + match.version + ' · ' + current.mode;
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
      } else if (current.mode === 'CONFIGURED') {
        status('Netis настроен. Читаем фактическое состояние…');
        try {
          await Promise.all([driver.readWan(),driver.readWifi(),driver.readIgmp()]);
          log('READBACK_OK WAN WLAN IGMP');
          if (currentAttempt()) {
            clearAttempt();
            status('После переподключения: CONFIGURED; WAN/WLAN/IGMP доступны для чтения.');
            log('FACTORY_READBACK_AFTER_RECONNECT_OK');
          } else status('CONFIGURED: чтение WAN/WLAN/IGMP успешно.');
        } catch (_) {
          show('auth',true);
          status('Роутер настроен. Для чтения WAN/Wi-Fi может потребоваться вход.');
          log('READBACK_REQUIRES_AUTH_OR_RETRY');
        }
      } else {
        status('Состояние роутера неоднозначно. Запись запрещена.');
      }
    } catch (e) {
      status('Нет подтверждённого ответа от Netis. Проверьте Wi-Fi и адрес роутера.');
      log('PROBE_FAILED ' + String(e && e.message || e).slice(0,75));
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
    if (busy) return;
    const password = el('login-pass').value;
    if (!password) return;
    setBusy(true);
    try {
      const result = await driver.login(password);
      el('login-pass').value = '';
      if (result.status !== 'REQUEST_OK') {
        status('Netis не подтвердил авторизацию. Код: ' + result.status);
      } else {
        log('LOGIN_REQUEST_OK');
        status('Вход выполнен. Проверяем настройки…');
      }
    } catch (_) {
      status('Ошибка входа. Проверьте пароль и сеть.');
      log('LOGIN_FAILED');
    } finally {
      setBusy(false);
      await check();
    }
  }
  el('refresh').addEventListener('click',check);
  el('form').addEventListener('submit',apply);
  el('auth').addEventListener('submit',login);
  el('toggle').addEventListener('click',()=>{
    const collapsed = shadow.querySelector('.panel').classList.toggle('collapsed');
    el('toggle').textContent = collapsed ? 'Развернуть' : 'Свернуть';
  });
  window.__RouterLabNetisPilot = Object.freeze({check});
  check();
})();