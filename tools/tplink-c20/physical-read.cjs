'use strict';
const path = require('node:path');
const extension = path.resolve(__dirname, '../../extensions/tplink-c20/independent-session');
const C20Crypto = require(path.join(extension, 'crypto.js'));
const C20Protocol = require(path.join(extension, 'protocol.js'));
const ORIGIN = 'http://192.168.0.1';
let password = process.env.ROUTERLAB_ADMIN_PASSWORD;
delete process.env.ROUTERLAB_ADMIN_PASSWORD;
if (!password) {
  process.stderr.write('SECURE_PASSWORD_INPUT_REQUIRED\n');
  process.exit(2);
}

let sessionCookie = '';
function acceptSetCookie(headers) {
  let count = 0;
  for (const line of headers.getSetCookie?.() || []) {
    count++;
    const match = /^\s*JSESSIONID=([^;\r\n]*)/i.exec(line);
    if (!match) continue;
    const maxAge = /;\s*Max-Age\s*=\s*(-?\d+)/i.exec(line);
    const expires = /;\s*Expires\s*=\s*([^;]+)/i.exec(line);
    const expired = (maxAge && Number(maxAge[1]) <= 0) ||
      (expires && Number.isFinite(Date.parse(expires[1])) && Date.parse(expires[1]) <= Date.now());
    if (!match[1] || expired) {
      sessionCookie = '';
      continue;
    }
    if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,512}$/.test(match[1])) {
      sessionCookie = 'JSESSIONID=' + match[1];
    }
  }
  return count;
}
async function request(path, method = 'GET', body = null, contentType = '') {
  const headers = { Origin: ORIGIN, Referer: ORIGIN + '/' };
  if (sessionCookie) headers.Cookie = sessionCookie;
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(ORIGIN + path, {
    method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(12000),
  });
  const setCookieCount = acceptSetCookie(response.headers);
  const text = await response.text();
  process.stdout.write(`${path}:HTTP_${response.status} setCookieCount=${setCookieCount} cookieSent=${!!headers.Cookie}\n`);
  return { status: response.status, text };
}
function cookieNameCount() { return sessionCookie.startsWith('JSESSIONID=') ? 1 : 0; }
function fail(code) {
  process.stdout.write(code + '\n');
  process.exitCode = 2;
}

(async () => {
  try {
    globalThis.crypto = require('node:crypto').webcrypto;
    const root = await request('/');
    process.stdout.write(`routerModelHint=${/Archer\s*C20/i.test(root.text)}\n`);
    const paramsReply = await request('/cgi/getGDPRParm', 'POST');
    if (paramsReply.status !== 200) return fail('LOGIN_NOT_SENT_PARAMS_HTTP_ERROR');
    const params = C20Crypto.getParams(paramsReply.text);
    if (!cookieNameCount()) return fail('LOGIN_NOT_SENT_NO_ROUTER_SESSION_COOKIE');

    const busy = await request('/cgi/getBusy', 'POST');
    if (busy.status !== 200) return fail('LOGIN_NOT_SENT_BUSY_PREFLIGHT_HTTP_ERROR');
    const busyFlag = (key) => {
      const values = [...busy.text.matchAll(new RegExp("(?:var\\s+)?" + key + "\\s*=\\s*[\\\"']?(true|false|1|0)", 'ig'))];
      if (values.length !== 1) return null;
      return /^(?:true|1)$/i.test(values[0][1]);
    };
    const isBusy = busyFlag('isBusy');
    const isLogined = busyFlag('isLogined');
    process.stdout.write(`busy=${isBusy === null ? 'UNKNOWN' : isBusy} logined=${isLogined === null ? 'UNKNOWN' : isLogined}\n`);
    if (isBusy !== false) return fail('LOGIN_NOT_SENT_BUSY_OR_UNKNOWN');
    if (isLogined !== false) return fail('LOGIN_NOT_SENT_EXISTING_OR_UNKNOWN_SESSION');

    const context = await C20Crypto.createContext(params.nn, params.ee, params.seq, 'user', password);
    const packet = await context.encrypt(C20Protocol.loginLegacy('user', password), true);
    const loginReply = await request('/cgi_gdpr', 'POST',
      'sign=' + packet.sign + '\r\ndata=' + packet.data + '\r\n', 'text/plain');
    if (loginReply.status !== 200) return fail('LOGIN_HTTP_NOT_CONFIRMED_STOP_NO_RETRY');
    let loginText;
    try { loginText = await context.decrypt(loginReply.text); }
    catch { return fail('LOGIN_REPLY_UNDECRYPTABLE_STOP_NO_RETRY'); }
    const auth = C20Protocol.parseLoginResult(loginText);
    process.stdout.write(`loginMeaning=${auth.status} retCode=${auth.retCode ?? 'UNKNOWN'}\n`);
    if (auth.rejected || auth.status !== 'ZERO_ACK_ONLY') return fail('LOGIN_NOT_ACCEPTED_STOP_NO_RETRY');

    const readWlan = async () => {
      const requestPacket = await context.encrypt(C20Protocol.wifiRead());
      const reply = await request('/cgi_gdpr', 'POST',
        'sign=' + requestPacket.sign + '\r\ndata=' + requestPacket.data + '\r\n', 'text/plain');
      if (reply.status !== 200) return null;
      try {
        const raw = await context.decrypt(reply.text);
        return C20Protocol.parseWifi(raw);
      } catch { return null; }
    };
    const first = await readWlan();
    if (!first?.dynamicStacksVerified) return fail('READ_WLAN_NOT_CONFIRMED_STOP');
    const second = await readWlan();
    if (!second?.dynamicStacksVerified) return fail('READ_WLAN_REPEAT_NOT_CONFIRMED_STOP');
    const same = first.radio24.ssid === second.radio24.ssid &&
      first.radio5.ssid === second.radio5.ssid &&
      first.radio24.stack === second.radio24.stack && first.radio5.stack === second.radio5.stack;
    process.stdout.write(`READ_WLAN=OK bands=2 repeatValuesMatch=${same} cookieContext=singleRouterSession\n`);
    process.stdout.write('SSID values omitted from diagnostic output.\n');
    if (!same) fail('READ_WLAN_REPEAT_CHANGED');
  } catch (error) {
    process.stdout.write(`PHYSICAL_TEST_STOPPED errorType=${String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)} noRetry=true\n`);
    process.exitCode = 2;
  } finally {
    password = '';
    sessionCookie = '';
  }
})();
