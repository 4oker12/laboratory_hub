# v0.8.1 — state-first login diagnosis (no password retry)

Changes relative to v0.8.0:
- VERIFY_STATE now explains the actual result and **does not direct the user to log into the stock router page**.
- Adds optional button **Проверить состояние входа (без пароля)**, which uses only the stock router's POST /cgi/getBusy (no credentials).
- Parses `isLogined` and `isBusy` as booleans without evaluating arbitrary firmware JavaScript.
- A returned `isLogined=true` is NOT treated as proof that the offscreen context owns a verified session. RouterLab still requires protected Wi-Fi read.
- Preserves current RSA/AES login, rate limit, one login POST, and existing Wi-Fi write implementation.

This version does **not** yet prove the independent login/session problem fixed on physical Archer C20. No blind retries or cookie injection.
