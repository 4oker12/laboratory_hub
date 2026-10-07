-- RouterLab transport-only compatibility shim for Cudy WR1200 V2/R26.
--
-- Exact stock LuCI requires the MIPS libubus Lua module. Under qemu-user + PRoot
-- the exact stock ubusd can create its Unix socket, but the exact stock MIPS ubus
-- client cannot connect to it, even when both are launched under one PRoot
-- invocation. That failure is captured by the target CI evidence.
--
-- This first-stage shim deliberately does NOT emulate successful login, UCI writes,
-- WAN state, Wi-Fi state, or any other Cudy business logic. It only provides a live
-- ubus connection object so stock LuCI can continue far enough to reveal which ubus
-- calls are actually required. Unknown calls return nil, matching an unavailable
-- object/method rather than synthesizing success.

local M = {}

local function quote(v)
  v = tostring(v or "")
  return string.format("%q", v)
end

local function serialize(value, depth)
  depth = depth or 0
  if depth > 3 then return '"<depth>"' end
  local t = type(value)
  if t == "nil" then return "null" end
  if t == "boolean" or t == "number" then return tostring(value) end
  if t == "string" then return quote(value) end
  if t ~= "table" then return quote("<" .. t .. ">") end

  local parts = {}
  for k, v in pairs(value) do
    parts[#parts + 1] = quote(k) .. ":" .. serialize(v, depth + 1)
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function trace(object, method, data)
  local f = io.open("/tmp/routerlab-ubus-calls.log", "a")
  if f then
    f:write(os.date("!%Y-%m-%dT%H:%M:%SZ"), "\t", tostring(object), "\t",
      tostring(method), "\t", serialize(data), "\n")
    f:close()
  end
end

local Connection = {}
Connection.__index = Connection

function Connection:call(object, method, data)
  trace(object, method, data)

  -- Do not mint sessions or report permissions in the transport-discovery stage.
  -- Returning nil lets the original LuCI dispatcher decide that the caller is not
  -- authenticated and render the stock login/factory path.
  return nil
end

function Connection:close()
  return true
end

function Connection:objects()
  return {}
end

function Connection:signatures()
  return {}
end

function M.connect()
  return setmetatable({}, Connection)
end

return M
