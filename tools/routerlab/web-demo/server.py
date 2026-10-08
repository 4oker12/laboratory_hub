#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HTML = r"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RouterLab — Быстрая настройка</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f5f5f7}
*{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}
.card{width:min(640px,100%);background:white;border:1px solid #e5e5e5;border-radius:20px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.07)}
.brand{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#666}
h1{font-size:30px;line-height:1.15;margin:10px 0 12px}.lead{font-size:17px;line-height:1.5;color:#555;margin:0 0 22px}
.step{display:flex;gap:12px;padding:14px 0;border-top:1px solid #eee}.num{width:28px;height:28px;border-radius:50%;background:#f0f0f2;display:grid;place-items:center;font-weight:700;flex:0 0 auto}
.step b{display:block;margin-bottom:3px}.step span{color:#666;font-size:14px;line-height:1.4}
button{width:100%;border:0;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:700;cursor:pointer;background:#111;color:white;margin-top:20px}
button:disabled{opacity:.45;cursor:not-allowed}.status{display:none;margin-top:20px;border-radius:14px;padding:16px;background:#f7f7f8}
.status.show{display:block}.row{display:flex;justify-content:space-between;gap:18px;padding:7px 0;border-bottom:1px solid #e8e8ea}.row:last-child{border-bottom:0}.k{color:#666}.v{font-weight:650;text-align:right}
.ok{color:#147a38}.warn{color:#9a5b00}.err{color:#b42318}.small{font-size:13px;color:#777;margin-top:14px}
.progress{display:none;margin-top:16px}.progress.show{display:block}.pitem{padding:7px 0;color:#666}.pitem.ok{color:#147a38;font-weight:650}
</style>
</head>
<body>
<main class="card">
  <div class="brand">RouterLab</div>
  <h1>Быстрая настройка интернета</h1>
  <p class="lead">Подключитесь к Wi‑Fi вашего роутера, вернитесь на эту страницу и запустите проверку.</p>

  <div class="step"><div class="num">1</div><div><b>Подключитесь к Wi‑Fi роутера</b><span>Выберите сеть Cudy на телефоне, планшете или компьютере.</span></div></div>
  <div class="step"><div class="num">2</div><div><b>Найдите устройство</b><span>RouterLab проверит состояние локального роутера.</span></div></div>
  <div class="step"><div class="num">3</div><div><b>Запустите быструю настройку</b><span>Stock Cudy выполнит admin → Router mode → DHCP → Wi‑Fi → Save & Apply.</span></div></div>

  <button id="detect">Я подключился к роутеру</button>

  <section id="status" class="status">
    <div id="headline" style="font-weight:800;font-size:18px;margin-bottom:10px">Проверяем локальную сеть…</div>
    <div id="rows"></div>
  </section>

  <button id="quick" disabled style="display:none">Быстрая настройка</button>
  <section id="progress" class="progress"></section>
  <div class="small">LAB mode: браузер управляет эмулированным stock Cudy через локальный RouterLab bridge. Финальный wizard=0 делает stock qsetup.apply(); bridge подавляет только физическое применение сервисов.</div>
</main>
<script>
const detect = document.querySelector('#detect');
const quick = document.querySelector('#quick');
const status = document.querySelector('#status');
const headline = document.querySelector('#headline');
const rows = document.querySelector('#rows');
const progress = document.querySelector('#progress');

function esc(x){return String(x ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function row(k,v,cls=''){return '<div class="row"><div class="k">'+esc(k)+'</div><div class="v '+cls+'">'+esc(v)+'</div></div>'}
function p(text,ok=false){return '<div class="pitem '+(ok?'ok':'')+'">'+(ok?'✓ ':'• ')+esc(text)+'</div>'}

async function detectRouter() {
  detect.disabled = true;
  status.classList.add('show');
  quick.style.display = 'none';
  progress.classList.remove('show');
  headline.textContent = 'Проверяем локальную сеть…';
  rows.innerHTML = row('Статус','поиск…');

  try {
    const r = await fetch('/api/detect', {cache:'no-store'});
    const d = await r.json();
    if (!r.ok || !d.detected) throw new Error(d.error || 'Роутер не обнаружен');

    headline.textContent = d.wizard === '1'
      ? 'Cudy WR1200 обнаружен'
      : 'Cudy WR1200 уже настроен';

    rows.innerHTML =
      row('Роутер', d.vendor + ' ' + d.model, 'ok') +
      row('Firmware', d.firmware) +
      row('Stock LuCI', d.stock_http ? 'доступен' : 'не отвечает', d.stock_http ? 'ok' : 'err') +
      row('Состояние', d.wizard === '1' ? 'первичная настройка' : 'настроен', d.wizard === '1' ? 'warn' : 'ok') +
      row('WAN', (d.wan_proto || 'не задан').toUpperCase()) +
      row('Wi‑Fi 2.4 ГГц', d.ssid_2g || 'не задан') +
      row('Wi‑Fi 5 ГГц', d.ssid_5g || 'не задан');

    quick.style.display = 'block';
    if (d.wizard === '1') {
      quick.disabled = false;
      quick.textContent = 'Быстрая настройка';
    } else {
      quick.disabled = true;
      quick.textContent = 'Роутер уже настроен';
    }
  } catch (e) {
    headline.textContent = 'Роутер не обнаружен';
    rows.innerHTML = row('Ошибка', e.message, 'err');
  } finally {
    detect.disabled = false;
  }
}

detect.addEventListener('click', detectRouter);

quick.addEventListener('click', async () => {
  quick.disabled = true;
  detect.disabled = true;
  progress.classList.add('show');
  progress.innerHTML =
    p('Создание пароля администратора') +
    p('Режим Router') +
    p('WAN: DHCP') +
    p('Настройка Wi‑Fi') +
    p('Stock Save & Apply') +
    p('Проверка результата');
  headline.textContent = 'Выполняется быстрая настройка…';

  try {
    const r = await fetch('/api/quick-setup', {method:'POST', cache:'no-store'});
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'Настройка не завершена');

    progress.innerHTML =
      p('Пароль администратора создан', true) +
      p('Режим Router применён', true) +
      p('WAN настроен на DHCP', true) +
      p('Wi‑Fi сохранён', true) +
      p('Stock qsetup.apply() выполнен', true) +
      p('wizard = 0 подтверждён', true);

    headline.textContent = 'Роутер настроен';
    rows.innerHTML =
      row('Состояние','настроен','ok') +
      row('Wizard', d.wizard, d.wizard === '0' ? 'ok' : 'err') +
      row('WAN', (d.wan_proto || '').toUpperCase(), d.wan_proto === 'dhcp' ? 'ok' : 'err') +
      row('Wi‑Fi 2.4 ГГц', d.ssid_2g || 'не задан') +
      row('Wi‑Fi 5 ГГц', d.ssid_5g || 'не задан');
    quick.style.display = 'none';
  } catch (e) {
    headline.textContent = 'Настройка остановлена';
    progress.innerHTML += p('Ошибка: ' + e.message);
    quick.disabled = false;
  } finally {
    detect.disabled = false;
  }
});
</script>
</body>
</html>
"""


class Lab:
    def __init__(self, runtime: Path, router_base: str, qemu: str) -> None:
        self.runtime = runtime
        self.router_base = router_base.rstrip("/")
        self.qemu = qemu
        self.quick_setup_script = Path(__file__).resolve().with_name("cudy-quick-setup.sh")

    def uci(self, key: str) -> str | None:
        if not self.runtime.is_dir():
            return None
        cmd = [
            "proot", "-0", "-r", str(self.runtime),
            "-b", "/proc", "-b", "/dev",
            "-b", f"{self.runtime / 'tmp'}:/var",
            "-w", "/", "-q", self.qemu,
            "/sbin/uci", "-q", "get", key,
        ]
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=5)
        if p.returncode != 0:
            return None
        value = p.stdout.strip()
        return value or None

    def stock_http(self) -> bool:
        try:
            req = urllib.request.Request(
                self.router_base + "/cgi-bin/luci",
                headers={"User-Agent": "RouterLab-WebDemo/0.2"},
            )
            with urllib.request.urlopen(req, timeout=3) as r:
                return 200 <= r.status < 400
        except urllib.error.HTTPError as e:
            return e.code in (401, 403)
        except (urllib.error.URLError, TimeoutError):
            return False

    def detect(self) -> dict:
        wizard = self.uci("luci.main.wizard")
        if wizard is None:
            return {"detected": False, "error": "Cudy lab runtime is not available"}
        return {
            "detected": True,
            "vendor": "Cudy",
            "model": "WR1200 V2/R26",
            "firmware": "2.4.23",
            "wizard": wizard,
            "defpasswd": self.uci("luci.sauth.defpasswd"),
            "wan_proto": self.uci("network.wan.proto"),
            "ssid_2g": self.uci("wireless.wlan00.ssid"),
            "ssid_5g": self.uci("wireless.wlan10.ssid"),
            "stock_http": self.stock_http(),
            "mode": "LAB",
        }

    def quick_setup(self) -> dict:
        if not self.quick_setup_script.is_file():
            return {"ok": False, "error": "quick-setup adapter is missing"}

        env = {
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": str(Path.home()),
            "ROUTERLAB_CUDY_RUNTIME": str(self.runtime),
            "ROUTERLAB_CUDY_PORT": self.router_base.rsplit(":", 1)[-1],
            "QEMU_MIPSEL": self.qemu,
        }
        try:
            p = subprocess.run(
                ["bash", str(self.quick_setup_script)],
                text=True,
                capture_output=True,
                timeout=90,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "quick setup timed out"}

        log = (p.stdout + "\n" + p.stderr).strip()
        if p.returncode != 0:
            tail = " | ".join(log.splitlines()[-8:])
            return {
                "ok": False,
                "error": f"stock setup failed (rc={p.returncode}): {tail}",
            }

        state = self.detect()
        ok = (
            state.get("wizard") == "0"
            and state.get("defpasswd") == "0"
            and state.get("wan_proto") == "dhcp"
        )
        return {
            "ok": ok,
            "wizard": state.get("wizard"),
            "defpasswd": state.get("defpasswd"),
            "wan_proto": state.get("wan_proto"),
            "ssid_2g": state.get("ssid_2g"),
            "ssid_5g": state.get("ssid_5g"),
            "steps": [line for line in p.stdout.splitlines() if line.startswith("STEP ")],
            "error": None if ok else "post-setup verification failed",
        }


def local_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("1.1.1.1", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runtime", default=str(Path.home() / "cudy-wr1200-browser-lab/runtime"))
    ap.add_argument("--router-base", default="http://127.0.0.1:18093")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=19080)
    ap.add_argument("--qemu", default="/usr/bin/qemu-mipsel-static")
    args = ap.parse_args()

    lab = Lab(Path(args.runtime).expanduser(), args.router_base, args.qemu)

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status: int, data: dict) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def send_bytes(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/" or self.path.startswith("/?"):
                self.send_bytes(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
                return
            if self.path == "/api/health":
                self.send_json(200, {"ok": True, "mode": "LAB"})
                return
            if self.path == "/api/detect":
                try:
                    data = lab.detect()
                    self.send_json(200 if data.get("detected") else 503, data)
                except Exception as e:
                    self.send_json(500, {"detected": False, "error": f"{type(e).__name__}: {e}"})
                return
            self.send_bytes(404, b"not found", "text/plain; charset=utf-8")

        def do_POST(self) -> None:
            if self.path == "/api/quick-setup":
                try:
                    data = lab.quick_setup()
                    self.send_json(200 if data.get("ok") else 500, data)
                except Exception as e:
                    self.send_json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
                return
            self.send_bytes(404, b"not found", "text/plain; charset=utf-8")

        def log_message(self, fmt: str, *args) -> None:
            print(f"[web] {self.address_string()} {fmt % args}")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("RouterLab Web Demo — stage 2")
    print(f"PC:    http://127.0.0.1:{args.port}")
    ip = local_ip()
    if ip:
        print(f"LAN:   http://{ip}:{args.port}")
    print(f"Cudy:  {args.router_base}")
    print("Stop:  Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
