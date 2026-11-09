-- Read-only call-ring trace for a genuine AX23 Quick Setup CGI request.
-- Loaded ONLY into the disposable copy of the Lua shebang CGI.
-- No request content, credentials, tokens, variable values, raw Lua strings
-- or proprietary source code can be emitted. The script does not intercept,
-- suppress or replace original LuCI errors or responses.
local q = os.getenv("QUERY_STRING") or ""
local p = os.getenv("PATH_INFO") or ""
local u = os.getenv("REQUEST_URI") or ""
if not (q:find("quick_setup", 1, true) or
        p:find("quick_setup", 1, true) or
        u:find("quick_setup", 1, true)) then return end

local function append(line)
  local f = io.open("/tmp/ax23-lua-trace.private", "a")
  if f then f:write(line, "\n"); f:close() end
end
append("AX23_LUA_HOOK_START=QUICK_SETUP_CGI")
if not debug or not debug.sethook or not debug.getinfo then
  append("AX23_LUA_HOOK_UNAVAILABLE")
  return
end
local function category(source)
  if type(source) ~= "string" then return "UNKNOWN_SOURCE" end
  local x = string.lower(source)
  if x:find("quick_setup", 1, true) then return "QUICK_SETUP" end
  if x:find("dispatcher", 1, true) then return "DISPATCHER" end
  if x:find("ubus", 1, true) then return "UBUS" end
  if x:find("uci", 1, true) then return "UCI" end
  if x:find("network", 1, true) then return "NETWORK" end
  if x:find("wireless", 1, true) then return "WIRELESS" end
  if x:find("luci", 1, true) then return "LUCI_OTHER" end
  if x == "=[c]" then return "C_FUNCTION" end
  return "STRIPPED_OR_OTHER_LUA"
end
local total, nil_upvalue_events, max_events = 0, 0, 12000
local ring, ring_size, ring_head = {}, 72, 0
local function record(line)
  ring_head = (ring_head % ring_size) + 1
  ring[ring_head] = line
end
local function finish()
  debug.sethook()
  append("AX23_LUA_HOOK_SUMMARY=TOTAL_" .. total ..
         "_NIL_UPVALUE_EVENTS_" .. nil_upvalue_events)
  -- Ring order is chronological, preserving only the last 72 calls.
  local n = math.min(total, ring_size)
  local first = n == ring_size and ring_head % ring_size + 1 or 1
  for i = 0, n - 1 do
    local pos = (first + i - 1) % ring_size + 1
    if ring[pos] then append(ring[pos]) end
  end
  append("AX23_LUA_HOOK_FINISHED=YES")
end
-- Lua 5.1 finalizer is kept alive until interpreter shutdown. It writes
-- the bounded ring without wrapping or altering the stock CGI dispatcher.
if type(newproxy) == "function" then
  local sentinel = newproxy(true)
  getmetatable(sentinel).__gc = finish
  _G.__routerlab_ax23_hook_sentinel = sentinel
else
  append("AX23_LUA_HOOK_FINALIZER_UNAVAILABLE")
end

local function hook(event)
  if event ~= "call" then return end
  total = total + 1
  if total > max_events then
    debug.sethook()
    append("AX23_LUA_HOOK_EVENT_LIMIT=REACHED")
    return
  end
  local info = debug.getinfo(2, "Sfu")
  if not info then return end
  local nil_count, upvalues = 0, 0
  if info.func and debug.getupvalue and (tonumber(info.nups) or 0) > 0 then
    for i = 1, 32 do
      local name, value = debug.getupvalue(info.func, i)
      if name == nil then break end
      upvalues = upvalues + 1
      if value == nil then nil_count = nil_count + 1 end
    end
  end
  if nil_count > 0 then nil_upvalue_events = nil_upvalue_events + 1 end
  local what = info.what == "C" and "C" or "LUA"
  local line = tonumber(info.linedefined) or -1
  local last = tonumber(info.lastlinedefined) or -1
  record("AX23_LUA_RING_CALL=" .. total ..
         " SOURCE=" .. category(info.source) ..
         " KIND=" .. what .. " LINE=" .. line .. " LAST=" .. last ..
         " NUPS=" .. (tonumber(info.nups) or -1) ..
         " NIL_UPVALUES=" .. nil_count ..
         " UPVALUES_READ=" .. upvalues)
end
debug.sethook(hook, "c")
append("AX23_LUA_HOOK_ACTIVE=YES")
