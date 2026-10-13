/* RouterLab v0.5 installation entry point. No server or remote scripts. */
'use strict';
const CUDY_URL = 'http://192.168.10.1/cgi-bin/luci';
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({url: CUDY_URL, active: true});
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({url: CUDY_URL, active: true}));
