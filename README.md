# Laboratory Hub

Independent multi-device router laboratory.

This repository contains router/firmware laboratory code only. It is deliberately
separate from SIMNET Workbench and grows by vendor → model → firmware variant.

## Current target

| Device id | Model | Firmware | State |
|---|---|---|---|
| `xiaomi-r4a-3.0.24-int` | Xiaomi Mi Router 4A Gigabit Edition (R4A) | Global/International 3.0.24 | active |

The migrated R4A target includes stock authentication/stok, factory registration
wizard, DHCP/PPPoE configuration semantics, Wi-Fi 2.4/5 GHz, persistent state,
factory reset, language-pack materialization and the stock Xiaomi management UI/API.

RF/PHY/switch behavior and a real WAN peer are outside the current emulator.

## Main entry point

Linux/WSL:

```bash
python3 routerlab.py list
python3 routerlab.py info --device xiaomi-r4a-3.0.24-int
python3 routerlab.py reset --device xiaomi-r4a-3.0.24-int --profile factory
python3 routerlab.py start --device xiaomi-r4a-3.0.24-int --profile factory
python3 routerlab.py status --device xiaomi-r4a-3.0.24-int
```

Windows PowerShell:

```powershell
.\Run-RouterLab.ps1 -Action List
.\Run-RouterLab.ps1 -Action Reset -Device xiaomi-r4a-3.0.24-int -Profile Factory
.\Run-RouterLab.ps1 -Action Start -Device xiaomi-r4a-3.0.24-int -Profile Factory
.\Run-RouterLab.ps1 -Action Status -Device xiaomi-r4a-3.0.24-int
```

The R4A stock UI is available at `http://127.0.0.1:18090/` after start.

Scenario/API commands use the same root dispatcher:

```bash
python3 routerlab.py inspect --device xiaomi-r4a-3.0.24-int -- --admin-password admin
python3 routerlab.py first-run --device xiaomi-r4a-3.0.24-int -- \
  --router-name RouterLab --ssid RouterLab --wifi-password RouterLabWifi88 \
  --admin-password RouterLabAdmin88
```

See `docs/ARCHITECTURE.md` and the device-specific README under `devices/`.
