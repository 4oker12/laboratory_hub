#!/usr/bin/env python3
"""Read-only comparison of an official Archer C54 EU V1 firmware with RouterLab C20 contracts.
Never contacts a physical router. No firmware is flashed or committed.
"""
import hashlib
import json
import lzma
import pathlib
import re
import subprocess
import sys
import urllib.request
import zipfile

ZIP_URL = "https://static.tp-link.com/upload/firmware/2025/202509/20250930/Archer%20C54%28EU%29_V1_250811.zip"
C20_MARKERS = {
    "C20 GDPR transport": (r"/cgi_gdpr",),
    "C20 RSA params": (r"getGDPRParm",),
    "C20 login CGI": (r"/cgi/login",),
    "C20 WLAN object": (r"LAN_WLAN",),
    "C20 WAN object": (r"WAN_IP_CONN",),
    "C20 session cookie": (r"JSESSIONID",),
}
OTHER_MARKERS = {
    "TP-Link alternative params": (r"/cgi/getParm",),
    "LuCI API family": (r"/cgi-bin/luci",),
    "Token in API": (r";stok=",),
    "TP-Link crypto library": (r"tpEncrypt",),
    "Quick setup source": (r"quick.?setup", r"quickSetup"),
    "Admin login UI": (r"login",),
    "Wi-Fi configuration": (r"wireless", r"wlan"),
    "DHCP WAN": (r"dhcp",),
}
MAX_BIN = 20_000_000
MAX_FILE = 3_000_000
MAX_FILES = 1500

def digest(data):
    return hashlib.sha256(data).hexdigest()

def fetch_zip(out):
    request = urllib.request.Request(ZIP_URL, headers={"User-Agent": "RouterLab-static-provenance/1.0"})
    with urllib.request.urlopen(request, timeout=55) as response:
        size = 0
        with out.open("wb") as f:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BIN:
                    raise ValueError("SIZE_LIMIT")
                f.write(chunk)

def rootfs(image, target, report):
    data = image.read_bytes()
    offsets = sorted(set([m.start() for magic in (b"hsqs", b"sqsh") for m in re.finditer(re.escape(magic), data)]))
    report["squashfs_offsets"] = offsets[:30]
    failures = []
    for offset in offsets[:20]:
        dest = target / ("rootfs_" + str(offset))
        proc = subprocess.run(
            ["unsquashfs", "-f", "-o", str(offset), "-d", str(dest), str(image)],
            capture_output=True, text=True, timeout=95
        )
        if proc.returncode == 0 and any(dest.rglob("*")):
            report["rootfs_offset"] = offset
            return dest
        failures.append({"offset": offset, "error": proc.stderr[-280:]})
    report["extract_errors"] = failures[:4]
    return None

def scan(paths):
    hits = {}
    examples = {}
    for name, patterns in {**C20_MARKERS, **OTHER_MARKERS}.items():
        hits[name] = []
        regexes = [re.compile(x, re.IGNORECASE) for x in patterns]
        for path in paths:
            try:
                blob = path.read_bytes()
            except OSError:
                continue
            if len(blob) > MAX_FILE or b"\0" in blob[:300]:
                continue
            content = blob.decode("utf-8", "replace")
            count = sum(len(r.findall(content)) for r in regexes)
            if count:
                hits[name].append({"file": str(path), "matches": count})
        hits[name] = sorted(hits[name], key=lambda x: -x["matches"])[:12]
    return hits

