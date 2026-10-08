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
.card{width:min(620px,100%);background:white;border:1px solid #e5e5e5;border-radius:20px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.07)}
.brand{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#666}
h1{font-size:30px;line-height:1.15;margin:10px 0 12px}.lead{font-size:17px;line-height:1.5;color:#555;margin:0 0 22px}
.step{display:flex;gap:12px;padding:14px 0;border-top:1px solid #eee}.num{width:28px;height:28px;border-radius:50%;background:#f0f0f2;display:grid;place-items:center;font-weight:700;flex:0 0 auto}
.step b{display:block;margin-bottom:3px}.step span{color:#666;font-size:14px;line-height:1.4}
button{width:100%;border:0;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:700;cursor:pointer;background:#111;color:white;margin-top:20px}
button:disabled{opacity:.45;cursor:not-allowed}.status{display:none;margin-top:20px;border-radius:14px;padding:16px;background:#f7f7f8}
.status.show{display:block}.row{display:flex;justify-content:space-between;gap:18px;padding:7px 0;border-bottom:1px solid #e8e8ea}.row:last-child{border-bottom:0}.k{color:#666}.v{font-weight:650;text-align:right}
.ok{color:#147a38}.warn{color:#9a5b00}.err{color:#b42318}.small{font-size:13px;color:#777;margin-top:14px}
</style>
</head>
<body>
<main class="card">
  <div class="brand">RouterLab</div>
  <h1>Быстрая настройка интернета</h1>
  <p class="lead">Сначала подключитесь к Wi‑Fi вашего роутера. Название сети обычно указано на наклейке снизу устройства.</p>

  <div class="step"><div class="num">1</div><div><b>Откройте настройки Wi‑Fi</b><span>На телефоне, планшете или компьютере выберите сеть вашего роутера Cudy.</span></div></div>
  <div class="step"><div class="num">2</div><div><b>Вернитесь на эту страницу</b><span>После подключения нажмите кнопку ниже. RouterLab проверит локальную сеть.</span></div></div>

  <button id="detect">Я подключился к роутеру</button>

  <section id="status" class="status">
    <div id="headline" style="font-weight:800;font-size:18px;margin-bottom:10px">Проверяем локальную сеть…</div>
    <div id="rows"></div>
  </section>

  <button id="quick" disabled style="display:none">Быстрая настройка</button>
  <div class="small">Этап 1 стенда: обнаружение устройства и состояния. Настройка будет подключена после PASS этого этапа.</div>
</main>
<script>
const detect = document.querySelector('#detect');
const quick = document.querySelector('#quick');
const status = document.querySelector('#status');
const headline = document.querySelector('#headline');
const rows = document.querySelector('#rows');

function esc(x){return String(x ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function row(k,v,cls=''){return '<div class="row"><div class="k">'+esc(k)+'</div><div class="v '+cls+'">'+esc(v)+'</div></div>'}

detect.addEventListener('click', async () => {
  detect.disabled = true;
  status.classList.add('show');
  quick.style.display = 'none';
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

    if (d.wizard === '1') {
      quick.style.display = 'block';
      quick.disabled = true;
      quick.textContent = 'Быстрая настройка — следующий этап';
    }
  } catch (e) {
    headline.textContent = 'Роутер не обнаружен';
    rows.innerHTML = row('Ошибка', e.message, 'err');
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
                headers={"User-Agent": "RouterLab-WebDemo/0.1"},
            )
            with urllib.request.urlopen(req, timeout=3) as r:
                return 200 <= r.status < 400
        except (urllib.error.URLError, TimeoutError):
            return False

    def detect(self) -> dict:
        wizard = self.uci("luci.main.wizard")
        if wizard is None:
            return {
                "detected": False,
                "error": "Cudy lab runtime is not available",
            }
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
        def send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/" or self.path.startswith("/?"):
                self.send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
                return
            if self.path == "/api/health":
                body = json.dumps({"ok": True, "mode": "LAB"}).encode()
                self.send(200, body, "application/json")
                return
            if self.path == "/api/detect":
                try:
                    data = lab.detect()
                    status = 200 if data.get("detected") else 503
                except Exception as e:
                    data = {"detected": False, "error": f"{type(e).__name__}: {e}"}
                    status = 500
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self.send(status, body, "application/json; charset=utf-8")
                return
            self.send(404, b"not found", "text/plain; charset=utf-8")

        def log_message(self, fmt: str, *args) -> None:
            print(f"[web] {self.address_string()} {fmt % args}")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("RouterLab Web Demo — stage 1")
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
