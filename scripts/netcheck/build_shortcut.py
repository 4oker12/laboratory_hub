#!/usr/bin/env python3
"""Build an unsigned Apple Shortcut for NetCheck.

Generated file intentionally has no network, HTTP, logging, or cloud actions.
It collects the current iPhone Wi-Fi details via Apple's Get Network Details.
The GitHub macOS job optionally signs it via Apple's official "shortcuts sign".
"""
import argparse
import plistlib
from uuid import uuid4

FIELDS = [
    ("ssid","Network Name"),
    ("bssid","BSSID"),
    ("rssi","RSSI"),
    ("noise","Noise"),
    ("channel","Channel Number"),
    ("tx","TX Rate"),
    ("rx","RX Rate"),
    ("standard","Wi-Fi Standard"),
]

def action(identifier, params):
    return {"WFWorkflowActionIdentifier": identifier,
            "WFWorkflowActionParameters": {"UUID": str(uuid4()).upper(), **params}}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    actions = []
    fragments = ["NCWIFI_V1\n"]
    markers = {}
    for field, detail in FIELDS:
        wifi = action("is.workflow.actions.getwifi",{
            "WFNetworkDetailsNetwork": "Wi-Fi",
            "WFWiFiDetail": detail
        })
        actions.append(wifi)
        fragments += [f"{field}=", "\ufffc", "\n"]
        markers[field] = wifi["WFWorkflowActionParameters"]["UUID"]

    string = "".join(fragments)
    # Each magic variable replaces a single object-replacement token.
    offsets = {}
    current = 0
    for field, _ in FIELDS:
        start = string.index(f"{field}=", current) + len(field) + 1
        position = len(string[:start].encode("utf-16-le")) // 2
        offsets[f"{{{position}, 1}}"] = {
            "Type": "ActionOutput",
            "OutputUUID": markers[field],
            "OutputName": "Network Details"
        }
        current = start + 1

    actions.append(action("is.workflow.actions.gettext",{
        "WFTextActionText": {
            "Value": {"string": string, "attachmentsByRange": offsets},
            "WFSerializationType": "WFTextTokenString"
        }
    }))
    shortcut = {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "900",
        "WFWorkflowClientRelease": "2.2",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511}
    }
    with open(args.output, "wb") as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
    with open(args.output, "rb") as f:
        loaded = plistlib.load(f)
    assert len(loaded["WFWorkflowActions"]) == 9
    assert len(offsets) == 8
    assert len(set(offsets)) == 8
    assert string.startswith("NCWIFI_V1\n")
    print("Built unsigned Shortcut, actions=",len(actions),"payload_length=",len(string))

if __name__ == "__main__":
    main()
