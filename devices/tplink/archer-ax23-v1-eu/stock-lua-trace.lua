-- Optional, read-only Lua CGI execution trace for isolated AX23 firmware.
-- This is NOT a vendor file. Loaded by LUA_INIT only in the disposable
-- QEMU rootfs. It never records token/cookie/body, parameter values,
-- filenames, literal strings, or upvalue contents.
local query = os.getenv("QUERY_STRING") or ""
local path = os.getenv("PATH_INFO") or ""
local uri = os.getenv("REQUEST_URI") or ""
local target = query:find("quick_setup", 1, true) or
               path:find("quick_setup", 1, true) or
               uri:find("quick_setup", 1, true)
if not target then return end

local function append(line)
  local f = io.open("/tmp/ax23-lua-trace.private", "a")
  if f then
    f:write(line, "\n")
    f:close()
  end
end

append("AX23_LUA_HOOK_START=QUICK_SETUP_CGI")
if type(debug) ~= "table" or type(debug.sethook) ~= "function" or
   type(debug.getinfo) ~= "function" then
  append("AX23_LUA_HOOK_UNAVAILABLE")
  return
end

local limit = 6000
local events = 0
local matches = 0
local function category(source)
  if type(source) ~= "string" then return "OTHER" end
  local x = string.lower(source)
  if string.find(x, "quick_setup", 1, true) then return "QUICK_SETUP" end
  if string.find(x, "dispatcher", 1, true) then return "DISPATCHER" end
  if string.find(x, "ubus", 1, true) then return "UBUS" end
  if string.find(x, "uci", 1, true) then return "UCI" end
  if string.find(x, "network", 1, true) then return "NETWORK" end
  if string.find(x, "wireless", 1, true) then return "WIRELESS" end
  if string.find(x, "luci", 1, true) then return "LUCI_OTHER" end
  return "OTHER"
end

local function hook(event)
  if event ~= "call" then return end
  events = events + 1
  if events > limit then
    debug.sethook()
    append("AX23_LUA_HOOK_LIMIT_REACHED")
    return
  end
  local info = debug.getinfo(2, "Sfu")
  if not info then return end
  local cls = category(info.source)
  if cls == "OTHER" then return end
  matches = matches + 1
  if matches > 320 then return end
  local nil_count, upvalues = 0, 0
  if info.func and debug.getupvalue then
    for i = 1, 64 do
      local name, value = debug.getupvalue(info.func, i)
      if name == nil then break end
      upvalues = upvalues + 1
      if value == nil then nil_count = nil_count + 1 end
    end
  end
  local line = tonumber(info.linedefined) or -1
  local last = tonumber(info.lastlinedefined) or -1
  local nups = tonumber(info.nups) or -1
  append("AX23_LUA_CALL=" .. matches .. " CATEGORY=" .. cls ..
         " LINE=" .. line .. " LAST=" .. last ..
         " NUPS=" .. nups .. " NIL_UPVALUES=" .. nil_count ..
         " UPVALUES_READ=" .. upvalues)
end
debug.sethook(hook, "c")
append("AX23_LUA_HOOK_ACTIVE=YES")
