# Luma

A personal music player. A React web app (installed to the iPhone Home Screen, also works on desktop) plus a tiny helper server that runs on the owner's computer, serves the app, and uses the owner's installed `yt-dlp` to search YouTube and fetch audio. Songs are saved on the device (IndexedDB) and play offline.

Two modes, chosen in one place (`src/lib/source.ts`): if `${BASE_URL}api/health` answers, the helper searches and downloads (helper mode). Otherwise (GitHub Pages, iPhone only) search uses the YouTube Data API v3 with the owner's key, and downloads go through the "Save to Luma" iOS Shortcut (yt-dlp in a-Shell); the files come back in through Import (phone mode).

## Commands

- `npm run dev` — app and API on http://localhost:4848 (the API is mounted into Vite's dev server)
- `npm start` — production build served by the helper (`server/index.ts`)
- `npm run check` — typecheck, tests, build. CI runs this; keep it green.
- `LUMA_BASE=/Luma/ npx vite build` — the GitHub Pages build (`.github/workflows/pages.yml` deploys it from main). It also writes `dist/404.html` for deep links.

Base path: Vite's `base` comes from `LUMA_BASE` (default `/`, which the helper uses). Never hard-code `/`: app paths go through `router.ts` (`href`, `navigate`, `usePath` strip and add the base), other URLs use `import.meta.env.BASE_URL`, `public/sw.js` works relative to its scope, and the manifest uses relative URLs.

## Layout

- `src/types.ts` — shared data shapes, also imported (type-only) by the server
- `src/lib/` — state and logic, no JSX
  - `library.ts` songs, playlists, profile, background (zustand, persisted to IndexedDB)
  - `player.ts` playback: one `<audio>` element + a zustand store; commands are exported functions
  - `queue.ts` pure queue logic · `blobs.ts` IndexedDB blobs and object URLs · `router.ts` · `format.ts`
  - `source.ts` helper or phone mode: search, thumbnails, downloads, Import · `helper.ts` helper API client and downloads · `youtube.ts` YouTube Data API search and the key
  - `files.ts` import local audio (M4A tags and cover, `[<YouTube id>]` in the file name) · `titles.ts` clean YouTube titles
- `src/ui/` — shared components: `Icon`, `Art` (covers, avatar), `kit` (IconButton, Link, pickFiles), `Menu`, `Nav`, `PlayerBar`, `NowPlaying`, `Transport`
- `src/views/` — one file per screen: `Songs`, `Playlists`, `Playlist`, `Search`, `You`
- `src/styles/` — `base.css` (tokens, reset, shell) and one file per feature (`player.css`, `library.css`, `search.css`), imported by the component that uses it
- `server/` — `api.ts` (connect-style middleware) and `index.ts` (production entry, static files)
- `public/` — manifest, service worker, icons · `test/` — Vitest (`test/fixtures/` audio made with ffmpeg)

## Rules

Design
- Simple purpose, simple architecture, simple design, simple implementation. References: Apple Music, Spotify, Linear, Apple Notes.
- No taglines, helper text or secondary labels (counts, subtitles, descriptions). If a screen needs them to make sense, fix the layout.
- Icon-only buttons carry an `aria-label`. Dark themes, plus the light Y2K theme. Colors, radii and easing come from the tokens in `base.css`.
- Customization (themes, cover colors, player styles, the profile, badges) follows `docs/customization-spec.md`; its mockups are in `docs/mockups/`. Third-party files (fonts, icon paths, palettes) get a license file in `licenses/`.
- Motion is quick and subtle (press scale, slide, fade) and respects `prefers-reduced-motion`.

Code
- No new dependencies without a strong reason. State lives in zustand stores; actions are plain exported functions.
- Blobs live in IndexedDB under `audio:<id>`, `cover:<id>`, `playlist-cover:<id>`, `avatar`, `banner`, `background`. Metadata stores a version (`Date.now()`) per blob; bump it to replace the blob.
- `server/*.ts` runs under Node's type stripping: erasable syntax only, `.ts` extensions on relative imports, `import type` for types, Node built-ins only.
- Verify UI changes with screenshots at 393×852 (iPhone) and 1440×900 (desktop). In dev you can seed data from Playwright with `page.evaluate(async () => (await import('/src/lib/library.ts')).addTrack(...))`.

iPhone constraints (deliberate; don't "fix" them)
- No Web Audio in the playback path: it stops audio on the lock screen.
- `audio.loop` is always on and a wrap to 0:00 counts as the track ending. This keeps background audio alive across track changes.
- Don't register `seekbackward`/`seekforward` Media Session actions: on iOS they replace previous/next on the lock screen.
- `audio.volume` is read-only on iOS (`volumeLocked` in `player.ts`); hide volume controls there.
- On plain http (LAN) there is no `crypto.randomUUID` and no service worker. Use `uid()` from `format.ts`.
