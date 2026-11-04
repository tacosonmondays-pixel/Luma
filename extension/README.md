# Luma for YouTube

A Chrome and Edge extension (Manifest V3, plain JavaScript, no build step). It adds **Save to Luma** next to Like and Share on YouTube and YouTube Music watch pages, and **Save playlist to Luma** to playlist headers. Clicking opens `<Luma URL>save?u=<link>` in your Luma tab (or a new one), and Luma saves the song or playlist.

Options (click the toolbar icon):
- **Luma URL**: **This computer** (`http://localhost:4848/`, Luma.exe or `npm start`; the dot is green while it runs) downloads straight away. **Website** (`https://tacosonmondays-pixel.github.io/Luma/`) saves the songs to download later.
- **Auto-save liked videos** (off by default): liking a video saves it to Luma in the background. Only a like you click counts, never one that was already there when the page loaded.

Install: see "YouTube extension" in the main README.

## Permissions

- `storage`: remembers the Luma URL and the auto-save setting.
- `tabs`: finds the Luma tab that's already open, to send the link there instead of opening another one.
- `https://www.youtube.com/*`, `https://music.youtube.com/*`: adds the button to YouTube pages and reads which video or playlist is open. Nothing is sent anywhere except to your Luma tab.
- `http://localhost:4848/*`: checks whether Luma is running on this computer (`/api/health`).

## Files

- `manifest.json`, `background.js` (opens or reuses the Luma tab), `settings.js` (shared settings).
- `content.js` + `content.css`: the button and auto-save. YouTube rebuilds its pages without reloading, so it re-checks after `yt-navigate-finish` and DOM changes.
- `options.html`, `options.js`, `options.css`.

Tested with `node test/e2e/extension.mjs`, against a local page that copies YouTube's markup. YouTube changes its markup from time to time; if the button stops appearing, the selectors at the top of `content.js` need updating.
