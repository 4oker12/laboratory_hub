#!/usr/bin/env python3
"""Fail early on damaged hand-authored Xcode project metadata.

Structural preflight only; it does not replace xcodebuild on macOS.
"""
from pathlib import Path
import plistlib
import re

root = Path(__file__).resolve().parents[1]
pbx = (root / "RouterLabMobile.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
plist = plistlib.loads((root / "RouterLabMobile/Info.plist").read_bytes())

projects = re.findall(r"\b([A-F0-9]{24})\s*=\s*\{isa\s*=\s*PBXProject;", pbx)
assert len(projects) == 1, "Expected exactly one PBXProject"
root_object = re.search(r"\brootObject\s*=\s*([A-F0-9]{24});", pbx)
assert root_object and root_object.group(1) == projects[0], "rootObject must point to PBXProject"
assert "name = RouterLabMobile;" in pbx, "iOS app target is missing"
assert "path = RouterLabRuntime.js;" in pbx, "JS runtime is missing from project"
assert "B10000000000000000000004" in pbx, "JS runtime is missing from build resources"
assert (root / "RouterLabMobile/Resources/RouterLabRuntime.js").is_file(), "Runtime source missing"
schemes = [s for item in plist.get("CFBundleURLTypes", [])
           for s in item.get("CFBundleURLSchemes", [])]
assert "routerlab" in schemes, "Deep link URL scheme is missing"
assert plist.get("NSLocalNetworkUsageDescription"), "Local network privacy description is missing"
print("RouterLab iOS project structure: OK (Xcode build still required)")
