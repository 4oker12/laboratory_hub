// Synthetic transport tests verify only the RouterLab read-only client itself.
// Real vendor runtime evidence comes exclusively from the separate QEMU/chroot CI probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStockLoginForm, inspectStockInitialState, StockContractError } from '../../devices/tplink/archer-ax23-v1-eu/stock-read-client.mjs';

const json = (data, success = true) =>
  new Response(JSON.stringify({ success, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

test('original AX23 login URL includes exact operation=read; never write', async () => {
  let path = '', method = '';
  const f = async (url, init) => {
    path = String(url);
    method = init.method;
    return json({ is_default: true, cloud_ever_login: false });
  };
  await readStockLoginForm('http://127.0.0.1:18023', 'check_factory_default', { fetchImpl: f });
  assert.equal(method, 'GET');
  assert.equal(new URL(path).pathname, '/cgi-bin/luci/login');
  assert.equal(new URL(path).searchParams.get('form'), 'check_factory_default');
  assert.equal(new URL(path).searchParams.get('operation'), 'read');
});

test('unknown forms are rejected before network access', async () => {
  let called = false;
  await assert.rejects(readStockLoginForm('http://127.0.0.1:18023', 'set_password', {
    fetchImpl: async () => { called = true; return json({}); },
  }), StockContractError);
  assert.equal(called, false);
});

test('stock callback success=false does not count as a pass', async () => {
  await assert.rejects(readStockLoginForm('http://127.0.0.1:18023', 'keys', {
    fetchImpl: async () => json(null, false),
  }), StockContractError);
});

test('read-only first-launch handshake checks all original data shapes', async () => {
  const seen = [];
  const f = async (url) => {
    const form = url.searchParams.get('form');
    seen.push(form);
    if (form === 'check_factory_default') return json({ is_default: true, cloud_ever_login: false });
    if (form === 'keys') return json({ username: '', password: ['x'.repeat(256), '010001'] });
    if (form === 'auth') return json({ key: ['public-a', 'public-b'], seq: 123 });
    throw new Error('unexpected form');
  };
  const state = await inspectStockInitialState('http://127.0.0.1:18023', { fetchImpl: f });
  assert.deepEqual(seen, ['check_factory_default', 'keys', 'auth']);
  assert.deepEqual(state.factory, { is_default: true, cloud_ever_login: false });
  assert.equal(state.keyFieldCount, 2);
  assert.equal(state.authKeyFieldCount, 2);
});
