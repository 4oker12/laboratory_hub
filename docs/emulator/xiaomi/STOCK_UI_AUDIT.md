# Xiaomi R4A 3.0.24 — stock UI coverage audit

Date: 2026-11-11. Repository: `4oker12/laboratory_hub`.
Target: **Xiaomi Mi Router 4A Gigabit Edition, R4A, Global/International firmware 3.0.24**.
Sources: exact target manifest and rehost handoff in `main`; stock initial-setup JavaScript displayed by the historical successful GitHub Actions rehost run `37573932058`, job `112638489734`; and the current `feat/xiaomi-operator-web-emulator` source.

## Verdict

**The training website is NOT a complete or visually faithful copy of the stock Xiaomi UI.**
The website was independently drawn to resemble the MiWiFi interface. It does not load original stock Xiaomi `/www` markup, CSS, JS chunks or original LuCI rendered pages. It must not be marketed or described as a stock web emulator of the TP-Link emulator-site fidelity.

The original firmware rehost in `devices/xiaomi/mi-router-4a-gigabit-r4a/3.0.24-int/` **does** execute original stock UI and some original APIs locally, but a working stock backend is not proof that all browser pages work.

## 1. Exact stock wizard source inventory

The workflow log shows `36` distinct Vue route paths from the original **initial setup application**. These are recorded in machine-readable `stock-ui-inventory.json`.

Coverage based on matching to current training screens:

- **0 / 36** exact visually verified stock routes.
- **9 / 36** loosely *approximated* in meaning (not stock page parity).
- **27 / 36** have no corresponding training screen.

Notable stock initial-setup routes missing as separate flows: `/static` (static IP), `/repeater`, `/operator`, `/operators`, `/get_from_old_router`, `/diagnose_desp`, `/wan_error`, `/network_error`, `/wired`, `/wireless`, `/agreement`, `/privacy` and several region/privacy variants.

The list is **not an exhaustive authenticated admin menu list**: it comes from the stock initial-setup JS printed in that run. The admin SPA/web controller routes still require separate extraction/inventory.

There are **35 distinct stock API path strings** observed in that source evidence, including `/api/xqnetwork/set_wan_new`, `/api/misystem/set_iptv`, `/api/misystem/net_diagnose_start`, `/api/misystem/net_diagnose_result`, `/api/xqnetwork/wifi_list`, and `/api/xqnetwork/set_all_wifi`. A string in the frontend bundle proves only that the application references the endpoint, **not** that the endpoint has been tested or works in rehost.

## 2. Current site versus source-backed implementation

| Feature | Offline training site | Genuine stock rehost | Unfinished verification |
|---|---|---|---|
| Look/layout | Custom blue MiWiFi-like HTML/CSS | Original firmware `/www` | Screenshot/DOM parity, navigation labels |
| First run | Five scripted training steps | Stock `init.html`, login/stok, `set_router_normal` | Real browser full end-to-end wizard after language fix |
| Country/language | Custom select fields | Stock locale materialization + browser path acceptance | Full language switching behavior |
| WAN DHCP | Local JSON state change | Stock setter and UCI persistence proven | Stock browser form and live WAN status |
| PPPoE | Local JSON state change | Stock setter config proven, no PPPoE peer | Stock browser procedure and connection status |
| Static WAN | **Absent** | Stock wizard JS references `/static` | Full stock contract and runtime acceptance |
| Wi-Fi 2.4/5 GHz | Local state, SSID/password/hidden/channel | Stock `set_wifi` / `wifi_detail_all` and cold persistence proven | Original browser form fidelity and all fields |
| LAN/DHCP | Independent training fields | No equivalent end-to-end acceptance documented | Stock menu, API contract, actual settings |
| Login | Local password comparison | Genuine stock authentication and `stok` proven | Exact browser layout/logout/session lifecycle |
| Connected devices | Static placeholder (0) | No physical client telemetry emulated | Stock client panel/UI |
| QoS | Training placeholder | Original route guarded as unsupported in lab | If visual-only, stock page inventory and safe fixtures |
| IPTV/VLAN | **Absent** | Initial JS references `set_iptv` | Stock form, payload, readback |
| Diagnosis/network errors | Four custom outage fixtures | Stock JS references several error/diagnosis routes | Exact stock flows and UI |
| Repeater / bridge | **Absent** | Stock JS contains `/repeater` | State transitions and stock browser layout |
| Reboot/reset | Local simulated actions | Lab runtime reset/cold boot exists | Stock UI buttons and full effects |
| Firmware upgrade | **Absent** | No successful upgrade operation established | Stock page and safe visual-only fixture |
| Other admin menus | Custom nine-ish panels | Admin route list NOT exhaustively inventoried | Complete route and asset inventory |

Do not infer full coverage from a passing JavaScript syntax check, pure unit test, isolated stock API call, or successful CI job. No automated screenshots or manual Chrome/mobile end-to-end parity acceptance have been recorded for the new website.

## 3. Architecture correction

There are two complementary targets, but they are not substitutes:

- **Authentic source target**: Xiaomi stock rehost + immutable stock rootfs + original UI routes and original controllers. Use as reference, not force-fit it into static localhost-free hosting.
- **Portable operator site**: catalog + per-firmware profile + browser simulation. Its screens must be derived from the exact original UI inventory and validated page by page, with clear 'simulated' labels for hardware-dependent data.

Recommended next order:

1. Extract the exact **stock admin UI** route list and UI assets for both factory/configured profiles; serialize inventories per model/firmware and retain the hashes.
2. Build a navigation/screen coverage matrix with states `unmapped`, `source-backed`, `renders`, `interactive`, `visually-verified`. Keep the current 36-route initial setup inventory as seed evidence only.
3. Prioritize authentic-looking first run (including static WAN, repeater and error branches), configured login, status, WAN, Wi-Fi, LAN, client list and core troubleshooting.
4. Base screen layout and form field names on actual stock markup/screenshots and distinguish vendor UI behavior from synthetic backend fixtures.
5. Add browser automated navigation, screenshots at desktop/mobile sizes, visual diffs and form scenario checks. Test from an empty factory state, after configured login and after simulated reset.
6. Only call a screen 'complete' when its source provenance, layout, navigation and form interactions are demonstrated. Only call the whole model complete once every stock route is classified with accepted support/intentional omission evidence.

The current PR must remain draft. Publishing it as a completed TP-Link-style Xiaomi clone would misrepresent coverage.

## 4. Evidence limitations

I audited the stock frontend **from source snippets preserved in a prior successful GitHub Actions log**, the repository code and existing rehost tests. I did **not** newly download and unpack the entire firmware in this session. Therefore the 36 paths are an exact inventory **of the observed wizard bundle only**, not a claim that they exhaust all Xiaomi 3.0.24 frontend pages.
