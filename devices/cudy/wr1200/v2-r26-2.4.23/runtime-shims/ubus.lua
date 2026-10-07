-- RouterLab compatibility transport for Cudy WR1200 V2/R26 stock LuCI.
--
-- The exact MIPS libubus client cannot exchange AF_UNIX traffic with stock
-- ubusd under qemu-user/PRoot, even though the socket exists. This module
-- replaces that transport boundary in the disposable runtime.
--
-- Authentication policy remains in the original Cudy LuCI dispatcher. The
-- dispatcher verifies the browser credential before calling session.login.
-- This shim only persists ubus session values and mints a session after the
-- credential is independently consistent with the stock LuCI credential store.
-- Unknown objects/methods still return nil rather than synthetic success.

local M = {}
local ZERO_SID = "00000000000000000000000000000000"
local SESSION_ROOT = "/tmp/routerlab-ubus-sessions"

local function shell_quote(s)
  s = tostring(s or "")
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

local function safe_atom(s)
  s = tostring(s or "")
  if s:match("^[A-Za-z0-9_.%-]+$") then return s end
  return nil
end

local function redact_key(k)
  k = tostring(k or ""):lower()
  return k == "password" or k == "token" or k == "secret" or k == "key"
end

local function quote(v)
  v = tostring(v or "")
  return string.format("%q", v)
end

local function serialize(value, depth, keyname)
  depth = depth or 0
  if depth > 3 then return '"<depth>"' end
  if keyname and redact_key(keyname) then return '"<redacted>"' end
  local t = type(value)
  if t == "nil" then return "null" end
  if t == "boolean" or t == "number" then return tostring(value) end
  if t == "string" then return quote(value) end
  if t ~= "table" then return quote("<" .. t .. ">") end

  local parts = {}
  for k, v in pairs(value) do
    parts[#parts + 1] = quote(k) .. ":" .. serialize(v, depth + 1, k)
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

local function ensure_dir(path)
  os.execute("mkdir -p " .. shell_quote(path) .. " >/dev/null 2>&1")
end

local function session_dir(sid)
  sid = tostring(sid or ZERO_SID)
  if not sid:match("^[0-9a-fA-F]+$") then return nil end
  return SESSION_ROOT .. "/" .. sid
end

local function write_value(sid, key, value)
  local skey = safe_atom(key)
  local dir = session_dir(sid)
  if not skey or not dir then return false end
  ensure_dir(dir)
  local f = io.open(dir .. "/" .. skey, "wb")
  if not f then return false end
  f:write(tostring(value))
  f:close()
  return true
end

local function read_value(sid, key)
  local skey = safe_atom(key)
  local dir = session_dir(sid)
  if not skey or not dir then return nil end
  local f = io.open(dir .. "/" .. skey, "rb")
  if not f then return nil end
  local v = f:read("*a")
  f:close()
  return v
end

local function read_values(sid)
  local dir = session_dir(sid)
  if not dir then return {} end
  ensure_dir(dir)
  local out = {}
  local p = io.popen("ls -1 " .. shell_quote(dir) .. " 2>/dev/null")
  if not p then return out end
  for key in p:lines() do
    if safe_atom(key) then
      out[key] = read_value(sid, key)
    end
  end
  p:close()
  return out
end

local function remove_value(sid, key)
  local skey = safe_atom(key)
  local dir = session_dir(sid)
  if not skey or not dir then return end
  os.remove(dir .. "/" .. skey)
end

local function decode_routerlab_ciphertext(value)
  value = tostring(value or "")
  local hex = value:match("^RLAB1:([0-9a-fA-F]*)$")
  if hex == nil or (#hex % 2) ~= 0 then return nil end
  return (hex:gsub("..", function(cc)
    return string.char(tonumber(cc, 16))
  end))
end

local function sha256_hex(value)
  value = tostring(value or "")
  if not value:match("^[0-9a-fA-F]+$") then return nil end
  local p = io.popen("printf %s " .. shell_quote(value) .. " | sha256sum | cut -c1-64")
  if not p then return nil end
  local out = p:read("*l")
  p:close()
  if out and out:match("^[0-9a-fA-F][0-9a-fA-F]+$") then
    return out:lower()
  end
  return nil
end

local function credential_matches(username, submitted)
  username = safe_atom(username)
  submitted = tostring(submitted or ""):lower()
  if not username or not submitted:match("^[0-9a-f]+$") or #submitted ~= 64 then
    return false
  end

  local ok, uci_mod = pcall(require, "luci.model.uci")
  if not ok or not uci_mod then return false end
  local cursor = uci_mod.cursor()
  local stored = cursor:get("luci", "sauth", username)
  local inner = decode_routerlab_ciphertext(stored)
  if not inner or not inner:match("^[0-9a-fA-F]+$") or #inner ~= 64 then
    return false
  end
  inner = inner:lower()

  -- Factory create-password POST has no challenge token; the submitted value is
  -- exactly sha256(password + salt), which is what stock LuCI just persisted.
  if submitted == inner then return true end

  -- Configured login adds the zero-session challenge token in stock sysauth.js:
  -- sha256(sha256(password + salt) + token).
  local token = read_value(ZERO_SID, "token")
  if token and token:match("^[0-9a-fA-F]+$") then
    local challenged = sha256_hex(inner .. token)
    if challenged and submitted == challenged then return true end
  end

  return false
end

local function mint_session(username, timeout)
  ensure_dir(SESSION_ROOT)
  local p = io.popen("cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' | cut -c1-32")
  local sid = p and p:read("*l") or nil
  if p then p:close() end
  if not sid or not sid:match("^[0-9a-fA-F]+$") or #sid < 16 then
    sid = sha256_hex(string.format("%x%x", os.time(), math.random(1, 0x7fffffff)))
  end
  sid = tostring(sid or ZERO_SID):sub(1, 32):lower()
  write_value(sid, "username", username)
  write_value(sid, "timeout", tonumber(timeout) or 3600)
  return sid
end

local Connection = {}
Connection.__index = Connection

function Connection:call(object, method, data)
  data = data or {}
  trace(object, method, data)

  if object ~= "session" then
    return nil
  end

  if method == "get" then
    local sid = data.ubus_rpc_session or ZERO_SID
    return { values = read_values(sid) }
  end

  if method == "set" then
    local sid = data.ubus_rpc_session or ZERO_SID
    if type(data.values) == "table" then
      for k, v in pairs(data.values) do
        if type(v) == "string" or type(v) == "number" or type(v) == "boolean" then
          write_value(sid, k, v)
        end
      end
    end
    return {}
  end

  if method == "unset" then
    local sid = data.ubus_rpc_session or ZERO_SID
    if type(data.keys) == "table" then
      for _, key in pairs(data.keys) do remove_value(sid, key) end
    end
    return {}
  end

  if method == "login" then
    if not credential_matches(data.username, data.password) then
      return nil
    end
    local sid = mint_session(data.username, data.timeout)
    return {
      ubus_rpc_session = sid,
      timeout = tonumber(data.timeout) or 3600
    }
  end

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
  ensure_dir(SESSION_ROOT)
  ensure_dir(session_dir(ZERO_SID))
  return setmetatable({}, Connection)
end

return M
