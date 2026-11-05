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
    """Locate SquashFS in a vendor bin. Never guess architecture/offset if absent."""
    target.mkdir(parents=True, exist_ok=True)
    if not shutil.which('unsquashfs'):
        return {"status": "unsquashfs_missing", "offsets_tried": []}
    with image.open('rb') as f:
        content = f.read()
    offsets = []
    for magic in (b'hsqs', b'sqsh'):
        pos = 0
        while (pos := content.find(magic, pos)) != -1:
            offsets.append(pos)
            pos += 4
    offsets = sorted(set(offsets))[:50]
    for pos in offsets:
        proc = subprocess.run(['unsquashfs', '-s', '-o', str(pos), str(image)],
                              capture_output=True, text=True, timeout=25)
        if proc.returncode != 0:
            continue
        proc = subprocess.run(['unsquashfs', '-f', '-o', str(pos), '-d', str(target), str(image)],
                              capture_output=True, text=True, timeout=160)
        if proc.returncode == 0:
            return {"status": "extracted", "offset": pos, "offsets_tried": offsets,
                    "unsquashfs_superblock": proc.stdout[-600:]}
    return {"status": "squashfs_not_extracted", "offsets_tried": offsets}


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
    (output / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    overview = ["# WR3000 V1 stock firmware evidence", "",
                f"Archive: {FIRMWARE_NAME}", f"ZIP SHA256: `{result['zip_sha256']}`",
                f"Extraction: **{result['extraction']['status']}**", "",
                "This is discovery evidence, not proof of an authenticated session or write-path.", "",
                "No firmware binary or raw response containing secrets is included.", ""]
    for item in result.get('rootfs_evidence', {}).get('matches', [])[:100]:
        overview.append(f"- `{item['path']}` — {', '.join(item['categories'])} ({', '.join(item['markers'][:8])})")
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