def decode_lzma_parts(binary, report):
    """Decode bounded LZMA-alone streams; do not publish embedded vendor payload."""
    offsets = [45060]
    offsets.extend(m.start() for m in re.finditer(re.escape(b"\x5d\x00\x00\x80\x00"), binary))
    offsets = list(dict.fromkeys(offsets))[:100]
    records = []
    framework_names = {}
    route_literals = set()
    transport_terms = {}
    combined_hits = {k: 0 for k in {**C20_MARKERS, **OTHER_MARKERS}}
    for offset in offsets:
        try:
            decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE)
            clear = decoder.decompress(binary[offset:], max_length=9_000_000)
            if not clear or len(clear) < 40:
                continue
            low = clear.lower()
            for name in re.findall(rb"\$\.su\.([a-zA-Z_][a-zA-Z_0-9]{1,38})", clear):
                key = name.decode("ascii", "ignore")
                framework_names[key] = framework_names.get(key, 0) + 1
            for path_literal in re.findall(rb"""['"](/(?:cgi|cgi-bin|api|login|data)[^'"\s]{0,85})['"]""", clear, re.I):
                route_literals.add(path_literal.decode("utf8", "replace"))
            for term in ("cgi", "ajax", "proxy", "encrypt", "rsa", "aes", "token", "auth", "stok", "cookie", "getparm"):
                transport_terms[term] = transport_terms.get(term, 0) + low.count(term.encode())
            hits = {k: sum(low.count(p.lower().encode()) for p in pats)
                    for k, pats in {**C20_MARKERS, **OTHER_MARKERS}.items()}
            for key, value in hits.items():
                combined_hits[key] += value
            records.append({
                "offset": offset, "decoded_size": len(clear),
                "stream_eof": decoder.eof,
                "head_hex": clear[:24].hex(),
                "printable_ratio": round(sum(32 <= v <= 126 or v in (9,10,13) for v in clear[:8192]) / min(len(clear),8192),3),
                "hits": {k:v for k,v in hits.items() if v}
            })
        except (lzma.LZMAError, EOFError, ValueError):
            continue
    report["lzma_decoded"] = records[:100]
    report["lzma_total"] = len(records)
    report["lzma_c20_marker_hits"] = combined_hits
    report["js_framework_names"] = sorted(framework_names.items(), key=lambda x: -x[1])[:40]
    report["route_literals"] = sorted(route_literals)[:70]
    report["transport_terms"] = transport_terms
    return records

