# Luma

A clean music player for your iPhone and computer. Search, save songs into the app, and play them offline.

## Windows

Download [Luma.exe](https://github.com/tacosonmondays-pixel/Luma/releases/latest/download/Luma.exe) and run it. Nothing else to install: the first run downloads the tools it uses (yt-dlp and Deno), then Luma opens in your browser. Closing its window stops Luma.

The exe is unsigned, so Windows shows "Windows protected your PC". Click **More info**, then **Run anyway**.

(Free code signing for open-source projects exists, from the [SignPath Foundation](https://signpath.org), if we want it later.)

## Set up

1. Install [Node.js](https://nodejs.org) 22.18 or newer.
2. Install yt-dlp:
   - Windows: `winget install yt-dlp`
   - macOS: `brew install yt-dlp`
3. In a new terminal (so it finds yt-dlp), in this folder, run:
   ```
   npm install
   npm start
   ```
4. Open the address it prints, such as `http://localhost:4848`.

Keep yt-dlp up to date (`winget upgrade yt-dlp` or `brew upgrade yt-dlp`). If search or saving stops working, updating yt-dlp usually fixes it.

## On your iPhone

To use Luma from your phone, at home or away, run it through [Tailscale](https://tailscale.com) (free):

1. Install Tailscale on your computer and your iPhone, and sign in on both.
2. On the computer, run `tailscale serve --bg 4848`. It prints an `https://….ts.net` address.
3. Open that address in Safari, tap Share, then **Add to Home Screen**.

Saved songs stay on your phone and play offline, including from the lock screen. Searching and saving new songs needs the computer to be on.

Only save music you have the right to download.

## Develop

`npm run dev` runs the app and its API with hot reload. `npm run check` runs the typecheck, tests and build. [AGENTS.md](AGENTS.md) covers the architecture and conventions.
