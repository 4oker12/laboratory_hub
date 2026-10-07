-- RouterLab Xiaomi R4A runtime-only luci.sys adapter.
--
-- The stock luci.sys module is preserved as luci/sys.stock.lua and executed first.
-- qemu-user/PRoot exposes the host kernel's /proc/net/arp, so the synthetic browser
-- client 192.168.31.100 is absent and stock net.ip4mac() returns nil. Stock Xiaomi
-- templates then call string.upper(nil) and abort with HTTP 500.
--
-- Preserve every stock luci.sys behavior and add only one deterministic fallback
-- for RouterLab's synthetic LAN client. Unknown addresses keep stock behavior.

local stock_path = "/usr/lib/lua/luci/sys.stock.lua"
local ok, err = pcall(dofile, stock_path)
if not ok then
    error("RouterLab could not load stock luci.sys: " .. tostring(err))
end

local sys = package.loaded["luci.sys"]
if type(sys) ~= "table" or type(sys.net) ~= "table" or type(sys.net.ip4mac) ~= "function" then
    error("RouterLab stock luci.sys did not expose net.ip4mac")
end

local stock_ip4mac = sys.net.ip4mac
local routerlab_client_ip = "192.168.31.100"
local routerlab_client_mac = "02:11:22:33:44:64"

sys.net.ip4mac = function(ip)
    local value = stock_ip4mac(ip)
    if value ~= nil and value ~= "" then
        return value
    end
    if ip == routerlab_client_ip then
        return routerlab_client_mac
    end
    return value
end

return sys
