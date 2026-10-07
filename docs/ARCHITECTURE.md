# Laboratory Hub architecture

Laboratory Hub is an independent router/firmware laboratory. It has no runtime or
source-code dependency on SIMNET Workbench.

## Layout

```text
routerlab.py                     # central dispatcher / device registry
Run-RouterLab.ps1                # Windows -> WSL entry point
devices/
  <vendor>/
    <model>/
      <firmware-variant>/
        device.json              # identity, image authority, capabilities
        virtual-router.sh        # lifecycle for this exact target
        router-client.py         # stock API scenario driver
        compat-frontdoor.py      # target-scoped transport compatibility
        runtime-shims/           # only evidenced missing runtime facts
tests/
.github/workflows/
images/                          # local vendor images/rootfs; gitignored
```

A model can have several firmware leaves. A vendor can have several models. The root
dispatcher selects a manifest and delegates; it does not contain Xiaomi-specific
business logic.

## Device contract

Every versioned target owns its exact firmware metadata and implementation. The
manifest names the launcher/client and records capability status. Common commands are
`list`, `info`, lifecycle commands and scenario commands
(`inspect`, `first-run`, `service`, `configure`).

The first-run path represents factory registration/setup. Service/configure represent
normal authenticated management such as WAN and Wi-Fi.

## Images

Vendor firmware binaries and extracted rootfs trees are not committed. Store them in
a local cache or artifact store and verify them against `device.json`. Each target
identifies the exact image by filename/version/hash.

## Compatibility boundary

A compatibility shim is allowed only when stock userspace depends on a kernel, daemon,
MTD/NVRAM fact, transport primitive or package-materialization side effect unavailable
in the lab. Shims stay inside the exact target and must be minimal and evidenced.

The R4A target runs original stock LuCI/Xiaomi management-plane userspace under
qemu-user + PRoot. It does not emulate RF/PHY/switch hardware or a live ISP dataplane.
