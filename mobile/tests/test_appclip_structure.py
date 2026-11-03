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
        self.assertIn('RouterLabMobile/ContentView.swift', spec)
        self.assertIn('RouterLabMobile/RouterSession.swift', spec)
        self.assertIn('SWIFT_ACTIVE_COMPILATION_CONDITIONS: ROUTERLAB_APP_CLIP', spec)
        self.assertIn('buildPhase: resources', spec)

    def test_info_and_parent_entitlement(self):
        info = plistlib.loads((ROOT / 'RouterLabAppClip/Info.plist').read_bytes())
        entitlements = plistlib.loads((ROOT / 'RouterLabAppClip/RouterLabAppClip.entitlements').read_bytes())
        self.assertTrue(info['NSLocalNetworkUsageDescription'])
        self.assertFalse(info['NSAppClip']['NSAppClipRequestEphemeralUserNotification'])
        self.assertEqual(entitlements['com.apple.developer.parent-application-identifiers'],
                         ['$(AppIdentifierPrefix)dev.routerlab.mobile'])

    def test_invocation_starts_shared_discovery_without_commands(self):
        entry = (ROOT / 'RouterLabAppClip/RouterLabAppClipApp.swift').read_text(encoding='utf-8')
        source = (ROOT / 'RouterLabMobile/ContentView.swift').read_text(encoding='utf-8')
        session = (ROOT / 'RouterLabMobile/RouterSession.swift').read_text(encoding='utf-8')
        panel = (ROOT / 'RouterLabMobile/Resources/RouterLabNetisPanel.js').read_text(encoding='utf-8')
        self.assertIn('WindowGroup { ContentView() }', entry)
        self.assertIn('NSUserActivityTypeBrowsingWeb', source)
        self.assertIn('parts.scheme?.lowercased() == "https"', source)
        self.assertIn('parts.path == "/connect"', source)
        self.assertIn('parts.query == nil', source)
        self.assertIn('host == "appclip.apple.com"', source)
        self.assertIn('parts.path == "/id"', source)
        self.assertIn('session.startDiscovery()', source)
        self.assertIn("Object.defineProperty(window, '__RouterLabReadOnlyClip', {value: true});", session)
        self.assertIn('if (clipReadOnly) return;', panel)


if __name__ == '__main__':
    unittest.main()
