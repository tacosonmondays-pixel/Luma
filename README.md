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

## iPhone only

Luma also runs with no computer, from GitHub Pages.

1. Make this repository public, set **Settings → Pages → Source** to **GitHub Actions**, and merge to `main`. Luma is then at https://tacosonmondays-pixel.github.io/Luma/. Open it in Safari and **Add to Home Screen**.
2. In [Google Cloud](https://console.cloud.google.com), enable the **YouTube Data API v3** and create an API key. Restrict it to the HTTP referrer `https://tacosonmondays-pixel.github.io/*` and to the YouTube Data API v3. Paste it into **You → YouTube Key**.
3. To save songs, install [a-Shell](https://holzschu.github.io/a-Shell_iOS/) and run `pip install -U yt-dlp mutagen` in it. Then, in Shortcuts, make a shortcut named **Save to Luma**:
   - Turn on **Show in Share Sheet**, receiving **URLs** and **Text**.
   - Add a-Shell's **Execute Command** action with **Open a-Shell** on, and this command, with **Shortcut Input** in place of `<Shortcut Input>`:
     ```
     cd ~/Documents && mkdir -p Luma && cd Luma && python3 -m yt_dlp -f "ba[ext=m4a]/ba" --embed-metadata --embed-thumbnail --convert-thumbnails jpg -o "%(artist,uploader)s - %(title)s [%(id)s].%(ext)s" "<Shortcut Input>"
     ```
   - Add **Open URLs** with `https://tacosonmondays-pixel.github.io/Luma/search`.

   The download button in Search runs the shortcut. Back in Luma, tap **Import** and pick the files from **On My iPhone → a-Shell → Luma**.

Only save music you have the right to download.

## iPhone app

Luma also comes as an app, `Luma.ipa`: from the [latest Release](https://github.com/tacosonmondays-pixel/Luma/releases/latest), or from the **Luma-ipa** artifact of the newest [iOS run](https://github.com/tacosonmondays-pixel/Luma/actions/workflows/ios.yml).

It's unsigned, so install it with a sideloading tool, which signs it for you:
- [Signulous](https://www.signulous.com): lasts a year.
- [AltStore](https://altstore.io), [SideStore](https://sidestore.io) or [Sideloadly](https://sideloadly.io): work with a free Apple ID, but re-sign every 7 days.

The app keeps its own library, separate from the Home Screen web app.

For search, restrict your YouTube key to **iOS apps** with the bundle ID `com.tacosonmondays.luma`, or make a second key for the app. In the **Save to Luma** shortcut, the last step can open `luma://search` instead.

## Develop

`npm run dev` runs the app and its API with hot reload. `npm run check` runs the typecheck, tests and build. [AGENTS.md](AGENTS.md) covers the architecture and conventions.
