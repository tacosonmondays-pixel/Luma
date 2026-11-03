# Luma

A personal music player. A React web app (installed to the iPhone Home Screen, also works on desktop) plus a tiny helper server that runs on the owner's computer, serves the app, and uses the owner's installed `yt-dlp` to search YouTube and fetch audio. Songs are saved on the device (IndexedDB) and play offline.

## Commands

- `npm run dev` — app and API on http://localhost:4848 (the API is mounted into Vite's dev server)
- `npm start` — production build served by the helper (`server/index.ts`)
- `npm run check` — typecheck, tests, build. CI runs this; keep it green.

## Layout

- `src/types.ts` — shared data shapes, also imported (type-only) by the server
- `src/lib/` — state and logic, no JSX
  - `library.ts` songs, playlists, profile, background (zustand, persisted to IndexedDB)
  - `player.ts` playback: one `<audio>` element + a zustand store; commands are exported functions
  - `queue.ts` pure queue logic · `blobs.ts` IndexedDB blobs and object URLs · `router.ts` · `format.ts`
  - `files.ts` import local audio · `helper.ts` helper API client and downloads · `titles.ts` clean YouTube titles
- `src/ui/` — shared components: `Icon`, `Art` (covers, avatar), `kit` (IconButton, Link, pickFiles), `Menu`, `Nav`, `PlayerBar`, `NowPlaying`, `Transport`
- `src/views/` — one file per screen: `Songs`, `Playlists`, `Playlist`, `Search`, `You`
- `src/styles/` — `base.css` (tokens, reset, shell) and one file per feature (`player.css`, `library.css`, `search.css`), imported by the component that uses it
- `server/` — `api.ts` (connect-style middleware) and `index.ts` (production entry, static files)
- `public/` — manifest, service worker, icons · `test/` — Vitest

## Rules

Design
- Simple purpose, simple architecture, simple design, simple implementation. References: Apple Music, Spotify, Linear, Apple Notes.
- No taglines, helper text or secondary labels (counts, subtitles, descriptions). If a screen needs them to make sense, fix the layout.
- Icon-only buttons carry an `aria-label`. Dark theme only. Colors, radii and easing come from the tokens in `base.css`.
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
