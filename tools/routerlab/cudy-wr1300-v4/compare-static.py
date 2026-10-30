#!/usr/bin/env python3
"""Compare stock rootfs LuCI contracts; never infer runtime compatibility."""
import json
import sys
from pathlib import Path

def classification(a, b):
    if not a.get("present") and not b.get("present"):
        return "absent-both"
    if not a.get("present"):
        return "new-on-WR1300"
    if not b.get("present"):
        return "absent-on-WR1300"
    if a.get("sha256") == b.get("sha256"):
        return "byte-identical"
    return "byte-different"

def render(reference, candidate):
    r = reference.get("critical_files", {})
    c = candidate.get("critical_files", {})
    rows = [(key, classification(r.get(key, {}), c.get(key, {})))
            for key in sorted(set(r) | set(c))]
    rt = reference.get("luci_contract_tree", {})
    ct = candidate.get("luci_contract_tree", {})
    shared = sorted(set(rt) & set(ct))
    identical = [p for p in shared if rt[p]["sha256"] == ct[p]["sha256"]]
    q_ref = set(reference.get("qsetup_strings", []))
    q_new = set(candidate.get("qsetup_strings", []))
    lines = [
        "# Cudy WR1300 V4 vs WR1200 R26: static contract evidence",
        "",
        "**Verdict: STATIC_ONLY. No physical/router-session support inferred.**",
        "",
        "- WR1200 critical paths: %s" % len(r),
        "- WR1300 critical paths: %s" % len(c),
        "- Shared LuCI contract paths: %s" % len(shared),
        "- Identical bytes among shared LuCI paths: %s" % len(identical),
        "- WR1200 LuCI paths absent on WR1300: %s" % len(set(rt) - set(ct)),
        "- WR1300 new LuCI paths: %s" % len(set(ct) - set(rt)),
        "- qsetup removed string hints: %s" % len(q_ref - q_new),
        "- qsetup added string hints: %s" % len(q_new - q_ref),
        "",
        "## Critical files",
        "| Stock file | Comparison |",
        "|---|---|",
    ]
    lines += ["| %s | %s |" % (path, status) for path, status in rows]
    lines += ["", "## Release metadata", "",
              "WR1200: " + json.dumps(reference.get("release", {}), ensure_ascii=False),
              "",
              "WR1300: " + json.dumps(candidate.get("release", {}), ensure_ascii=False),
              "", "## Added qsetup strings (clues, not proof)", ""]
    lines += ["- " + s.replace("|", "/")[:180] for s in sorted(q_new - q_ref)[:80]]
    lines += ["", "## Removed qsetup strings (clues, not proof)", ""]
    lines += ["- " + s.replace("|", "/")[:180] for s in sorted(q_ref - q_new)[:80]]
    lines += [
        "", "## Interpretation",
        "",
        "Identical source bytes are evidence of a shared implementation, but do not",
        "validate auth, session cookies, live WAN and wireless effects, or persistence.",
        "Changed bytes are a diff, not proof of breakage.",
        "Next gates: qsetup/dispatcher bytecode mapping, authentic first-boot runtime,",
        "then sanitized HAR and live read/write/rollback against WR1300 V4.",
    ]
    return "\n".join(lines) + "\n"

def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: compare-static.py REFERENCE.json TARGET.json OUTPUT.md")
    reference = json.loads(Path(sys.argv[1]).read_text())
    candidate = json.loads(Path(sys.argv[2]).read_text())
    out = Path(sys.argv[3])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(reference, candidate))
    print("static diff:", out)

if __name__ == "__main__":
    main()
