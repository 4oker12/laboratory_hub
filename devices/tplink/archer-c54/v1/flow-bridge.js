/* RouterLab C54 EU V1: derive the safe UI state machine from existing C20Flow.
 * No C54 login, crypto, CGI, WAN SET or WLAN SET is inferred from this bridge.
 * Load alongside C20's pure flow.js for research; package an independent runtime later.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RouterLabC54Bridge = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const profile = Object.freeze({
    vendor: 'TP-Link',
    model: 'Archer C54',
    hardware: 'V1',
    region: 'EU',
    firmwareReference: '1.15.0 Build 250811',
    protocol: 'UNVERIFIED',
    allowRead: false,
    allowWrite: false
  });
  function identity(input) {
    const model = String(input && input.model || '').trim();
    const hardware = String(input && input.hardware || '').trim();
    const region = String(input && input.region || '').trim().toUpperCase();
    const exactModel = /^Archer\s+C54$/i.test(model);
    const exactHardware = /^V?1(?:\.(?:0|6|8|9))?$/i.test(hardware);
    const exactRegion = region === 'EU';
    const candidate = exactModel && exactHardware && exactRegion;
    return Object.freeze({
      model, hardware, region, candidate, verified: false,
      allowRead: false, allowWrite: false,
      reason: candidate
        ? 'C54_EU_V1_IDENTITY_CANDIDATE_PROTOCOL_UNVERIFIED'
        : 'C54_MODEL_HARDWARE_OR_REGION_MISMATCH'
    });
  }
  function create(c20Flow) {
    if (!c20Flow || typeof c20Flow.classifyNative !== 'function' ||
        typeof c20Flow.cleanWifi !== 'function' ||
        typeof c20Flow.quickStepFromSignals !== 'function')
      throw Error('C20_FLOW_BASE_REQUIRED');
    return Object.freeze({
      profile,
      identity,
      classifyNative(native, id) {
        if (!id || !id.candidate || !native || !native.isC54) {
          return { mode: 'UNAVAILABLE', phase: 'NO_C54', action: 'DISCOVER' };
        }
        // The same high-level state machine, but never C20's transport privileges.
        const result = c20Flow.classifyNative({ ...native, isC20: true });
        return { ...result, protocolVerified: false, allowRead: false, allowWrite: false };
      },
      cleanWifi(form) {
        return c20Flow.cleanWifi(form);
      },
      quickStepFromSignals(signals) {
        return c20Flow.quickStepFromSignals(signals);
      },
      firmwareOperation() {
        throw Error('C54_FIRMWARE_OPERATION_NOT_SUPPORTED');
      },
      readProtectedConfiguration() {
        throw Error('C54_PROTOCOL_UNVERIFIED');
      },
      applyConfiguration() {
        throw Error('C54_WRITE_NOT_VERIFIED');
      }
    });
  }
  return Object.freeze({ profile, identity, create });
});
