import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const script = fs.readFileSync(
  path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'management-plane-rehost.sh'),
  'utf8',
);

test('rehost uses stock management components without FirmAE system emulation', () => {
  assert.match(script, /usr\/sbin\/sysapihttpd/);
  assert.match(script, /usr\/bin\/fcgi-cgi/);
  assert.match(script, /www\/cgi-bin\/luci/);
  assert.match(script, /qemu-mipsel-static/);
  assert.match(script, /proot/);
  assert.doesNotMatch(script, /qemu-system-mipsel/);
  assert.doesNotMatch(script, /tunctl|tap[0-9_]/i);
});

test('rehost keeps source rootfs untouched and probes read-only endpoint', () => {
  assert.match(script, /cp -a --reflink=auto "\$ROOTFS\/\." "\$LAB\/"/);
  assert.match(script, /source rootfs modified: \*\*no\*\*/);
  assert.match(script, /\/tmp\/sysapihttpd\/lock/);
  assert.match(script, /\/tmp\/sysapihttpd\/body/);
  assert.match(script, /ln -s \/tmp\/sysapihttpd \/userdisk\/sysapihttpd/);
  assert.match(script, /STOCK SYSAPI CONFIG TEST ERROR/);
  assert.match(script, /STOCK RUNTIME DIAGNOSTIC/);
  assert.match(script, /cannot est session for 0\.0\.0\.1:65535/);
  assert.match(script, /guest 'cat \/tmp\/sysapihttpdconf\/sysapihttpd\.conf'/);
  assert.doesNotMatch(script, /\$LAB\/tmp\/sysapihttpdconf/);
  assert.match(script, /\/api\/xqsystem\/init_info/);
  assert.doesNotMatch(script, /set_wan_new|set_wifi/);
});

test('rehost is bounded and has explicit classifications', () => {
  assert.match(script, /PROBE_SECONDS=75/);
  assert.match(script, /PROBE_SECONDS <= 300/);
  for (const state of [
    'STOCK_SYSAPI_CONFIG_BLOCKED_IN_USERMODE',
    'STOCK_LUCI_API_ALIVE',
    'STOCK_WEB_FRONTEND_ALIVE_LUCI_BLOCKED',
    'STOCK_SYSAPI_CONFIG_VALID_RUNTIME_BLOCKED',
    'STOCK_SYSAPI_TRANSPORT_INCOMPATIBLE_QEMU_USER',
    'STOCK_SYSAPI_PROCESS_EXITED',
    'STOCK_SYSAPI_ALIVE_NO_HTTP_LISTENER',
    'STOCK_FCGI_NO_LISTENER',
    'STOCK_FCGI_LISTENER_WITHOUT_TRACKED_CHILD',
    'QEMU_USER_REHOST_BLOCKED',
  ]) {
    assert.match(script, new RegExp(state));
  }
});


test('rehost script structure is not duplicated or truncated', () => {
  assert.equal((script.match(/#!\/usr\/bin\/env bash/g) || []).length, 1);
  assert.equal((script.match(/stop_previous\(\) \{/g) || []).length, 1);
  assert.equal((script.match(/# Reproduce ngxld's runtime-config preparation/g) || []).length, 1);
  assert.equal((script.match(/# Start exact stock FCGI\/LuCI/g) || []).length, 1);
  assert.match(script, /STOCK RUNTIME DIAGNOSTIC/);
  assert.match(script, /spawn-fcgi is only a launcher/);
  assert.doesNotMatch(script, /FCGI_ALIVE/);
});
