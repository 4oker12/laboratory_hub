/* Device dispatch for Netis N2 FW4, in the existing RouterLab MV3 worker.
 * Router address is evidence-scoped: no LAN-wide scanning, no arbitrary URL from UI.
 */
'use strict';
globalThis.RouterLabNetisDispatcher = (() => {
  const ORIGIN = 'http://192.168.1.1/';
  const api = globalThis.RouterLabNetisFW4;
  if (!api) throw new Error('NETIS_ADAPTER_MISSING');
  const driver = new api.NetisFW4Adapter({
    transport: api.createFetchTransport({baseUrl: ORIGIN})
  });
  let busy = false;
  let lastFingerprint = null;

  function authorizeSender(sender) {
    if (sender?.id !== chrome.runtime.id) return false;
    try {
      const u = new URL(sender.url);
      return u.origin === new URL(chrome.runtime.getURL('setup.html')).origin &&
        u.pathname === '/setup.html' && u.searchParams.get('device') === 'netis';
    } catch { return false; }
  }

  async function fingerprint() {
    const info = await driver.detect();
    if (!info.supported) throw new Error('NETIS_N2_FW4_NOT_CONFIRMED');
    lastFingerprint = info.version;
    return info;
  }
  async function snapshot() {
    await fingerprint();
    const wan = await driver.readWan();
    const wifi = await driver.readWifi();
    const igmp = await driver.readIgmp();
    return {wan,wifi,igmp,firmware:lastFingerprint,
      verified:'READ_ONLY',persistence:'NOT_TESTED'};
  }

  async function command(message) {
    if (!message || typeof message.type !== 'string') throw new Error('NETIS_INVALID_COMMAND');
    if (busy) throw new Error('NETIS_OPERATION_BUSY');
    busy=true;
    try {
      switch (message.type) {
        case 'netis.detect':
          return await fingerprint();
        case 'netis.login': {
          await fingerprint();
          const result=await driver.login(message.password);
          if (result.status!=='REQUEST_OK') return {status:result.status,readConfirmed:false};
          // Login success alone is not proof of protected access; probe a read.
          try {
            const after=await driver.readWan();
            return {status:'LOGIN_ACCEPTED',readConfirmed:!!after};
          } catch {
            return {status:'LOGIN_ACCEPTED_READ_UNCONFIRMED',readConfirmed:false};
          }
        }
        case 'netis.snapshot':
          return await snapshot();
        case 'netis.factoryDhcp':
          await fingerprint();
          return await driver.factoryDhcp(message.settings,{confirmed:message.confirmed===true});
        case 'netis.radioPower':
          await fingerprint();
          return await driver.setRadioPower(message.band,message.power,{confirmed:message.confirmed===true});
        case 'netis.igmp':
          await fingerprint();
          return await driver.setIgmp({
            proxy:message.proxy,snooping:message.snooping,confirmed:message.confirmed===true
          });
        default:
          throw new Error('NETIS_UNKNOWN_COMMAND');
      }
    } finally {busy=false;}
  }
  return Object.freeze({authorizeSender,command,origin:ORIGIN});
})();