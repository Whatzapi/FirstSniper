# FirstSniper

Joins Roblox private-server links the moment they appear in Discord channels you choose. There is no Discord window: the app reads messages in the background, joins with `roblox://`, and alerts you.

> **Disclaimer.** Not affiliated with Roblox or Discord. Use at your own risk. Automating a Discord *user* account (account token) is against Discord's Terms of Service and can get the account banned. A bot token is the safer option.

## Quick start (Windows)

1. Install [Node.js](https://nodejs.org) (LTS).
2. Download this repo (or the release zip) and extract it.
3. Double-click `FirstSniper.bat` (the first run installs what it needs and downloads Electron).
4. **Settings** tab → paste your Discord token → Connect.
5. **Channels** tab → **+ Add channel** → pick server, channel and keywords.
6. Press the big button so it says **ARMED**.

## Tabs

| Tab | What it does |
| --- | --- |
| **Channels** | Server + channel + keywords. Per channel: *Watch*, *Always join (even when unarmed)*, *Apply delay*. |
| **Timed** | One channel that re-arms itself on a timer. After each join it goes unarmed, then arms again after the wait you set (seconds/minutes/hours), until you switch it off. The big ARMED button is disabled while it is on. Always off at startup. |
| **Alerts** | Sound (default chime or your own file), volume, test. |
| **Settings** | Discord connection, hotkey, one-shot, always-on-top, join delay (0 ms – 10 s), "Join a link now". |

## Keywords

Each keyword becomes a removable tag. Empty = any link in that channel.

| Syntax | Meaning |
| --- | --- |
| `word` | Matches part of a word too (`ser` matches `server`). Several plain words = any of them. |
| `+word` | Must contain it |
| `-word` | Must **not** contain it |
| `/regex/` | Regular expression |

Case is ignored.

## Delay

Waits that long (0 ms – 10 s) before launching, for channels with *Apply delay* ticked. Press the big button to cancel a waiting join. "Join a link now" is always instant.

## Links detected

Plain links, hidden/blue-text links (markdown, embeds, buttons, forwarded messages), and `share`, `share-links`, `privateServerLinkCode` and `roblox://` formats. The app never reads your clipboard.

## Privacy

Your token is stored encrypted on your computer only and is sent nowhere except Discord. Never share your token or settings folder.

## Build a single `.exe`

Run `build-exe.bat`. It installs the packaging tool and writes `dist/FirstSniper.exe` (unsigned, so Windows SmartScreen will warn).

## License

MIT
