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