def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/routerlab-c54")
    out.mkdir(parents=True, exist_ok=True)
    report = {
        "model": "Archer C54", "hardware": "V1 EU", "stock": "1.15.0 Build 250811",
        "mode": "STATIC_ONLY", "official_url": ZIP_URL,
        "C20_reference": "extensions/tplink-c20/independent-session",
        "physical_device": "NOT_TESTED", "api_compatibility": "UNVERIFIED"
    }
    try:
        archive = out / "firmware.zip"
        fetch_zip(archive)
        report["archive_sha256"] = digest(archive.read_bytes())
        with zipfile.ZipFile(archive) as z:
            members = [i for i in z.infolist() if i.filename.lower().endswith(".bin") and 500_000 < i.file_size < MAX_BIN]
            if not members:
                raise ValueError("NO_BIN_IN_ARCHIVE")
            report["members"] = [{"name": x.filename, "bytes": x.file_size} for x in members]
            item = max(members, key=lambda x: x.file_size)
            image = out / "firmware.bin"
            image.write_bytes(z.read(item))
        report["firmware_sha256"] = digest(image.read_bytes())
        raw_image = image.read_bytes()
        report["first_128_bytes_hex"] = raw_image[:128].hex()
        report["raw_marker_hits"] = {name: sum(raw_image.lower().count(p.lower().encode()) for p in patterns)
                                     for name, patterns in {**C20_MARKERS, **OTHER_MARKERS}.items()}
        magic = {
            "uimage": b"\x27\x05\x19\x56", "gzip": b"\x1f\x8b",
            "zlib": b"\x78\x9c", "lzma_common": b"\x5d\x00\x00\x80\x00",
            "jffs2": b"\x85\x19", "ubifs": b"\x31\x18\x10\x06"
        }
        report["raw_magic_offsets"] = {name: [m.start() for m in list(re.finditer(re.escape(sig), raw_image))[:15]]
                                       for name, sig in magic.items()}
        if pathlib.Path("/usr/bin/binwalk").exists():
            proc = subprocess.run(["binwalk", str(image)], capture_output=True, text=True, timeout=60)
            report["binwalk"] = (proc.stdout + proc.stderr)[:8000]
        decoded = decode_lzma_parts(raw_image, report)
        root = rootfs(image, out, report)
        if root:
            paths = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in
                     (".js", ".html", ".htm", ".lua", ".json", ".xml", ".css", ".txt")][:MAX_FILES]
            report["rootfs_status"] = "EXTRACTED"
            report["source_file_count"] = len(paths)
            report["sample_paths"] = [str(p.relative_to(root)) for p in paths[:60]]
            matches = scan(paths)
            report["markers"] = {k: [{"file": x["file"].replace(str(root) + "/", ""), "matches": x["matches"]} for x in v] for k, v in matches.items()}
        else:
            report["rootfs_status"] = "LZMA_STREAMS_DECODED" if decoded else "UNEXTRACTED"
            report["markers"] = {}
    except Exception as e:
        report["failure"] = type(e).__name__ + ": " + str(e)[:250]
    finally:
        (out / "REPORT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        lines = [
            "# Archer C54 EU V1 vs RouterLab Archer C20 v5",
            "",
            "Scope: offline, static extraction of the vendor image; no physical login, no HTTP SET, no firmware flashing.",
            "",
            "## Firmware",
            "",
            "- C54 firmware: " + report["stock"],
            "- Download: " + ZIP_URL,
            "- Image status: " + report.get("rootfs_status", report.get("failure", "UNKNOWN")),
            "- ZIP SHA256: " + report.get("archive_sha256", "unavailable"),
            "- BIN SHA256: " + report.get("firmware_sha256", "unavailable"),
            "- SquashFS candidates: " + str(report.get("squashfs_offsets", [])),
            "",
            "## Container diagnostics",
            "",
            "- First 128 bytes (hex): " + report.get("first_128_bytes_hex", "unknown"),
            "- Raw C20 marker counts: " + str(report.get("raw_marker_hits", {})),
            "- Other magic signatures: " + str(report.get("raw_magic_offsets", {})),
            "",
            "### Binwalk",
            "",
            "~~~text", report.get("binwalk", "not installed"), "~~~",
            "",
            "## LZMA decoded streams",
            "",
            "- Decoded stream count: " + str(report.get("lzma_total", 0)),
            "- C20 marker counts in decoded streams: " + str(report.get("lzma_c20_marker_hits", {})),
            "- Interesting streams: " + str([x for x in report.get("lzma_decoded", []) if x["hits"]][:20]),
            "",
            "## C54 JavaScript API inventory",
            "",
            "- TP-Link $.su framework names: " + str(report.get("js_framework_names", [])),
            "- Quoted API paths: " + str(report.get("route_literals", [])),
            "- Transport term frequency: " + str(report.get("transport_terms", {})),
            "",
            "## C20 contract fingerprints inside C54 image",
            "",
            "| C20 reference | C54 firmware static hits | Important |",
            "| --- | --- | --- |",
        ]
        for key in C20_MARKERS:
            found = report.get("markers", {}).get(key, [])
            summary = ", ".join(x["file"] + " (" + str(x["matches"]) + ")" for x in found[:3]) if found else "Not observed / extraction incomplete"
            lines.append("| " + key + " | " + summary.replace("|", "") + " | Requires physical trace before reuse |")
        lines += ["", "## Alternative firmware indicators", ""]
        for key in OTHER_MARKERS:
            found = report.get("markers", {}).get(key, [])
            summary = ", ".join(x["file"] for x in found[:4]) if found else "Not observed"
            lines.append("- **" + key + "**: " + summary)
        lines += ["", "## Safety gates", "",
            "1. Match model, hardware revision and region on the physical router.",
            "2. Identify C54's actual auth, session and quick-setup API from stock JS/HAR.",
            "3. Read and verify WAN/WLAN before enabling any write.",
            "4. Do not reuse C20 /cgi_gdpr, RSA/AES or WLAN stacks based only on brand/family similarity.",
            "5. Stock UI emulator is not equivalent to this 2025 physical firmware.",
            "", "No vendor binaries or raw proprietary JS are exported; report only.",
        ]
        (out / "REPORT.md").write_text("\n".join(lines))
        print((out / "REPORT.md").read_text())
    if "failure" in report or report.get("rootfs_status") not in ("EXTRACTED", "LZMA_STREAMS_DECODED"):
        sys.exit(2)

if __name__ == "__main__":
    main()
