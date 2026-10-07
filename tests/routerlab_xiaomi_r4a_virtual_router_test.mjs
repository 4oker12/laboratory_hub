import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scriptPath = path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'virtual-router.sh');
const wrapperPath = path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'Run-VirtualRouter.ps1');

const script = fs.readFileSync(scriptPath, 'utf8');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const shim = fs.readFileSync(
  path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'runtime-shims', 'ubus.lua'),
  'utf8',
);
const getmacShim = fs.readFileSync(
  path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'runtime-shims', 'getmac'),
  'utf8',
);
const luciSysShim = fs.readFileSync(
  path.join(root, 'devices', 'xiaomi', 'mi-router-4a-gigabit-r4a', '3.0.24-int', 'runtime-shims', 'luci-sys.lua'),
  'utf8',
);

test('virtual router keeps exact stock LuCI and replaces transport only', () => {
  assert.match(script, /usr\/bin\/fcgi-cgi/);
  assert.match(script, /www\/cgi-bin\/luci/);
  assert.match(script, /compat-frontdoor\.py/);
  assert.doesNotMatch(script, /usr\/sbin\/sysapihttpd.*-c/);
  assert.doesNotMatch(script, /FirmAE/);
});

test('virtual router has explicit persistent-state cold boot lifecycle', () => {
  assert.match(script, /state-v1/);
  assert.match(script, /save_state\(\)/);
  assert.match(script, /prepare_runtime\(\)/);
  assert.match(script, /cold boot: exact stock rootfs \+ state-v1/);
  assert.match(script, /start\|stop\|restart\|status\|reset/);
  assert.match(script, /cp -a --reflink=auto "\$ROOTFS\/\." "\$LAB\/"/);
  assert.match(script, /cp -a "\$STATE_CONFIG\/\." "\$LAB\/etc\/config\/"/);
});

test('factory and configured profiles preserve exact R4A state semantics', () => {
  assert.match(script, /PROFILE="factory"/);
  assert.match(script, /profile must be factory or configured/);
  assert.match(script, /config interface 'wan'[\s\S]*option proto 'dhcp'/);
  assert.match(script, /config wifi-device 'mt7603e'[\s\S]*option ifname 'wl1'/);
  assert.match(script, /config wifi-device 'mt7612'[\s\S]*option ifname 'wl0'/);
  assert.match(script, /if \[\[ "\$PROFILE" == "configured" \]\]/);
  assert.match(script, /option 'INITTED' 'YES'/);
  assert.match(script, /sed -i "\/option 'INITTED'\/d"/);
  assert.match(script, /--stock-init-gate/);
});

test('Windows wrapper exposes the same lifecycle without embedding router logic', () => {
  assert.match(wrapper, /ValidateSet\('Start','Stop','Restart','Status','Reset'\)/);
  assert.match(wrapper, /ValidateSet\('Factory','Configured'\)/);
  assert.match(wrapper, /virtual-router\.sh/);
  assert.doesNotMatch(wrapper, /set_wan|set_wifi|wifi_detail_all/);
});

test('virtual router safely reclaims only stale RouterLab listeners', () => {
  assert.match(script, /reclaim_stale_routerlab_port\(\)/);
  assert.match(script, /qemu-mipsel-static\*fcgi-cgi/);
  assert.match(script, /compat-frontdoor\.py/);
  assert.match(script, /non-RouterLab pid=/);
  assert.doesNotMatch(script, /for p in \$port_pids; do\s*kill -TERM "\$p"/);
});

test('ubus shim is narrow and derives WAN protocol from stock UCI', () => {
  assert.match(script, /runtime-shims/);
  assert.match(script, /cp "\$SHIM_DIR\/ubus\.lua" "\$LAB\/usr\/lib\/lua\/ubus\.lua"/);
  assert.match(shim, /network\.interface\.wan/);
  assert.match(shim, /cursor:get\("network", "wan", "proto"\)/);
  assert.match(shim, /up = false/);
  assert.match(shim, /error\(/);
  assert.match(shim, /unsupported call/);
  assert.doesNotMatch(shim, /pppoe_username|set_wifi|set_wan/);
});

test('factory WAN page runtime models missing ARP and Factory-MTD MAC facts', () => {
  assert.match(script, /cp "\$LAB\/usr\/lib\/lua\/luci\/sys\.lua" "\$LAB\/usr\/lib\/lua\/luci\/sys\.stock\.lua"/);
  assert.match(script, /cp "\$SHIM_DIR\/luci-sys\.lua" "\$LAB\/usr\/lib\/lua\/luci\/sys\.lua"/);
  assert.doesNotMatch(script, /proc-net-arp:\/proc\/net\/arp/);
  assert.match(luciSysShim, /dofile/);
  assert.match(luciSysShim, /sys\.stock\.lua/);
  assert.match(luciSysShim, /192\.168\.31\.100/);
  assert.match(luciSysShim, /02:11:22:33:44:64/);
  assert.match(luciSysShim, /stock_ip4mac/);
  assert.match(script, /install -m 0755 "\$SHIM_DIR\/getmac" "\$LAB\/sbin\/getmac"/);
  assert.match(getmacShim, /WAN_MAC="02:11:22:33:44:51"/);
  assert.match(getmacShim, /echo "\$WAN_MAC,\$WL1_MAC,\$WL0_MAC"/);
  assert.doesNotMatch(getmacShim, /\/proc\/mtd|hexdump|nvram/);
});
test('factory language capability is materialized from stock packs, not API overrides', () => {
  assert.match(script, /materialize_language_registry\(\)/);
  assert.match(script, /etc\" \/ \"uci-defaults\"/);
  assert.match(script, /luci\\\.languages\\\./);
  assert.match(script, /glob\(\"base\.\*\.lmo\"\)/);
  assert.match(script, /pack_code\.replace\(\"-\", \"_\"\)/);
  assert.match(script, /stock-lmo-inventory/);
  assert.match(script, /LANGUAGE_CAPABILITY/);
  assert.match(script, /factory setup blocked at country\/language/);
  assert.doesNotMatch(script, /set_language.*code.?0/i);
});

