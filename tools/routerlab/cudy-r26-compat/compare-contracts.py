#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

STEP_ORDER = [
    "preflight",
    "factory_form",
    "admin_password",
    "guide_0",
    "workmode",
    "guide_1",
    "timezone",
    "guide_2",
    "wan_dhcp",
    "guide_3",
    "wireless",
    "guide_4",
    "summary",
    "guide_5",
    "stock_apply",
    "verify",
]


def load_json(path: str) -> dict:
    return json.loads(Path(path).read_text())


def read_text(path: str | None) -> str:
    if not path:
        return ""
    p = Path(path)
    return p.read_text(errors="replace") if p.is_file() else ""


def read_rc(path: str | None) -> int | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return int(p.read_text().strip())
    except Exception:
        return None


def parse_steps(log: str) -> list[str]:
    out = []
    seen = set()
    for m in re.finditer(r"^STEP\s+([A-Za-z0-9_]+)\s+(?:ok|skipped)(?:\s|$)", log, re.M):
        step = m.group(1)
        if step not in seen:
            seen.add(step)
            out.append(step)
    return out


def parse_results(log: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r"^RESULT\s+([A-Za-z0-9_]+)=(.*)$", log, re.M):
        out[m.group(1)] = m.group(2).strip()
    return out


def status_for_file(ref: dict, cand: dict) -> str:
    if not ref.get("present") and not cand.get("present"):
        return "absent-both"
    if ref.get("present") and not cand.get("present"):
        return "missing-candidate"
    if not ref.get("present") and cand.get("present"):
        return "new-candidate"
    if ref.get("sha256") == cand.get("sha256"):
        return "same"
    return "changed"


