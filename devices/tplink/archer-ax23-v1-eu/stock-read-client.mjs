// AX23(EU) V1: model-specific read-only client for verified original stock LuCI.
// Vendor firmware/server are NOT reimplemented here. Only verified GET wire format.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const VERIFIED_FACTORY_FORMS = Object.freeze(['check_factory_default', 'keys', 'auth']);

export class StockContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockContractError';
  }
}

export async function readStockLoginForm(baseUrl, form, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!VERIFIED_FACTORY_FORMS.includes(form)) {
    throw new StockContractError('unverified AX23 read form');
  }
  const endpoint = new URL('/cgi-bin/luci/login', baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new StockContractError('unsupported router HTTP URL scheme');
  }
  endpoint.searchParams.set('form', form);
  endpoint.searchParams.set('operation', 'read');
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (_err) {
    throw new StockContractError('original AX23 HTTP read did not respond');
  }
  if (response.status !== 200) {
    throw new StockContractError('original AX23 HTTP read returned non-200 status');
  }
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new StockContractError('original AX23 read did not return JSON');
  }
  let body;
  try {
    body = await response.json();
  } catch (_err) {
    throw new StockContractError('malformed stock AX23 JSON');
  }
  if (!body || body.success !== true || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    // Do not echo responses: keys/passwords or session challenges may be present.
    throw new StockContractError('original stock AX23 read callback rejected or returned invalid data');
  }
  return body.data;
}

export async function inspectStockInitialState(baseUrl, opts = {}) {
  const factory = await readStockLoginForm(baseUrl, 'check_factory_default', opts);
  const keys = await readStockLoginForm(baseUrl, 'keys', opts);
  const auth = await readStockLoginForm(baseUrl, 'auth', opts);
  if (typeof factory.is_default !== 'boolean' || typeof factory.cloud_ever_login !== 'boolean') {
    throw new StockContractError('stock factory-state shape changed');
  }
  if (typeof keys.username !== 'string' || !Array.isArray(keys.password) || keys.password.length !== 2 ||
      !keys.password.every(value => typeof value === 'string')) {
    throw new StockContractError('stock password public-key shape changed');
  }
  if (!Array.isArray(auth.key) || auth.key.length !== 2 || typeof auth.seq !== 'number') {
    throw new StockContractError('stock auth challenge shape changed');
  }
  // Only nonsecret metadata is returned to CLI logging. Values stay in memory.
  return {
    factory: { is_default: factory.is_default, cloud_ever_login: factory.cloud_ever_login },
    keyFieldCount: keys.password.length,
    authKeyFieldCount: auth.key.length,
    authSequenceType: typeof auth.seq,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseUrl = process.argv[2] || 'http://127.0.0.1:18023';
  try {
    const r = await inspectStockInitialState(baseUrl);
    console.log('STOCK_AX23_ORIGINAL_READ_CLIENT=PASS');
    console.log('STOCK_AX23_FACTORY_DEFAULT=' + String(r.factory.is_default));
    console.log('STOCK_AX23_CLOUD_EVER_LOGIN=' + String(r.factory.cloud_ever_login));
    console.log('STOCK_AX23_PASSWORD_PUBLIC_KEY_PARTS=' + String(r.keyFieldCount));
    console.log('STOCK_AX23_AUTH_CHALLENGE_PARTS=' + String(r.authKeyFieldCount));
  } catch (err) {
    console.error('STOCK_AX23_ORIGINAL_READ_CLIENT=FAIL ' + err.name + ': ' + err.message);
    process.exitCode = 1;
  }
}
