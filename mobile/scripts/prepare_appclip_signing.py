#!/usr/bin/env python3
"""Generate manual Xcode signing settings for a Development/Ad Hoc App Clip build.

The script receives decoded .mobileprovision plist files and copies the original
profiles into the temporary runner's provisioning directory. No keys/passwords
are read or written here, and no secret values are printed.
"""
import argparse
import datetime as dt
import plistlib
import re
import shutil
from pathlib import Path

BUNDLES = {"parent": "dev.routerlab.mobile", "clip": "dev.routerlab.mobile.Clip"}


def validate_profile(path: Path, bundle_id: str, team: str, method: str) -> dict:
    profile = plistlib.loads(path.read_bytes())
    if team not in profile.get("TeamIdentifier", []):
        raise ValueError(f"Team mismatch: {bundle_id}")
    expected = team + "." + bundle_id
    got = profile.get("Entitlements", {}).get("application-identifier")
    if got != expected:
        raise ValueError(f"App ID mismatch: {bundle_id}")
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, dt.datetime):
        raise ValueError(f"No expiration date: {bundle_id}")
    now = dt.datetime.now(dt.timezone.utc)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=dt.timezone.utc)
    if expires <= now:
        raise ValueError(f"Provisioning profile expired: {bundle_id}")
    if not profile.get("ProvisionedDevices"):
        raise ValueError(f"No registered development devices: {bundle_id}")
    allows_debug = bool(profile.get("Entitlements", {}).get("get-task-allow", False))
    if (method == "development") != allows_debug:
        raise ValueError(f"Profile distribution method mismatch: {bundle_id}")
    if not profile.get("Name") or not profile.get("UUID"):
        raise ValueError(f"No profile name/UUID: {bundle_id}")
    return profile


def main() -> None:
    parser = argparse.ArgumentParser()
    for option in ("parent", "clip", "parent-source", "clip-source", "spec",
                   "output-spec", "export-options", "provisioning-dir"):
        parser.add_argument("--" + option, required=True, type=Path)
    parser.add_argument("--team", required=True)
    parser.add_argument("--method", choices=["development", "ad-hoc"], required=True)
    a = parser.parse_args()
    if not re.fullmatch(r"[A-Z0-9]{10}", a.team):
        raise ValueError("Invalid Apple Team ID format")

    parent = validate_profile(a.parent, BUNDLES["parent"], a.team, a.method)
    clip = validate_profile(a.clip, BUNDLES["clip"], a.team, a.method)
    if parent["UUID"] == clip["UUID"]:
        raise ValueError("App and App Clip require separate profiles")

    a.provisioning_dir.mkdir(parents=True, exist_ok=True)
    for profile, source in ((parent, a.parent_source), (clip, a.clip_source)):
        shutil.copyfile(source, a.provisioning_dir / (profile["UUID"] + ".mobileprovision"))

    original = a.spec.read_text(encoding="utf-8")
    cert = "Apple Development" if a.method == "development" else "Apple Distribution"
    for profile, identifier in ((parent, BUNDLES["parent"]), (clip, BUNDLES["clip"])):
        needle = "        PRODUCT_BUNDLE_IDENTIFIER: " + identifier + "\n"
        if original.count(needle) != 1:
            raise ValueError("Expected exactly one XcodeGen product identifier: " + identifier)
        additions = (
            f"        DEVELOPMENT_TEAM: {a.team}\n"
            "        CODE_SIGN_STYLE: Manual\n"
            f"        CODE_SIGN_IDENTITY: '{cert}'\n"
            f"        PROVISIONING_PROFILE_SPECIFIER: '{profile['Name']}'\n"
        )
        original = original.replace(needle, needle + additions, 1)
    a.output_spec.write_text(original, encoding="utf-8")

    export = {
        "method": a.method,
        "signingStyle": "manual",
        "teamID": a.team,
        "destination": "export",
        "provisioningProfiles": {
            BUNDLES["parent"]: parent["Name"],
            BUNDLES["clip"]: clip["Name"],
        },
    }
    with a.export_options.open("wb") as f:
        plistlib.dump(export, f)
    print("Two matching, nonexpired, device-scoped profiles validated; Xcode signing prepared.")
    print("No claim of successful archive, Apple export, physical installation or QR invocation.")


if __name__ == "__main__":
    main()
