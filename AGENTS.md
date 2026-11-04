# Luma

A personal music player. A React web app (installed to the iPhone Home Screen, also works on desktop) plus a tiny helper server that runs on the owner's computer, serves the app, and uses the owner's installed `yt-dlp` to search YouTube and fetch audio. Songs are saved on the device (IndexedDB) and play offline.

An optional server on Supabase adds sign-in (6-digit email codes), library backup and sync, and public profile pages at `/u/<handle>`. Writes are invite-only. Signed out or offline, everything works as before. `docs/server.md` is the contract (schema, policies, RPCs, storage); `supabase/README.md` is the owner's setup.

Two modes, chosen in one place (`src/lib/source.ts`): if `${BASE_URL}api/health` answers, the helper searches and downloads (helper mode). Otherwise (GitHub Pages, iPhone only) search uses the YouTube Data API v3 with the owner's key, and downloads go through the "Save to Luma" iOS Shortcut (yt-dlp in a-Shell); the files come back in through Import (phone mode). Phone mode only exists where the Shortcut runs (iPhone, iPad, the iOS app): on a PC, a missing helper is offline, and the next search or download looks for it again.

## Commands

- `npm run dev` — app and API on http://localhost:4848 (the API is mounted into Vite's dev server)
- `npm start` — production build served by the helper (`server/index.ts`)
- `npm run check` — typecheck, tests, build. CI runs this; keep it green. Includes the database tests (`test/db/`), which run every `supabase/migrations/*.sql` in order on PGlite with stubbed Supabase roles, auth and storage.
- `LUMA_BASE=/Luma/ npx vite build` — the GitHub Pages build (`.github/workflows/pages.yml` deploys it from main). It also writes `dist/404.html` for deep links.

Base path: Vite's `base` comes from `LUMA_BASE` (default `/`, which the helper uses). Never hard-code `/`: app paths go through `router.ts` (`href`, `navigate`, `usePath` strip and add the base), other URLs use `import.meta.env.BASE_URL`, `public/sw.js` works relative to its scope, and the manifest uses relative URLs.

## Layout

- `src/types.ts` — shared data shapes, also imported (type-only) by the server
- `src/lib/` — state and logic, no JSX
  - `library.ts` songs, playlists, profile, wallpaper, per-song canvas (zustand, persisted to IndexedDB)
  - `player.ts` playback: one `<audio>` element + a zustand store; commands are exported functions
  - `queue.ts` pure queue logic · `blobs.ts` IndexedDB blobs and object URLs · `router.ts` · `format.ts`
  - `source.ts` helper or phone mode: search, thumbnails, downloads, Import · `helper.ts` helper API client and downloads · `youtube.ts` YouTube Data API search and the key
  - `files.ts` import local audio (M4A tags and cover, `[<YouTube id>]` in the file name) · `titles.ts` clean YouTube titles
  - `appearance.ts` theme, cover colors, player style (localStorage) · `palette.ts` accent and wash from cover art
  - `crop.ts` the profile images' crop (focus point + zoom, stored as data; `.crop` in `base.css` draws it)
  - `media.ts` profile, canvas and post media: resize, stills, animation detection, size caps, a video's metadata (location) stripped · `gif.ts` + `gif.worker.ts` video → GIF
  - `plays.ts` the play log (`luma-plays`) · `stats.ts` On Repeat and badges
  - `save.ts` Save to Luma: `/save?u=` links, saved songs, linked playlists (`Playlist.youtubeId`) and Refresh from YouTube · `google.ts` + `google-config.ts` Connect YouTube (Google Identity Services token client; hidden while the client ID is empty)
  - `home.ts` Home's shelves: order, visibility, custom search shelves, playlists played (zustand, `luma-home` in localStorage) · `shelves.ts` what each shelf holds (pure) · `feed.ts` the network shelves (Mix, New from Your Artists, search shelves), cached per day in IndexedDB (`luma-home`)
  - `supabase.ts` project URL, publishable key, lazy client, `mediaUrl` · `account.ts` session and `profiles` row: sign-in with email codes, invites, handle · `sync.ts` backup and sync (last write wins), profile media, shared plays · `search-link.ts` open Search with a query
  - `social.ts` follows, friends' plays and posts (the feed), people, profile posts, Luma search, reports; the gates `useOnline`, `useSignedIn`, `useMe` (nothing social is persisted) · `posting.ts` publish a post or video (uploads with progress), delete, the orphan sweep · `moderation.ts` admins: reports, Remove, Ban, Dismiss, invites · `viewer.ts` the Viewer's store (`openPost`, `closePost`) and what it plays (`playable`: a picture, 60 s at most)
- `src/ui/` — shared components: `Icon`, `Art` (covers, avatars), `kit` (IconButton, Link, pickFiles, wrapTab, Boundary), `Sheet` (the shared sheet: focus in, Tab kept in, focus back), `Menu`, `Nav`, `People` (nameplates, person cards, faces, the Following and Followers sheet, a profile's More menu), `Post` (post cards, a profile's grid), `Viewer` (one post over everything, hosted in `App.tsx`), `Composer` (New Post), `Rename` (a song's title and artist, hosted in `App.tsx`), `Reports` (admins), `Shelf` (Home's shelves, rows, cards, the next-page sentinel), `ResultTile` (YouTube results and other songs as rows and tiles), `EditHome`, `PlayerBar`, `NowPlaying` (Color, Vinyl, Canvas), `Wash`, `Transport`, `Appearance`, `Badges`, `GifMaker`, `Account` (the account rows and sign-in sheet), `YouTube` (Connect YouTube row and playlist sheet), `Ring` (download progress)
  - `ui/profile/` the profile card, editor, crop sheet (`ImageCrop`), frames, effects and name styles · `ui/y2k/` the Y2K theme's extra markup (LCD)
