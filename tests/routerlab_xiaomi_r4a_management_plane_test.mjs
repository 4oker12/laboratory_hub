import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const agentPath = path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'management-plane-agent.sh');
const readmePath = path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'README.md');

const agent = fs.readFileSync(agentPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');

test('RouterLab agent is bounded and preserves the canonical FirmAE image', () => {
  assert.match(agent, /RUN_SECONDS=180/);
  assert.match(agent, /RUN_SECONDS <= 900/);
  assert.match(agent, /cp --sparse=always "\$SOURCE_IMAGE" "\$LAB_IMAGE"/);
  assert.doesNotMatch(agent, /e2fsck[^\n]*"\$SOURCE_IMAGE"/);
});

test('RouterLab agent bypasses WSL TAP with QEMU user networking', () => {
  assert.match(agent, /user,id=net%s/);
  assert.match(agent, /hostfwd=tcp:127\.0\.0\.1/);
  assert.doesNotMatch(agent, /tunctl -t/);
});

test('RouterLab decision states preserve stock management-plane scope', () => {
  for (const state of [
    'STOCK_FRONTDOOR_REACHABLE',
    'STOCK_MANAGEMENT_BACKEND_ALIVE_FRONTDOOR_MISSING',
    'GUEST_ALIVE_MANAGEMENT_STACK_UNRESOLVED',
    'FIRMAE_NOT_ECONOMICAL_FOR_WEB',
  ]) {
    assert.match(agent, new RegExp(state));
  }
  assert.match(readme, /stock.*(UI|Web)/i);
  assert.match(readme, /persist/i);
  assert.match(readme, /(Not emulated:\s*RF|RF.*out of scope)/is);
});
