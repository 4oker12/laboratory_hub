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
local total, nil_upvalue_events, max_events, recorded = 0, 0, 30000, 0
local controller_export_calls, controller_loaded_calls = 0, 0
local controller_export_count_at_finish = 0
local seen = {QUICK_SETUP=0, DISPATCHER=0, UBUS=0, UCI=0, NETWORK=0, WIRELESS=0, LUCI_OTHER=0, C_FUNCTION=0, STRIPPED_OR_OTHER_LUA=0, UNKNOWN_SOURCE=0}
local ring, ring_size, ring_head = {}, 72, 0
local function record(line)
  recorded = recorded + 1
  ring_head = (ring_head % ring_size) + 1
  ring[ring_head] = line
end
local function finish()
  debug.sethook()
  append("AX23_LUA_HOOK_SUMMARY=HOOK_EVENTS_" .. total ..
         "_LUA_EVENTS_" .. recorded ..
         "_NIL_UPVALUE_EVENTS_" .. nil_upvalue_events)
  local loaded = package and package.loaded or {}
  for _, name in ipairs({
    "luci.controller.admin.quick_setup",
    "luci.controller.admin.network",
    "luci.controller.admin.wireless",
    "luci.dispatcher",
    "luci.model.uci",
    "ubus",
    "uci"
  }) do
    local label
    if name == "luci.controller.admin.quick_setup" then label = "QUICK_SETUP"
    elseif name == "luci.controller.admin.network" then label = "NETWORK_CONTROLLER"
    elseif name == "luci.controller.admin.wireless" then label = "WIRELESS_CONTROLLER"
    elseif name == "luci.dispatcher" then label = "DISPATCHER"
    elseif name == "luci.model.uci" then label = "LUCI_UCI"
    elseif name == "ubus" then label = "UBUS"
    else label = "UCI" end
    append("AX23_LUA_LOADED_" .. label .. "=" .. (loaded[name] and "YES" or "NO"))
  end
  local final_module = loaded["luci.controller.admin.quick_setup"]
  if type(final_module) == "table" then
    for _, val in pairs(final_module) do
      if type(val) == "function" then
        controller_export_count_at_finish = controller_export_count_at_finish + 1
      end
    end
  end
  append("AX23_LUA_CONTROLLER_MODULE_FUNCTION_EXPORTS=" .. controller_export_count_at_finish)
  append("AX23_LUA_CONTROLLER_LOADED_DURING_EVENTS=" .. controller_loaded_calls)
  append("AX23_LUA_CONTROLLER_EXPORTED_CALL_EVENTS=" .. controller_export_calls)
  append("AX23_LUA_ERROR_STACK_TRIGGERS=" .. caught_error_call_count)
  for key, value in pairs(seen) do
    append("AX23_LUA_SOURCE_CATEGORY_" .. key .. "=" .. value)
  end
  -- Ring order is chronological, preserving only the last 72 calls/lines.
  local n = math.min(recorded, ring_size)
  local first = recorded >= ring_size and ring_head % ring_size + 1 or 1
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

local caught_error_call_count = 0
local function safe_error_stack(kind)
  if caught_error_call_count >= 4 then return end
  caught_error_call_count = caught_error_call_count + 1
  append("AX23_LUA_ERROR_STACK_TRIGGER=" .. kind)
  for depth = 3, 18 do
    local stack = debug.getinfo(depth, "Slu")
    if not stack then break end
    append("AX23_LUA_ERROR_STACK_FRAME=" .. depth ..
           " SOURCE=" .. category(stack.source) ..
           " LINE=" .. (tonumber(stack.linedefined) or -1) ..
           " CURRENT=" .. (tonumber(stack.currentline) or -1) ..
           " NUPS=" .. (tonumber(stack.nups) or -1))
  end
end
local function hook(event)
  if event ~= "call" and event ~= "return" and event ~= "tail return" and event ~= "line" then return end
  total = total + 1
  if total > max_events then
    debug.sethook()
    append("AX23_LUA_HOOK_EVENT_LIMIT=REACHED")
    return
  end
  local info = debug.getinfo(2, "nSful")
  if not info then return end
  -- Capture stacks only at native error/assert calls. No argument values,
  -- messages, raw module strings or token-bearing source paths are emitted.
  if event == "call" and info.what == "C" and
     (info.name == "error" or info.name == "assert") then
    safe_error_stack(info.name == "error" and "ERROR" or "ASSERT")
  end
  -- CGI teardown is dominated by native C calls, which obscure the Lua
  -- controller frames nearest the error. Keep only Lua functions.
  if info.what ~= "Lua" and info.what ~= "main" then return end
  local class = category(info.source)
  local exported = "NO"
  local controller = package and package.loaded and
                     package.loaded["luci.controller.admin.quick_setup"]
  if type(controller) == "table" then
    controller_loaded_calls = controller_loaded_calls + 1
    if event == "call" and type(info.func) == "function" then
      for _, value in pairs(controller) do
        if type(value) == "function" and value == info.func then
          controller_export_calls = controller_export_calls + 1
          exported = "YES"
          break
        end
      end
    end
  end
  seen[class] = (seen[class] or 0) + 1
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
  record("AX23_LUA_RING_FRAME=" .. total ..
         " EVENT=" .. (event == "call" and "CALL" or event == "line" and "LINE" or "RETURN") ..
         " SOURCE=" .. class ..
         " EXPORTED_QUICK_SETUP_FUNCTION=" .. exported ..
         " KIND=" .. what .. " LINE=" .. line .. " LAST=" .. last ..
         " CURRENT=" .. (tonumber(info.currentline) or -1) ..
         " NUPS=" .. (tonumber(info.nups) or -1) ..
         " NIL_UPVALUES=" .. nil_count ..
         " UPVALUES_READ=" .. upvalues)
end
debug.sethook(hook, "crl")
append("AX23_LUA_HOOK_ACTIVE=YES")
