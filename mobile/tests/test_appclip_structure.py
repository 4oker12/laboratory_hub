"""Contract checks for the unsigned App Clip prototype (not a native build)."""
import pathlib
import plistlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class AppClipStructureTest(unittest.TestCase):
    def test_clip_is_isolated_from_full_app_entry(self):
        spec = (ROOT / 'project-with-appclip.yml').read_text()
        self.assertIn('application.on-demand-install-capable', spec)
        self.assertIn('destination: wrapper', spec)
        self.assertIn('subpath: AppClips', spec)
        self.assertIn('RouterLabAppClip/RouterLabAppClipApp.swift', spec)
        self.assertIn('RouterLabMobile/RouterSession.swift', spec)
        self.assertIn('buildPhase: resources', spec)

    def test_info_and_parent_entitlement(self):
        info = plistlib.loads((ROOT / 'RouterLabAppClip/Info.plist').read_bytes())
        entitlements = plistlib.loads((ROOT / 'RouterLabAppClip/RouterLabAppClip.entitlements').read_bytes())
        self.assertTrue(info['NSLocalNetworkUsageDescription'])
        self.assertFalse(info['NSAppClip']['NSAppClipRequestEphemeralUserNotification'])
        self.assertEqual(entitlements['com.apple.developer.parent-application-identifiers'],
                         ['$(AppIdentifierPrefix)dev.routerlab.mobile'])

    def test_invocation_cannot_supply_scripts_or_remote_hosts(self):
        source = (ROOT / 'RouterLabAppClip/RouterLabAppClipApp.swift').read_text()
        self.assertIn('NSUserActivityTypeBrowsingWeb', source)
        self.assertIn('parts.scheme?.lowercased() == "https"', source)
        self.assertIn('parts.path == "/setup"', source)
        self.assertIn('items.count == 1', source)
        self.assertIn('RouterSession.isPrivateIPv4(host)', source)
        self.assertIn('session.beginConsumerSetup()', source)


if __name__ == '__main__':
    unittest.main()
