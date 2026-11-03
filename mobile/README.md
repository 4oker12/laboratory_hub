# RouterLab Mobile — минимальный тест Netis N2 FW4

Это узкий эксперимент на собственном Netis N2, а не универсальный менеджер роутеров, App Clip или автоматическое подключение к Wi-Fi.

## Что выполняется

1. Вручную подключить iPhone к Wi-Fi Netis.
2. Открыть установленный RouterLab Mobile. При первом запуске он пробует http://192.168.1.1/. Если адрес другой, введите его сверху: после успешной загрузки приложение запомнит адрес для следующих запусков.
3. Поверх страницы появляется веб-панель RouterLab (Shadow DOM). Она работает в том же локальном origin, используя немодифицированный протокольный адаптер из PR #3.
4. Панель проверяет Netis N2 и точную N2-V4.0.1.4317/CIS. Неизвестную модель или прошивку не настраивает.
5. Сначала проверяется read-only состояние уже настроенного Netis без сброса.

Нет Chrome API, внешнего сервера, фонового сканирования или автоматического переключения Wi-Fi. Полного исходного ZIP Router-Origin Overlay Pilot 5 в GitHub пока нет: мы повторно используем подтверждённый адаптер CGI, но панель для iOS отдельная.

## Физический тест

1. На **настроенном** Netis откройте приложение и проверьте распознавание. Если отличается IP, исправьте поле адреса сверху и нажмите «Открыть».
2. Ожидаемое: CONFIGURED и успешное чтение WAN/WLAN/IGMP. При необходимости войдите с административным паролем.
3. **Только при готовности к сбросу настроек** выполните отдельный заводской тест. После ручного сброса FACTORY панель предлагает пароль администратора, SSID 2.4/5 ГГц, пароль Wi-Fi и DHCP для WAN.
4. Подтвердите запись и нажмите «Применить один раз». Попытка фиксируется до POST; повтор после потери соединения запрещён.
5. Wi-Fi может оборваться. Откройте настройки iPhone, вручную подключитесь к новому SSID, вернитесь в RouterLab и нажмите верхнюю кнопку «Обновить».
6. Успешный промежуточный результат: роутер отвечает CONFIGURED и подтверждает доступность WAN/WLAN/IGMP после переподключения. Это не доказывает точное совпадение всех SSID или долговременную сохранность после power cycle.

Ограничения: только Netis N2 / N2-V4.0.1.4317/CIS, заводской DHCP + Wi-Fi. Нет PPPoE, Static WAN, редактирования Wi-Fi в настроенном состоянии, автоматического повторного SET.

## Установка на iPhone 12 из Windows

1. Откройте PR этой ветки и дождитесь успешной GitHub Actions «RouterLab Mobile iOS», в особенности job «Physical iPhone IPA compile».
2. Скачайте из Artifacts «RouterLabMobile-iPhone-UNSIGNED-IPA», распакуйте архив: внутри файл RouterLabMobile-UNSIGNED-device.ipa.
3. На Windows установите IPA через Sideloadly по USB, подписав приложение **собственным** Apple Account. При необходимости включите iOS Developer Mode.
4. Это обычное приложение, не App Clip. Бесплатная подпись может требовать переподписи примерно раз в неделю.

Если CI не подтвердил компиляцию, устанавливаемый IPA не подтверждён. Сборка под Simulator не подходит для физического iPhone. Не передавайте Apple ID и пароли Netis в отчёты.

## Проверки

- python3 mobile/scripts/validate_project.py — структура Xcode и ресурсы JS.
- python3 -m unittest discover -s mobile/tests -v — тесты панели на мок-сервере.
- xcodebuild с iPhoneOS и CODE_SIGNING_ALLOWED=NO — компиляция.
- На физическом устройстве обязателен отдельный тест реального протокола. CI не является таким тестом.


## Experimental milestone: automatic Netis discovery and proprietary dashboard

The development branch feat/routerlab-ios-netis-discovery-dashboard extends the physically confirmed PR #8 checkpoint WITHOUT altering existing Netis router configuration.

- On app startup, tests a bounded list: last confirmed private address, 192.168.2.1, 192.168.1.1, 192.168.0.1. This is not a LAN scan.
- A candidate is accepted only when the Netis CGI adapter confirms N2, firmware N2-V4.0.1.4317/CIS in base and guide. An HTTP response or a TP-Link webpage alone never qualifies.
- Unsupported IPs/timeouts advance to the next candidate; manual private IPv4 entry remains available.
- Native SwiftUI hides the WebView while searching. After confirmation, a full-screen RouterLab Shadow DOM UI completely overlays the stock page.
- RouterLab dashboard uses actual WAN/Wi-Fi/IGMP readback. Its buttons for modifying a CONFIGURED router clearly indicate that the write contract is not verified yet, and perform **no write**.
- The existing FACTORY one-shot DHCP/Wi-Fi apply and manual reconnect procedure are preserved.
- An already installed app can be opened via the IP-free custom URL scheme routerlab://discover. This does not make it a public HTTPS Universal Link or remove the need to install the app.

