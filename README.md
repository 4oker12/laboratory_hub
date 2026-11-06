# NetCheck Explorer v0.4 — PDR on iPhone

**Unsigned iPhone IPA source. Signing with Sideloadly is required before device installation.**

## First test on iPhone

1. Start NetCheck; tap **Роутер в центре**.
2. Tap on the map to set your **actual** phone start point.
3. Tap **Начать обход**. Give Motion and Location *While Using* permissions when prompted.
4. Hold iPhone with the TOP edge pointing toward the TOP of the displayed apartment map. Tap **Совместить компас ↑**.
5. Walk straight 3 metres, keeping the TOP edge of phone facing along the walking direction; pause for 5 seconds.
6. Check the dashed estimated path and **До роутера ~X м**. Repeat with a 90° turn. Use manual arrow keys if compass accuracy is poor.
7. If path drifted, select **Исправить моё положение** and tap the actual map spot.
8. Export TXT using **Журнал ошибок и событий** (share button). All logs persist between launches.

## Model and limitations

- CoreMotion `CMPedometer`: steps, *estimated* walked metres.
- CoreLocation: magnetic device heading and heading accuracy. **Not walking direction unless phone top edge faces forward.**
- CoreLocation GPS: shows horizontal accuracy only. GPS **does not automatically move** the indoor marker. GPS coordinates are never logged.
- PDR route and distance to router are **estimates**, not true position measurements.
- 16 × 16 m schematic room map; tapping chooses router and initial phone position.
- Trigger: 3 metres of recorded movement + 5 seconds without new pedometer samples; another optional check every 30 min while app remains active.
- Background continuous measurements aren't guaranteed. Use with the app foreground.
- The network probe is HTTP duration to Cloudflare; not Wi-Fi RSSI or ICMP ping.
- A device with substantial magnetic interference can output invalid heading; manual arrows remain available.

## Logs

APP_LAUNCH, ROUTER_SET, PHONE_START_SET, SURVEY_STARTED,
HEADING_READING, HEADING_INVALID, COMPASS_ALIGNED, COMPASS_ALIGN_FAILED,
GPS_QUALITY, GPS_REFERENCE, TRACK_SEGMENT, MAP_BOUNDARY,
DISTANCE_THRESHOLD, STOP_DETECTED, PROBE_STARTED, PROBE_OK, PROBE_ERROR,
POINT_SAVED, POSITION_CORRECTED, SURVEY_FINISHED, SENSOR_ERROR.

All logs saved in Documents, export via native share sheet. No raw GPS latitude/longitude saved.

## Installation

Download **NetCheckWalkTest-UNSIGNED-iPhone** from GitHub Actions artifacts, unzip to find `.ipa`, use Sideloadly on Windows to sign/install with your own Apple ID. Compiled on macOS GitHub Actions; on-device sensor function still needs validation.
