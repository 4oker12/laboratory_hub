"use strict";
const status = document.querySelector("#status");
function isLocalRouter(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (["tplinkwifi.net", "tplinklogin.net"].includes(h)) return true;
    const o = h.split(".").map(Number);
    if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return o[0] === 10 || (o[0] === 192 && o[1] === 168) ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
  } catch { return false; }
}
document.querySelector("#start").addEventListener("click", async () => {
  status.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !isLocalRouter(tab.url)) throw Error("Откройте локальный веб-интерфейс роутера (например, http://192.168.0.1).");
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:["logic.js","content.js"]});
    status.textContent = "Мастер добавлен на страницу роутера. Пароли не записываются в хранилище расширения.";
  } catch (e) {status.textContent = "Ошибка: " + (e?.message || String(e));}
});
