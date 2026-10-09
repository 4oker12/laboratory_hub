-- RouterLab hardware-boundary shim for Cudy stock Lua "bdinfo" module.
--
-- Stock firmware reads board identity and integrity state from flash/MTD through
-- libbdinfo. qemu-user/PRoot has no physical board flash. This shim supplies
-- deterministic lab identity only; LuCI/auth/UCI/wizard behavior stays stock.

local M = {}

local function getenv(name, fallback)
  local value = os.getenv(name)
  if value == nil or value == "" then return fallback end
  return value
end

local function value(key)
  local board = getenv("ROUTERLAB_CUDY_BOARD_NAME", "R26")
  local model = getenv("ROUTERLAB_CUDY_MODEL_NAME", "WR1200")
  local values = {
    board = board,
    model = model,
    factory = getenv("ROUTERLAB_CUDY_BDINFO_FACTORY", "0"),
    mac = getenv("ROUTERLAB_CUDY_MAC", "02:11:22:33:44:50"),
    pin = getenv("ROUTERLAB_CUDY_PIN", "24681357"),
    country = getenv("ROUTERLAB_CUDY_COUNTRY", "US"),
    fuuid = getenv("ROUTERLAB_CUDY_FUUID", "routerlab-" .. board .. "-fuuid"),
    hmac = getenv("ROUTERLAB_CUDY_HMAC", "routerlab-" .. board .. "-hmac"),
    sn = getenv("ROUTERLAB_CUDY_SN", "ROUTERLAB-" .. board),
  }
  return values[key]
end

function M.get(key)
  return value(key)
end

function M.check()
  return true
end

function M.checkuuid()
  return true
end

return M
