# Equicord — Privacy Policy

Equicord is a client modification for Discord. This page describes, as accurately as possible, what data Equicord handles and where it can travel. If anything here is unclear or wrong, please open an issue.

## Summary

- Equicord contains **no telemetry, no analytics and no tracking**.
- Equicord itself does not operate any server that collects your data.
- It is not a fully offline tool: it runs inside Discord, and some features make network requests (updates, optional cloud settings sync, plugin features). Where those requests go is documented below.
- Plugins are powerful: a plugin can read and act on Discord data that is already visible to you. Every plugin you enable is your choice, and third-party plugins are outside this policy.

## 1. Data stored on your device

Equicord stores its settings, plugin state and plugin data locally:

- **Browser extension**: in the extension's local storage (`chrome.storage` / `browser.storage`).
- **Userscript**: in the site's `localStorage` on discord.com.
- **Desktop (injected client / Equibop)**: in files inside your Discord user data directory.

This includes your Equicord settings, your QuickCSS and plugin data. It does not leave your device unless a feature described below is enabled or invoked.

## 2. Network requests

| Request | Destination | When | What is sent |
| --- | --- | --- | --- |
| Discord's own traffic | Discord | Always — it is the client you are using | Governed by [Discord's privacy policy](https://discord.com/privacy) |
| Update checks & self-updates (web extension) | GitHub releases of this repository | Only when you click "Check for Updates" in the Updater tab | Your IP address is visible to GitHub, as with any HTTP request. No cookies, no Discord account data, no Equicord settings are sent |
| Installer download (desktop dev setup) | GitHub releases of [Equilotl](https://github.com/Equicord/Equilotl) | When you run `pnpm inject` | Same as above. The binary is verified against the published `.sha256` checksum when one is available |
| Cloud settings sync | The server you configure in Cloud Settings | Only if you explicitly enable it | See section 3 |

## 3. Cloud settings sync (opt-in)

If you enable **Cloud Settings Sync**, Equicord uploads your settings, QuickCSS and plugin data to the cloud server configured in Equicord's Cloud Settings (the default instance is operated for the Vencord/Equicord ecosystem). The server sees your Discord user ID and the content you chose to sync, and nothing else about you. You can delete all synced data from the same panel at any time. **If you never enable it, nothing is uploaded.**

## 4. Plugins

Some bundled plugins contact third-party services to do their job — for example to fetch emote data, song information or public Steam profiles. These requests happen only when you use the feature, and are documented by each plugin. Third-party (user) plugins are not written by us and are outside this policy — review them before installing.

## 5. What Equicord never does

- No telemetry, analytics, crash reporting or "phone home" of any kind.
- No collection, profiling or selling of personal data.
- No ads, no trackers, no bundled SDKs doing any of the above.

## 6. Minimising network activity

- Do not enable cloud settings sync.
- Keep plugins that fetch external data disabled.
- The web extension's Updater tab only contacts GitHub when you click "Check for Updates".
- Building from source downloads dependencies from npm's registry and GitHub; their privacy policies apply to those requests.

## 7. Third-party policies

- Discord: https://discord.com/privacy
- GitHub: https://github.com/privacy
- Equilotl (installer): https://github.com/Equicord/Equilotl
- Any cloud sync instance you configure — see its own policy

## 8. Changes

This policy may be updated as the project evolves. Material changes are documented in the repository history.
