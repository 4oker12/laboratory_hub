#!/usr/bin/env python3
"""Read-only inspection of *official* Cudy WR3000 V1/R31 firmware.

No router traffic is generated. Produces small evidence only; vendor files and
firmware images are never copied into the distributable report.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

FIRMWARE_NAME = "WR3000-R31-2.4.19-20250828-192837-sysupgrade.zip"
SOURCE_URL = "https://www.cudy.com/cdn/shop/files/" + FIRMWARE_NAME + "?v=7456651526085804400"
PATTERNS = {
    "auth": re.compile(r"sysauth|luci_password|luci_username|csrf|\bsalt\b|setpasswd|initial_login", re.I),
    "wizard": re.compile(r"qsetup|quick.?setup|wizard|first.?run|factory|summary", re.I),
    "wan": re.compile(r"wan_ipv4|pppoe|dhcp|network\.wan|proto", re.I),
    "wifi": re.compile(r"wlan00|wlan10|wireless|wifi.getstatus|wifi.get_aplist", re.I),
    "rpc": re.compile(r"/rpc/app|apprpc|ubus|/cgi-bin/luci", re.I),
}
INTERESTING = re.compile(r"luci|qsetup|wizard|wifi|wireless|rpc|network|auth|login|www|uci-defaults", re.I)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def extract_firmware(image: Path, target: Path) -> dict:
    """Locate a true SquashFS superblock, report container clues, and extract if possible."""
    target.mkdir(parents=True, exist_ok=True)
    data = image.read_bytes()
    sigs = {
        "squashfs_little": b"hsqs",
        "squashfs_big": b"sqsh",
        "FIT_or_DTB": bytes.fromhex("d00dfeed"),
        "uimage": bytes.fromhex("27051956"),
        "UBI": b"UBI#",
        "gzip": bytes.fromhex("1f8b08"),
        "zstd": bytes.fromhex("28b52ffd"),
        "xz": bytes.fromhex("fd377a585a00"),
    }
    signatures = []
    for kind, magic in sigs.items():
        pos = 0
        for _ in range(8):
            pos = data.find(magic, pos)
            if pos < 0:
                break
            signatures.append({"kind": kind, "offset": pos})
            pos += len(magic)
    signatures.sort(key=lambda s: s["offset"])
    report = {
        "status": "squashfs_not_extracted",
        "image_first_32_bytes_hex": data[:32].hex(),
        "signatures": signatures[:45],
        "squashfs_candidates": [],
        "errors": [],
    }
    for hit in signatures:
        if not hit["kind"].startswith("squashfs") or hit["offset"] + 96 > len(data):
            continue
        pos = hit["offset"]
        order = "little" if hit["kind"] == "squashfs_little" else "big"
        read = lambda start, count: int.from_bytes(data[pos+start:pos+start+count], order)
        block_size, major, minor, used = read(12,4), read(28,2), read(30,2), read(40,8)
        plausible = major == 4 and minor in (0,1) and 4096 <= block_size <= 1048576 and (block_size & (block_size-1)) == 0 and 96 < used <= (len(data)-pos)
        report["squashfs_candidates"].append({"offset": pos, "major":major,"minor":minor,"block_size":block_size,"bytes_used":used,"plausible":plausible})
        if not plausible:
            continue
        if not shutil.which("unsquashfs"):
            report["status"] = "unsquashfs_missing"
            return report
        for mode in ("offset", "sliced"):
            command = ["unsquashfs", "-f", "-d", str(target)]
            if mode == "offset":
                command += ["-o", str(pos), str(image)]
            else:
                with tempfile.NamedTemporaryFile(suffix=".squashfs") as f:
                    f.write(data[pos:pos+used])
                    f.flush()
                    command.append(f.name)
                    try:
                        p = subprocess.run(command, capture_output=True, text=True, timeout=150)
                    except (subprocess.TimeoutExpired, OSError) as exc:
                        report["errors"].append(str(exc)[:150])
                        continue
            if mode == "offset":
                try:
                    p = subprocess.run(command, capture_output=True, text=True, timeout=150)
                except (subprocess.TimeoutExpired, OSError) as exc:
                    report["errors"].append(str(exc)[:150])
                    continue
            regular_files_present = ((target / "usr/lib/lua/luci").is_dir()
                                     and (target / "etc").is_dir()
                                     and len(list(target.rglob("*"))) > 300)
            device_only_error = ("could not create character device" in p.stderr
                                 and "because you're not superuser" in p.stderr)
            if p.returncode == 0 or (regular_files_present and device_only_error):
                report.update(status="extracted", offset=pos, method=mode,
                              device_nodes_skipped=bool(p.returncode))
                return report
            report["errors"].append((mode + ": " + p.stderr.strip().replace("\n"," "))[-300:])
    return report

def inspect_rootfs(rootfs: Path) -> dict:
    files = [p for p in rootfs.rglob('*') if p.is_file() and not p.is_symlink()]
    matches = []
    for p in files:
        rel = p.relative_to(rootfs).as_posix()
        if not INTERESTING.search(rel) or p.stat().st_size > 3_000_000:
            continue
        raw = p.read_bytes()
        strings = re.findall(rb'[\x20-\x7e]{5,}', raw)
        categories = set()
        snippets = []
        for line in strings:
            value = line.decode('ascii', 'replace')
            for name, regex in PATTERNS.items():
                if regex.search(value):
                    categories.add(name)
                    for m in list(regex.finditer(value))[:3]:
                        snippets.append(m.group(0).lower())
        if categories:
            matches.append({"path": rel, "size": p.stat().st_size,
                            "categories": sorted(categories), "markers": sorted(set(snippets))[:20]})
    matches.sort(key=lambda x: (-len(x['categories']), x['path']))
    return {"file_count": len(files), "matches": matches[:180],
            "top_level": sorted(p.name for p in rootfs.iterdir())}


def inspect_stock_contracts(rootfs: Path) -> dict:
    """Export only bounded API/config identifiers, never vendor source or data values."""
    modules = [
        "usr/lib/lua/luci/apprpc/qsetup.lua",
        "usr/lib/lua/luci/model/cbi/network/summary.lua",
        "usr/lib/lua/luci/controller/index.lua",
        "usr/lib/lua/luci/dispatcher.lua",
        "usr/lib/lua/luci/apprpc/wifi.lua",
        "usr/lib/lua/luci/apprpc/network.lua",
        "usr/lib/lua/luci/view/wizard.htm",
    ]
    signal = re.compile(
        r"(?:wizard|qsetup|setpasswd|auth|sysauth|csrf|salt|token|"
        r"wireless|wlan|wifi|ssid|encrypt|channel|wan|pppoe|dhcp|"
        r"static|gateway|subnet|network|rpc|ubus|commit|apply|"
        r"factory|summary|revert|uhttpd|luci)", re.I
    )
    out = {}
    for rel in modules:
        p = rootfs / rel
        if not p.is_file():
            continue
        raw = p.read_bytes()
        chunks = re.findall(rb"[\\x20-\\x7e]{3,}", raw)
        identifiers = []
        for chunk in chunks:
            s = chunk.decode("ascii", errors="replace")
            if 3 <= len(s) <= 80 and re.fullmatch(r"[A-Za-z0-9_./:?-]+", s) and signal.search(s):
                identifiers.append(s)
        out[rel] = {
            "bytes": len(raw),
            "lua_bytecode": raw.startswith(bytes.fromhex("1b4c7561")),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "candidate_identifiers": sorted(set(identifiers))[:160],
            "evidence_level": "static_strings_not_verified_RPC_contract",
        }
    return out


def analyze(zip_path: Path, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    result = {"target": "Cudy WR3000 V1.0 / R31", "version": "2.4.19",
              "firmware_file": FIRMWARE_NAME, "source_url": SOURCE_URL,
              "zip_sha256": digest(zip_path), "zip_bytes": zip_path.stat().st_size,
              "checksum_status": "observed_not_vendor_published"}
    with tempfile.TemporaryDirectory(prefix='wr3000-stock-') as folder:
        temp = Path(folder)
        with zipfile.ZipFile(zip_path) as archive:
            candidates = [n for n in archive.namelist() if n.lower().endswith(('.bin', '.img'))
                          and not n.endswith('/')]
            result['archive_files'] = sorted(archive.namelist())[:60]
            if not candidates:
                result['extraction'] = {"status": "no_bin_inside_zip"}
            else:
                image = temp / Path(candidates[0]).name
                with archive.open(candidates[0]) as src, image.open('wb') as dest:
                    shutil.copyfileobj(src, dest)
                result['image_name'] = Path(candidates[0]).name
                result['image_sha256'] = digest(image)
                result['image_bytes'] = image.stat().st_size
                rootfs = temp / 'rootfs'
                result['extraction'] = extract_firmware(image, rootfs)
                if result['extraction']['status'] == 'extracted':
                    result['rootfs_evidence'] = inspect_rootfs(rootfs)
                    result['stock_contract_candidates'] = inspect_stock_contracts(rootfs)
    (output / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    overview = ["# WR3000 V1 stock firmware evidence", "",
                f"Archive: {FIRMWARE_NAME}", f"ZIP SHA256: `{result['zip_sha256']}`",
                f"Extraction: **{result['extraction']['status']}**", "",
                "This is discovery evidence, not proof of an authenticated session or write-path.", "",
                "No firmware binary or raw response containing secrets is included.", ""]
    for item in result.get('rootfs_evidence', {}).get('matches', [])[:100]:
        overview.append(f"- `{item['path']}` — {', '.join(item['categories'])} ({', '.join(item['markers'][:8])})")
    for module, detail in result.get('stock_contract_candidates', {}).items():
        overview.append(f"\\n## {module}")
        overview.append(f"Lua bytecode: {detail['lua_bytecode']}")
        overview.append("Identifiers (static, not RPC validation): " + ", ".join(detail['candidate_identifiers'][:70]))
    (output / 'analysis.md').write_text('\n'.join(overview) + '\n', encoding='utf8')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', type=Path, help='previously downloaded official firmware archive')
    parser.add_argument('--download', action='store_true', help='download official vendor archive')
    parser.add_argument('--out', type=Path, default=Path('wr3000-evidence'))
    args = parser.parse_args()
    if not args.download and not args.zip:
        parser.error('specify --download or --zip')
    if args.download:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / FIRMWARE_NAME
            with urllib.request.urlopen(SOURCE_URL, timeout=90) as response, path.open('wb') as f:
                shutil.copyfileobj(response, f)
            result = analyze(path, args.out)
    else:
        result = analyze(args.zip, args.out)
    print('firmware:', result['target'], result['version'])
    print('sha256:', result['zip_sha256'])
    print('rootfs:', result['extraction']['status'])
    print('evidence:', args.out / 'analysis.md')


if __name__ == '__main__':
    main()