- `src/views/` — one file per screen: `Home` (`/`), `Songs` (`/songs`), `Playlists`, `Playlist`, `Search`, `You`, `User` (someone's public profile, `/u/:handle`), `Save` (`/save?u=<YouTube link>`)
- `src/styles/` — `base.css` (tokens, reset, shell), `themes.css` (dark themes), `y2k.css` (the light Y2K theme, all scoped to `[data-theme='y2k']`), and one file per feature (`player.css`, `wash.css`, `library.css`, `search.css`, `profile.css`, `home.css`, `youtube.css`, `badges.css`, `appearance.css`, `gif.css`, `social.css`), imported by the component that uses it
- `src/assets/fonts/` — bundled OFL fonts (name styles, the Y2K LCD)
- `server/` — `api.ts` (connect-style middleware: health, search, `mix/:id` (YouTube's radio mix), audio, cover), `index.ts` (production entry, static files), `exe.ts` + `setup.ts` (Windows Luma.exe: embedded app, first-run yt-dlp and Deno)
- `extension/` — "Luma for YouTube", the Chrome/Edge extension (MV3, plain JS, no build); `release.yml` zips it into `Luma-for-YouTube.zip`
- `public/` — manifest, service worker, icons · `test/` — Vitest (`test/fixtures/` media made with ffmpeg, `test/db/` RLS on PGlite, `test/client/` account and sync against a fake supabase-js, `test/e2e/` Playwright scripts run by hand: `node test/e2e/app.mjs`, `node test/e2e/extension.mjs` and `node test/e2e/social.mjs` (the social screens against a pretend Supabase, with screenshots))
- `supabase/` — `migrations/` (`0001_luma.sql`, `0002_social.sql`: pasted into the SQL Editor in order; each idempotent) and `README.md`
- `docs/` — `server.md` (the server contract), `youtube-signin.md` (the Google client for Connect YouTube), `customization-spec.md` and `mockups/` · `licenses/` — one license file per third-party font, icon set or palette

## Rules

Design
- Simple purpose, simple architecture, simple design, simple implementation. References: Apple Music, Spotify, Linear, Apple Notes.
- No taglines, helper text or secondary labels (counts, subtitles, descriptions). If a screen needs them to make sense, fix the layout.
- Icon-only buttons carry an `aria-label`. Dark themes, plus the light Y2K theme. Colors, radii and easing come from the tokens in `base.css`.
- Customization (themes, cover colors, player styles, the profile, badges) follows `docs/customization-spec.md`; its mockups are in `docs/mockups/`. Third-party files (fonts, icon paths, palettes) get a license file in `licenses/`.
- Motion is quick and subtle (press scale, slide, fade) and respects `prefers-reduced-motion`.

Code
- No new dependencies without a strong reason. (`@supabase/supabase-js` is the one for the server, loaded lazily so signed-out starts never fetch it.) State lives in zustand stores; actions are plain exported functions.
- Blobs live in IndexedDB under `audio:<id>`, `cover:<id>`, `canvas:<id>` (plus a `canvas-still:<id>` JPEG while it is an animated image), `playlist-cover:<id>`, `background` (the wallpaper), and the profile's `avatar`, `banner`, `backdrop`, each with a `<key>-still` JPEG while it is animated or a video. Metadata stores a version (`Date.now()`) per blob; bump it to replace the blob. The play log lives in its own `luma-plays` store.
- A song in the library without its audio (`Track.missing`: saved from YouTube, or synced) is never queued; it downloads with whichever downloader there is (`source.ts` `downloadSaved`/`downloadMissing`).
- Song audio is never uploaded, anywhere. The server holds metadata (library sync, pins, plays) and images and videos (the `media` bucket), never audio. A synced song arrives as `Track.missing` (not downloaded) until it is downloaded again. Never stream audio from the server.
- The server is optional: no local feature may depend on it, and sync must never block or break offline use. Never commit a secret or the service key; the publishable key in `supabase.ts` is public. Schema changes go in a new idempotent `supabase/migrations/000N_….sql` with tests in `test/db/`, and `docs/server.md` changes with them. Migrations run in order, every one, every time: after any run of 0001, run each later file again. Anything a policy calls lives in `public`, never `luma` (a lone run of 0001 revokes `luma`'s functions).
- `server/*.ts` runs under Node's type stripping: erasable syntax only, `.ts` extensions on relative imports, `import type` for types, Node built-ins only.
- Verify UI changes with screenshots at 393×852 (iPhone) and 1440×900 (desktop). For server features, mock Supabase in Playwright with `context.route('https://kbdevcrqrjnqxsfeszbe.supabase.co/**', …)`; the sandbox can't reach supabase.co. In dev you can seed data from Playwright with `page.evaluate(async () => (await import('/src/lib/library.ts')).addTrack(...))`.

iPhone constraints (deliberate; don't "fix" them)
- No Web Audio in the playback path: it stops audio on the lock screen.
- `audio.loop` is always on and a wrap to 0:00 counts as the track ending. This keeps background audio alive across track changes.
- Don't register `seekbackward`/`seekforward` Media Session actions: on iOS they replace previous/next on the lock screen.
- `audio.volume` is read-only on iOS (`volumeLocked` in `player.ts`); hide volume controls there.
- On plain http (LAN) there is no `crypto.randomUUID` and no service worker. Use `uid()` from `format.ts`.
