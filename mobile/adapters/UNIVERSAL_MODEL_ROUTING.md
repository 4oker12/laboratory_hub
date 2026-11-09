# RouterLab: общий реестр и ручной выбор модели

**Назначение.** IP — только адрес подключения. Модель определяется пассивно; при отсутствии достоверных признаков пользователь выбирает её в выпадающем списке. Это назначает **маршрут адаптера**, но не подтверждает модель, версию ПО или авторизацию.

## Где теперь править

| Что менять | Один основной файл |
| --- | --- |
| Добавить модель / название / регулярное выражение | `mobile/RouterLabMobile/Resources/RouterLabDeviceRegistry.js` → `PROFILES` |
| Правила прошивки, семейство API, ключ адаптера, допустимые состояния | `mobile/RouterLabMobile/Resources/RouterLabAdapterHub.js` → `RULES` |
| Как C54 узнаёт модель и состояние штатной страницы (пока только чтение) | `mobile/RouterLabMobile/Resources/RouterLabC54Driver.js` |
| Вид универсальной панели RouterLab | `mobile/RouterLabMobile/Resources/RouterLabUniversalPanel.js` |
| Кнопки, выпадающий список, проверка локального IP | `mobile/RouterLabMobile/ContentView.swift` и `RouterSession.swift` |
| Готовый C20 v5 | `RouterLabC20Panel.js`, `RouterLabC20Setup.js` |
| Готовый Netis N2 FW4 | `RouterLabNetisFW4.js`, `RouterLabNetisPanel.js` |

**Важно:** список для iPhone передаётся в Swift из `RouterLabDeviceRegistry.PROFILES` сообщением `routerModelCatalog`. В Swift остаётся стартовый список из шести известных моделей, если страница роутера недоступна и каталог не может загрузиться. Программа проверяет вручную выбранный профиль по этому списку и разрешает **только** локальный IPv4. Выбор неверной модели не открывает CGI SET.

## Состояния

`INIT → IDENTIFIED_AUTO / IDENTIFIED_MANUAL → FIRMWARE_CHECK → FIRST_CONNECT / LOGIN_REQUIRED → AUTHENTICATED → QUICK_SETUP / WIFI_EDITOR → SAVE_PENDING → VERIFY_PENDING → READBACK_VERIFIED`.

Выбор вручную начинает с `IDENTIFIED_MANUAL`, не с `AUTHENTICATED`. `AdapterHub.canCall()` запрещает несуществующий метод, несоответствующую ревизию, неподтверждённую сессию и непроверенный контракт записи. `readback` не подтверждается одним HTTP 200.

## Пример C54

1. Открыть локальную страницу C54; если автоматическое распознавание не сработало, выбрать **TP-Link Archer C54**.
2. RouterLab назначает адаптер `tplink-c54-v1` и протокол-кандидат `TPLINK_SU_VXWORKS`. Появляется универсальный UI.
3. Пассивный драйвер ищет признаки страницы C54 и `$.su`, распознаёт возможный первый пароль, вход или мастер.
4. Пока на реальном C54 EU V1 не подтверждены crypto/login, WAN/WLAN GET/SET и повторное чтение, **изменения заблокированы**. Можно открыть штатный интерфейс и собрать технический отчёт без секретов.

Это намеренная, проверяемая граница: механизм выбора модели **готов**, но нельзя выдавать библиотеку заглушек за рабочую авторизацию.

## Как добавить полностью рабочую модель

1. Добавить одну запись в `PROFILES`.
2. Добавить правила совместимости в `AdapterHub.RULES`.
3. Создать драйвер со строгим контрактом `probe`, `getSetupState`, `createAdminPassword`, `login`, `verifySession`, `readWan`, `setWanDhcp`, `readWifi`, `setWifi`, `save`, `verifyChanges`.
4. Проверить точную версию прошивки и HTTP-контракт на тестовом железе; отдельно протестировать пароль первого входа и повторного входа.
5. Зарегистрировать драйвер и добавить в Xcode ресурсы; сначала тесты без записи, затем **однократную** запись с подтверждением и read-after-write.

Из-за различий между прошивками C20/C54/Netis/Cudy запрещается копировать криптографию, cookie, CGI-поля или GET/SET маршруты без фактической проверки. При неожиданном ответе драйвер обязан завершить сценарий, показать причину и предложить штатный вход, но не повторять запись вслепую.

## Автотесты

- `node mobile/tests/universal-registry.test.cjs`
- `node mobile/tests/manual-adapter-hub.test.cjs`
- `python3 -m unittest discover -s mobile/tests -v`

GitHub Actions: `RouterLab Mobile iOS`. IPA из артефакта `RouterLabMobile-iPhone-UNSIGNED-IPA` не подписана и требует установки через личную подпись Apple.
