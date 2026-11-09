# RouterLab AX23(EU) V1 — local original stock preview

This launcher executes the **real** TP-Link AX23(EU) V1 stock MIPS `ubusd`, `uhttpd` and `/cgi-bin/luci` from official firmware 1.1.3 Build 20250905 under QEMU-user. It is **not** a simulated HTTP backend. The local viewer enables an explicitly labelled, UI-only fallback for one stock JavaScript navigation error; see below.

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

The initial administrator wizard has updated `accountmgnt` in CI. The original browser issued a real encrypted POST `form=login`, but the stock main bootstrap `/admin/firmware?form=upgrade` returned HTTP 500 because this isolated firmware rootfs lacks some router runtime dependencies. Stock `main/main.js` reacts to that failure by routing back to `login`. **An HTTP 200, a displayed panel, or a stored token is not proof of authenticated WAN/Wi-Fi read/write or actual routing.**

If WSL2 does not permit network namespace or MIPS `binfmt_misc`, the launcher will fail closed and print the blocker. It will **never** expose an unprotected stock admin page on 0.0.0.0 or change any physical router.

For evidence, see `EVIDENCE.md`, `HANDOFF.md` and PR #19.

## Verified localhost-preview milestone — 2026-11-06

[GitHub Actions run 42172173728](https://github.com/4oker12/laboratory_hub/actions/runs/42172173728) completed successfully: the local launcher used the checked official stock firmware, started original MIPS `ubusd` + `uhttpd` inside a dedicated Linux network namespace and served original byte-identical HTML through a loopback-only port bridge. The `check_factory_default&operation=read` genuine CGI callback returned valid success JSON. The formerly failing CGI HTTP 403 was traced to extraction under host `umask 077`, which masked the original CGI execute permissions; extraction now uses a scoped `umask 022` and restores vendor runtime permissions on old cached guests, **without broadening host cache permissions or modifying accountmgnt**.

**CI proof is Linux Ubuntu, not a claim that WSL2 or Windows Chrome has been physically tested.** Physical router, normal authenticated login, Quick Setup and WAN/Wi-Fi writes are separate gates.

## 2026-11-09: WSL session lifetime and optional UI-only bootstrap fallback

**WSL incident:** On the physical Windows PC, original LuCI reached `RUNNING` but
the detached localhost bridge `socat` received `SIGHUP` and exited with code
129 about 16 seconds after launch. This is a lifecycle bug, not a reason to
reflash or reset the virtual account. `run-local.sh start` now launches both
the isolated namespace and localhost bridge via `sudo nohup setsid -f` with
stdin/stdout/stderr detached, while keeping the network namespace isolated
and listener bound to 127.0.0.1. Linux CI tests a simulated caller pseudo-TTY
closure; actual WSL persistence still needs a fresh physical test.

**UI exploration (default):** `ROUTERLAB_AX23_UI_PREVIEW=1` patches **only**
`guest-rootfs/www/webpages/modules/main/main.js`: after the **original**
`firmwareProxy` bootstrap fails, load the **original** stock `index` module
rather than returning immediately to `login`. The verified stock-rootfs,
original backend handlers, actual login/AES/RSA client code and account
configuration are not changed; no API success or hardware state is faked.
This is an explicitly **non-byte-identical UI navigation fallback**, not a
fix to the missing firmware metadata handler and not proof of a working
authenticated session. If another protected API fails, the genuine error
must remain visible.

To restore the strictly unmodified frontend JS for comparison:

```bash
ROUTERLAB_AX23_UI_PREVIEW=0 bash ~/routerlab-ax23/devices/tplink/archer-ax23-v1-eu/run-local.sh start
```

Stop the guest before switching modes. Neither mode changes any physical
TP-Link device. The stock vendor files are never committed; only the small
patch tool and evidence are tracked.
