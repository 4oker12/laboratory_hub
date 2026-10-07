-- RouterLab Xiaomi R4A runtime-only ubus compatibility shim.
--
-- Scope is deliberately narrow: stock LuCI needs the live netifd WAN status
-- object during initial DHCP conflict detection, but qemu-user does not run the
-- router kernel/netifd/ubusd stack. Configuration authority remains stock UCI.
-- Unknown ubus calls fail loudly instead of returning invented facts.

local M = {}

local function wan_status()
    local proto = "dhcp"
    local ok, uci = pcall(require, "luci.model.uci")
    if ok and uci then
        local cursor = uci.cursor()
        proto = cursor:get("network", "wan", "proto") or proto
    end

    return {
        ["ipv4-address"] = {},
        ["ipv6-address"] = {},
        ["dns-server"] = {},
        route = {},
        proto = proto,
        up = false,
        uptime = 0,
        pending = false,
        autostart = true,
    }
end

function M.connect()
    local conn = {}

    function conn:call(object, method, args)
        if object == "network.interface.wan" and method == "status" then
            return wan_status()
        end
        error(
            "RouterLab ubus shim unsupported call: "
                .. tostring(object)
                .. " "
                .. tostring(method)
        )
    end

    function conn:close()
        return true
    end

    return conn
end

return M