**Physical test required:** Install the new branch's IPA on iPhone 12 and verify that it discovers the Netis at 192.168.2.1, does not mistake the upstream TP-Link at 192.168.0.1 for the Netis, and displays the real configured dashboard. No router reset or change is required.

**Next separate hardware research:** capture a controlled stock UI HAR of editing SSID/password in CONFIGURED state (credentials redacted) to establish the exact Netis FW4 write contract. Until this is evidenced and verified, the app cannot safely offer configured-state Wi-Fi changes.

Do not interpret a passing browser mock or iOS build as physical validation.

## CONFIGURED-state login (separate development checkpoint)

When real Netis CGI identifies N2-V4.0.1.4317/CIS in CONFIGURED state, RouterLab now shows a dedicated administrator password form instead of opening the management dashboard based on publicly readable WAN/WLAN data.

- Submits the confirmed `POST /cgi-bin/login.cgi` password field using the existing Netis adapter (Base64 per recorded HAR, not encryption).
- Opens the management dashboard only when the router explicitly returns `["SUCCESS"]` and subsequent configured readback completes successfully.
- On a rejected/locked/failed login, keeps the auth form and a clear error. It does NOT call general readback to conceal login failure.
- Password is cleared from the form after the attempt and never included in diagnostics or GitHub results.
- A local `Закрыть управление` action locks only the RouterLab UI; it does **not** invalidate Netis stock cookies.
- Existing factory first-setup and manual reconnect still work; after reconnect in CONFIGURED state, login is required before final readback and clearing the one-shot attempt marker.
- Browser mocks cover correct Base64 input, successful login, rejected password, failed configured reads, and UI lock. This is **not** a physical iPhone login success claim.

**Hardware validation:** On iPhone 12 connected to the Netis at 192.168.2.1, open RouterLab, enter the actual admin password, verify the real dashboard. If rejected, record only the diagnostic status/error code, never the password. Do not reset or change any router settings for this test.

## Dual-model iOS pilot: Netis N2 + TP-Link Archer C20 v5

This development branch extends the **same installed RouterLab app** and experimental App Clip target. The app does not simultaneously join two Wi-Fi networks: it detects the router reachable on the **currently connected** Wi-Fi, and can be retested after manually switching SSIDs in iOS Settings.

- The current Wi-Fi `en0` IPv4 /24-derived `.1` address is checked first, followed by the last verified address and a bounded list of common private addresses. This is a heuristic, **not** the actual discovered gateway and not a LAN port sweep.
- **Netis N2 / N2-V4.0.1.4317/CIS:** original physically tested same-origin CGI adapter, configured login, WAN/2.4/5 GHz/IGMP readback, and existing opt-in factory setup. No changed Netis write code.
- **TP-Link Archer C20 v5 / 200821:** a separate **read-only** same-origin probe. It requires the stock page's Archer C20 identity plus successful `POST /cgi/getGDPRParm` (RSA/sequence parameters) before becoming a candidate. The stock firmware revision remains **UNVERIFIED** until separately established; no firmware compatibility claim or write action is made on this basis alone.
- C20 configured login uses the firmware's **own login form** after explicit user input, never an invented encrypted packet. The first-party stock code performs RSA/AES and cookie/session management. Exactly one stock login button click is triggered per explicit attempt.
- C20 dashboard appears only on successful **protected stock `LAN_WLAN` read** of two distinct 2.4/5 GHz entries with valid vendor stacks; the WAN read is optional and does not falsely claim a working Internet path.
- C20 login rejections, protected-read uncertainty and stock lockouts cannot be silently promoted to login success. Never automatically resend credentials. No C20 Wi-Fi/WAN SET, Quick Setup, password change or reset is implemented.
- Both adapter panels live on their own origin and have separate identity gates. C20 must not be mistaken for the upstream Netis or vice versa.

### iPhone physical test

