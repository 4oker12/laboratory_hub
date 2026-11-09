# NetCheck WiFi Probe (iPhone Shortcuts bridge)

Experimental link between Apple Shortcuts and the NetCheck Explorer iPhone application.

## Why Shortcuts?
iOS 17+ exposes "Get Network Details" in Shortcuts with Wi-Fi Network Name, BSSID, Wi-Fi Standard, RX Rate, TX Rate, RSSI, Noise, and Channel Number. Native NetCheck itself does not have permission to access these fields.

The companion app launches the shortcuts x-callback-url/run-shortcut operation for the exact command name "NetCheck WiFi Probe". Its callback uses the netcheck-probe scheme, with an additional text result query parameter. The app accepts replies only with the matching, unexpired ticket.

## The command output

Return the final **Text** action as follows; insert real Shortcuts magic variables in place of the labels in angle brackets.

    NCWIFI_V1
    ssid=<Network Name>
    bssid=<BSSID>
    rssi=<RSSI>
    noise=<Noise>
    channel=<Channel Number>
    tx=<TX Rate>
    rx=<RX Rate>
    standard=<Wi-Fi Standard>

Names and the NCWIFI_V1 header matter. The app accepts missing optional values but does not invent them; at least one numeric radio field must be available. Tx/Rx are PHY link rates, NOT throughput.

## Delivery
- scripts/netcheck/build_shortcut.py generates an unsigned 9-action Apple Shortcut plist, with eight Get Network Details and one formatted Text action. The serialization is not yet validated by running on a physical iPhone.
- GitHub Actions uses the official macOS shortcuts sign --mode anyone command to try making an iPhone-importable signed Shortcut. The GitHub runner might lack the necessary iCloud signing access. CI logs distinguish success from failure. NEVER claim an unsigned Shortcut is importable.
- If a signed Shortcuts file is missing or fails to import: manually create the command in Apple Shortcuts, with eight Get Network Details actions; configure the field of each and insert their magic variable outputs in a final Text action with the template above. Name the command exactly NetCheck WiFi Probe. The app's manual text import is available to test parsing.

## Scope and safety
- No router login, external server or Wi-Fi configuration changes.
- SSID/BSSID and readings persist locally in app documents. No debug logs print SSID/BSSID.
- The OS callback URL contains the result string for local delivery to the app; don't share it.
- Shortcuts runs only on user tap, not continuous telemetry. iOS can display permission confirmations.
- The AirPort CSV scan for neighboring networks is independent. A current AP RSSI or Noise is not neighboring-channel utilization.
- GitHub Actions successful IPA compilation is not physical iPhone/Shortcuts proof.
