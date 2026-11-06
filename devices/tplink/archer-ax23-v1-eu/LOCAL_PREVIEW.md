# RouterLab AX23(EU) V1 — local original stock preview

This launcher runs the **original** TP-Link AX23(EU) V1 management interface from official firmware 1.1.3 Build 20250905. It is **not** a simulated HTML mock. The stock MIPS `ubusd`, `uhttpd` and `/cgi-bin/luci` execute under QEMU-user.

## Windows with WSL2 Ubuntu

Prerequisites: a functioning WSL2 Ubuntu installation, `git`, `sudo`, and Linux kernel support for rootful network namespaces + `binfmt_misc`. **Docker is not required.** From a WSL Ubuntu terminal:

```bash
git clone --depth 1 --branch research/routerlab-archer-ax23-v1-eu-rehost \
  https://github.com/4oker12/laboratory_hub.git ~/routerlab-ax23
bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh start
```

Open **http://127.0.0.1:18023/webpages/index.html** in Windows Chrome. WSL2's localhost forwarding must be active. It is not a public URL and cannot be accessed on an iPhone over the internet.

```bash
bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh status
bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh logs
bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh stop
bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh reset
```

The launcher downloads the **exact official ZIP** and verifies SHA-256 for both ZIP and vendor BIN. It extracts stock SquashFS and keeps a separate writable guest at `~/.cache/routerlab/archer-ax23-v1-eu/guest-rootfs`. It does not run the router's init/network scripts and refuses a host-network fallback. Guest runs in its own Linux network namespace with no default route. A localhost-only `socat` bridge forwards the browser to stock `uhttpd`.

The initial administrator wizard has been observed running and updating `accountmgnt` in CI. **Ordinary login still fails (`success:false`)**, so protected Quick Setup, WAN/Wi-Fi and actual routing are not proven working. A HTTP 200 or a displayed form is not a successful router configuration test.

If WSL2 does not permit network namespace or MIPS `binfmt_misc`, the launcher will fail closed and print the blocker. It will **never** expose an unprotected stock admin page on 0.0.0.0 or change any physical router.

For evidence, see `EVIDENCE.md`, `HANDOFF.md` and PR #19.