def first_runtime_divergence(ref_reset_rc, cand_reset_rc, ref_quick_rc, cand_quick_rc, ref_steps, cand_steps):
    if ref_reset_rc != 0:
        return "reference-runtime-broken"
    if cand_reset_rc != 0:
        return "factory_runtime"
    if ref_quick_rc != 0:
        return "reference-quick-setup-broken"
    if cand_quick_rc == 0:
        return None

    cand_set = set(cand_steps)
    ref_set = set(ref_steps)
    for step in STEP_ORDER:
        if step in ref_set and step not in cand_set:
            return step
    return "quick_setup_unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--candidate", required=True)
    ap.add_argument("--reference-reset-log")
    ap.add_argument("--candidate-reset-log")
    ap.add_argument("--reference-quick-log")
    ap.add_argument("--candidate-quick-log")
    ap.add_argument("--reference-reset-rc")
    ap.add_argument("--candidate-reset-rc")
    ap.add_argument("--reference-quick-rc")
    ap.add_argument("--candidate-quick-rc")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    ref = load_json(args.reference)
    cand = load_json(args.candidate)

    ref_reset_log = read_text(args.reference_reset_log)
    cand_reset_log = read_text(args.candidate_reset_log)
    ref_quick_log = read_text(args.reference_quick_log)
    cand_quick_log = read_text(args.candidate_quick_log)

    ref_reset_rc = read_rc(args.reference_reset_rc)
    cand_reset_rc = read_rc(args.candidate_reset_rc)
    ref_quick_rc = read_rc(args.reference_quick_rc)
    cand_quick_rc = read_rc(args.candidate_quick_rc)

    ref_steps = parse_steps(ref_quick_log)
    cand_steps = parse_steps(cand_quick_log)
    ref_results = parse_results(ref_quick_log)
    cand_results = parse_results(cand_quick_log)

    critical_rows = []
    for rel in sorted(set(ref["critical_files"]) | set(cand["critical_files"])):
        rr = ref["critical_files"].get(rel, {"present": False})
        cc = cand["critical_files"].get(rel, {"present": False})
        critical_rows.append((rel, status_for_file(rr, cc)))

    ref_tree = ref.get("luci_contract_tree", {})
    cand_tree = cand.get("luci_contract_tree", {})
    same_tree = changed_tree = missing_tree = new_tree = 0
    changed_paths = []
    for rel in sorted(set(ref_tree) | set(cand_tree)):
        if rel not in cand_tree:
            missing_tree += 1
            changed_paths.append(("missing", rel))
        elif rel not in ref_tree:
            new_tree += 1
            changed_paths.append(("new", rel))
        elif ref_tree[rel]["sha256"] == cand_tree[rel]["sha256"]:
            same_tree += 1
        else:
            changed_tree += 1
            changed_paths.append(("changed", rel))

    ref_q = set(ref.get("qsetup_strings", []))
    cand_q = set(cand.get("qsetup_strings", []))
    q_removed = sorted(ref_q - cand_q)
    q_added = sorted(cand_q - ref_q)

    first = first_runtime_divergence(
        ref_reset_rc, cand_reset_rc, ref_quick_rc, cand_quick_rc, ref_steps, cand_steps
    )

    if ref_quick_rc == 0 and cand_quick_rc == 0:
        verdict = "FULL_RUNTIME_COMPATIBLE"
    elif first and first not in ("reference-runtime-broken", "reference-quick-setup-broken"):
        verdict = "DIVERGED"
    else:
        verdict = "INCONCLUSIVE"

    lines = []
    a = lines.append
    a("# Cudy WR1200 R26 firmware compatibility report")
    a("")
    a(f"- Reference: **{ref['label']}**")
    a(f"- Candidate: **{cand['label']}**")
    a(f"- Verdict: **{verdict}**")
    a(f"- First runtime divergence: **{first or 'none'}**")
    a("")

    a("## Runtime acceptance")
    a("")
    a("| Check | Reference | Candidate |")
    a("|---|---:|---:|")
    a(f"| factory runtime reset | {ref_reset_rc} | {cand_reset_rc} |")
    a(f"| full quick setup | {ref_quick_rc} | {cand_quick_rc} |")
    a(f"| steps completed | {len(ref_steps)} | {len(cand_steps)} |")
    a(f"| wizard result | {ref_results.get('wizard','-')} | {cand_results.get('wizard','-')} |")
    a(f"| WAN result | {ref_results.get('wan_proto','-')} | {cand_results.get('wan_proto','-')} |")
    a("")

    a("### Reference steps")
    a("")
    a(" → ".join(ref_steps) if ref_steps else "_none_")
    a("")
    a("### Candidate steps")
    a("")
    a(" → ".join(cand_steps) if cand_steps else "_none_")
    a("")

    a("## Factory defaults / UCI contract")
    a("")
    for key in ("wizard", "defpasswd", "sessiontime"):
        rv = ref.get("luci_options", {}).get(key)
        cv = cand.get("luci_options", {}).get(key)
        state = "SAME" if rv == cv else "DIFF"
        a(f"- `{key}`: reference={rv!r}, candidate={cv!r}, {state}")
    a("")

    a("## Critical management-plane files")
    a("")
    a("| Path | Status |")
    a("|---|---|")
    for rel, st in critical_rows:
        a(f"| `{rel}` | {st} |")
    a("")

    a("## LuCI contract tree")
    a("")
    a(f"- unchanged files: **{same_tree}**")
    a(f"- changed files: **{changed_tree}**")
    a(f"- missing in candidate: **{missing_tree}**")
    a(f"- new in candidate: **{new_tree}**")
    if changed_paths:
        a("")
        a("First changed paths:")
        for kind, rel in changed_paths[:60]:
            a(f"- {kind}: `{rel}`")
    a("")

    a("## qsetup printable-contract delta")
    a("")
    if not q_removed and not q_added:
        a("No filtered qsetup string delta.")
    else:
        if q_removed:
            a("Removed from candidate:")
            for x in q_removed[:80]:
                a(f"- `{x.replace('`','')}`")
        if q_added:
            a("")
            a("Added in candidate:")
            for x in q_added[:80]:
                a(f"- `{x.replace('`','')}`")
    a("")

    if cand_reset_rc not in (None, 0):
        a("## Candidate factory-runtime tail")
        a("")
        a("```text")
        a("\n".join(cand_reset_log.splitlines()[-80:]))
        a("```")
        a("")
    elif cand_quick_rc not in (None, 0):
        a("## Candidate quick-setup failure tail")
        a("")
        a("```text")
        a("\n".join(cand_quick_log.splitlines()[-100:]))
        a("```")
        a("")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print(out.read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
