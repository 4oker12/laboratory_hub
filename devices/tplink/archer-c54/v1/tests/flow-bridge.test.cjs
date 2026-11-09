'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../../../../../');
const srcC20 = fs.readFileSync(path.join(repo, 'extensions/tplink-c20/independent-session/flow.js'), 'utf8');
const srcC54 = fs.readFileSync(path.join(__dirname, '../flow-bridge.js'), 'utf8');
const ctx = vm.createContext({ TextEncoder, console });
vm.runInContext(srcC20, ctx);
vm.runInContext(srcC54, ctx);
const c54 = vm.runInContext('RouterLabC54Bridge.create(C20Flow)', ctx);
const good = c54.identity({ model: 'Archer C54', hardware: 'V1.0', region: 'EU' });
assert.equal(good.candidate, true);
assert.equal(good.verified, false);
assert.equal(good.allowRead, false);
assert.equal(good.allowWrite, false);
assert.equal(c54.identity({ model: 'Archer C20', hardware: 'V5', region: 'EU' }).candidate, false);
assert.equal(c54.identity({ model: 'Archer C54', hardware: 'V1', region: 'RU' }).candidate, false);
assert.equal(c54.identity({ model: 'Archer C54', hardware: '', region: 'EU' }).candidate, false);
for (const [stage, phase] of [
  ['FACTORY_PASSWORD', 'CREATE_ADMIN'],
  ['LOGIN_FORM', 'LOGIN'],
  ['LOGIN_LOCKED', 'AUTH_LOCKED'],
  ['AUTH_UNCONFIRMED', 'VERIFY_STATE'],
  ['QUICK_SETUP_ACTIVE', 'QUICK_SETUP'],
  ['CONFIGURED_AUTHENTICATED', 'WIFI_EDITOR']
]) {
  const found = c54.classifyNative({ isC54: true, stage }, good);
  assert.equal(found.phase, phase);
  assert.equal(found.allowWrite, false);
  assert.equal(found.allowRead, false);
  assert.equal(found.protocolVerified, false);
}
assert.equal(c54.classifyNative({ isC54: false, stage: 'LOGIN_FORM' }, good).phase, 'NO_C54');
assert.equal(c54.classifyNative({ isC54: true, stage: 'LOGIN_FORM' }, { candidate: false }).phase, 'NO_C54');
assert.equal(c54.quickStepFromSignals({ isp: true }), 'ISP_WAN');
assert.equal(c54.quickStepFromSignals({ wlan: true }), 'WIRELESS');
assert.equal(c54.cleanWifi({ ssid24: 'C54-24', ssid5: 'C54-5', wifiPassword: 'abcdefgh' }).hasKey, true);
assert.throws(() => c54.cleanWifi({ ssid24: 'a', ssid5: 'b', wifiPassword: 'short' }), /C20_WIFI_PASSWORD/);
assert.throws(() => c54.readProtectedConfiguration(), /C54_PROTOCOL_UNVERIFIED/);
assert.throws(() => c54.applyConfiguration(), /C54_WRITE_NOT_VERIFIED/);
console.log('PASS: C54 EU V1 inherits C20 UI flow; incompatible identities and all unverified operations blocked');