1. Keep the already-working Netis configuration unchanged. Install the **full-app** unsigned iPhone IPA from the successful GitHub Actions run through Sideloadly as before. No App Clip/QR setup is required for this test.
2. Connect iPhone to **Netis** Wi-Fi, open RouterLab, verify that Netis discovery, login and WAN/Wi-Fi/IGMP readback still work.
3. In iPhone Wi-Fi Settings switch to the **TP-Link Archer C20 v5** SSID, return to RouterLab and tap **Обновить** or restart app. If detection fails, provide its actual local gateway in the manual address field. The existing test network uses `192.168.0.1`, but do **not** assume this is true for every TP-Link.
4. Expected: `TP-Link Archer C20` with an explicit firmware-unverified note, password form if stock login is visible, one user-triggered login attempt, then both real SSIDs and a WAN result if available.
5. Record only safe status phrases and whether both SSIDs match the live settings. Do **not** share the TP-Link password, cookies, CGI bodies or session tokens. If stock login does not work in WKWebView, capture only sanitized diagnostics and stop; the preceding Chrome extension had unresolved session issues.

**Verification boundary:** Passing Chromium mocks and iOS builds means the model-specific UI and packaging work. It does **not** establish a successful TP-Link physical login/readback. Netis hardware success is not transferable proof.

### TP-Link stock login reload regression (iPhone 12)

A real Archer C20 test showed that after signing in through the first-party page the app unexpectedly displayed the **initial RouterLab password prompt again**. The original code instantiated a new overlay on every top-level navigation, forgot the previous login intent, and the native WebView controller ignored non-discovery navigations. The result did **not** establish whether the password was accepted by the firmware.

The fix retains a **15-minute, origin-scoped, non-secret sessionStorage marker** that says *stock login is being tested*. After the router navigates/reloads, the next C20 adapter instance stays hidden, leaving the genuine stock TP-Link interface in view and displaying only the bottom **Проверить RouterLab после штатного входа** action. The user manually triggers read-only protected `LAN_WLAN` verification; no password is resent. If the fresh `getGDPRParm` preflight becomes unavailable after stock login, a previously verified C20 origin can restore the diagnostic UI, without marking the session verified.

The existing **Диагностика RouterLab · журнал событий** section now holds bounded, fixed-format status events in same-origin sessionStorage across page transitions. Native SwiftUI also provides **Журнал навигации и авторизации · TP-Link**, including `C20_NAV_START`, `C20_NAV_STOCK_PAGE_FINISHED` and bridge events. Only event codes and timestamps are logged — never passwords, SSIDs, cookies, tokens, CGI bodies, credentials or query-string URLs. The log is intended to be safe to screenshot; avoid screenshots of the stock page with credentials.

**iPhone recheck:** install the new full-app IPA (not App Clip), connect to Archer C20 Wi-Fi, press **Открыть штатный вход TP-Link**, sign in exactly once via the router's original form, and observe the genuine page. If it navigates, the app should not automatically return to the RouterLab password field. Tap the floating bottom button to check the protected configuration once; if the dashboard fails, expand **Диагностика RouterLab** and share only the event codes and the **native navigation journal**. Do not reset the C20 or retry passwords repeatedly.

**Still not proven:** first-party login success on actual hardware, preservation of session cookies in WKWebView, whether `LAN_WLAN` returns dynamic stacks on this particular firmware, and the stock page's real post-login destination. A successful Chromium fixture test is not hardware validation.

### Reopened C20 app unexpectedly asks for password (physical 08:55 test)

Physical diagnostics showed a first login with `SESSION_READBACK_VERIFIED` at 08:46:35 and a second fresh `LOGIN_FORM_READY` at 08:55:27. This **does not prove** that the TP-Link admin session expired: the former C20 `check()` deliberately displayed the password UI whenever a stock login form was visible, without attempting any authorized-session read. It was therefore impossible to distinguish router cookie/session expiry from overzealous RouterLab UI gating.

The read-only iOS pilot now offers **Проверить текущую сессию без пароля**. It only requests vendor `LAN_WLAN`/optional `WAN_IP_CONN` data; it never resubmits or guesses a password. A successful read produces `CONFIG_READBACK_OK_AUTH_NOT_PROVEN` rather than `SESSION_READBACK_VERIFIED`, because **some firmware might expose a read API before authentication**. This is specifically tested with a deliberately public mock read. A failed read keeps the panel locked and logs `READ_FAILED_WLAN_PROTECTED_READ_UNCONFIRMED` or the underlying vendor error. The user can then choose the genuine stock-login path. A stronger independent session proof remains open work.

For the next real C20 run, tap the no-password read button **before** signing in; compare logs and dashboard, then use the stock login only if needed. Do not send passwords, cookie values, SSIDs or raw CGI response bodies in diagnostic reports.
