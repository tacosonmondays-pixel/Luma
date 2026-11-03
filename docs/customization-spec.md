# Customization spec

> **Amendments from the owner's choices (these win over anything below):**
> - **Player style** is a three-way choice, not a Vinyl switch: `playerStyle: 'color' | 'vinyl' | 'canvas'` in `src/lib/appearance.ts` (Color is the default, the "Living Color" wash). The Appearance group's third row is a segmented control Color · Vinyl · Canvas.
> - **Canvas**: a looping image, GIF or video per song (`Track.canvas` / `Track.canvasKind`, blob `canvas:<id>`), set from the song menu ("Set Canvas" / "Remove Canvas"), shown full-bleed behind Now Playing when the Canvas style is on; songs without one fall back to the Color wash. Mockup: `docs/mockups/canvas/`.
> - **Themes**: the five dark themes below plus **Y2K**, a light early-2000s glossy theme with its own player skin (LCD title display, gel buttons, sky-and-hill backdrop), built as WP-D. Mockup: `docs/mockups/y2k/`. AGENTS.md's "dark only" rule now reads "dark themes plus Y2K".
> - **Name styles** (`NameStyleId`): shimmer, aurora, chrome, neon, glitch, wave, pop, sparkle, outline, pixel, script — music-video title-card energy (an MV-style text-effect preset inspired the list), all original CSS. Each plays briefly after the card appears, then rests; reduced motion shows the still.
> - **Lyrics** are on hold until the lyrics source's terms are confirmed (mockup kept at `docs/mockups/lyrics/` for later).
> - **Licenses**: third-party files go under `licenses/` (one file each), not a single THIRD_PARTY_NOTICES.md, so parallel packages don't collide. The lead compiles the index after merge.
> - Paths in this document that point into a scratchpad (`/tmp/...`) were the research workspace and aren't in the repo; the palette licenses are already in `licenses/`.
> - The fullscreen Color style should look like `docs/mockups/living-color/` (its technique notes are in section D2 and in that file).

# Luma: cover-colored look and a Discord-style profile

Spec date: 2026-11-03. It is based on the four research passes (spicetify, references, discord, assets), a review pass, and the current Luma code.

Saved at `/tmp/claude-0/-home-user-Luma/006462e7-7095-5f92-a2eb-f6d6ebec3cd2/scratchpad/research/spec-final.md`. The palette license files used in section 2 are in `research/spec/licenses/`. The review's license copies, fetched on 2026-11-03, are in `research/review/licenses/` and `research/review/npm/`, and their URLs are listed in `research/review/sources.txt`.

Read before building:
- Branch from `claude/elegant-sagan-6gjqzc` at `82fd777` or later, not from `main`. `main` still holds only the initial commit. The integration branch already has:
  - the UI review fixes (task #6, `696e6d0`);
  - the on-device video-to-GIF maker (task #11: `src/lib/gif.ts`, `gif.worker.ts`, `src/ui/GifMaker.tsx`, `src/styles/gif.css`, with `gifenc` 1.0.3, MIT);
  - Luma.exe (task #10).
- The profile uses the GIF maker as it is: a video picked for the avatar or banner becomes a GIF (section 3). Nothing in this spec changes the GIF maker's files.
- Two rules in AGENTS.md shape this spec and win over the research suggestions:
  - **Dark theme only.** No Light mode, no Catppuccin Latte, no "follow system".
  - **No new dependencies without a strong reason.** Color sampling, effects, frames and badges are our own code. Fonts and glyphs are copied in as files, with their license notices. Nothing new goes into `package.json`.
- Nothing here copies Discord or Spotify art, names or branding. The reference screenshots in `research/references/img/` show Spotify's interface and other people's album art. Use them only to look at; never ship or trace them.

---

## 1. Defaults inspired by Spicetify

These are on out of the box. They are the most common Spicetify customizations: about 14 Marketplace items take colors from the cover and about 15 put the cover behind the player. For Luma they cost almost nothing, because covers are local files and sampling one takes about 1 ms. They are defaults rather than settings because each one makes every song look right with no effort from the user. The only switch the Appearance group offers for them is Cover Colors, for people who want a fixed theme accent (section 2).

### D1. Accent color from the cover

What it does: `--accent` follows the cover of the current song, app-wide.

How the color is picked (`src/lib/palette.ts`):
1. Decode the cover with `createImageBitmap(blob)`.
2. Shrink it in two steps so the sample is smooth: draw it at 96×96, then draw that at 12×12. This gives 144 pixels.
3. Convert each pixel to OKLCH. Skip pixels with L < 0.20 or L > 0.95.
4. Sort the rest into 12 hue bins of 30°. Weight each pixel by `C × (1 − |L − 0.6|)`.
5. Take the heaviest bin. Its hue is the weighted circular mean; its chroma is the weighted mean C.
6. If that chroma is below 0.04, the cover is grey: return no accent, and Luma uses the theme's accent.
7. Otherwise the accent is `oklch(0.76 clamp(0.08, C, 0.15) h)`.
   - Lower C in 0.005 steps until the color fits in sRGB, then return it as `#rrggbb`. At L 0.76, C 0.15 falls outside sRGB for reds, cyans, blues and purples, where the maximum is 0.12–0.145.
   - Checked over every hue: at least 8.5:1 contrast on Luma's background and at least 5.4:1 on Fjord's (`#2e3440`), the lightest theme background.
8. Cache the result per `blobKey:version`, keeping the 64 most recent. The wash (D2) is cached with it as a data URL, so there is nothing to revoke.

How it is applied (`src/lib/appearance.ts`):
- It subscribes to the current track. With Cover Colors on, it sets `document.documentElement.style.setProperty('--accent', accent)`.
- With Cover Colors off, or no accent (grey cover, no cover), it removes the inline value so the theme's accent shows: `:root { --accent: var(--theme-accent); }` in `base.css`.
- **No `@property` fade on `:root`.** An inherited custom property animating on `:root` restyles every element on every frame. Luma's song list isn't virtualized, so with 2,000 songs that means tens of thousands of elements per frame on the iPhone.
  - The color change is smoothed where it shows instead. The tinted glass and the active sidebar link get `transition: background-color 600ms var(--ease)`.
  - The Now Playing wash cross-fades (D2).
  - Scrubbers change at once.

Where the accent shows:

| Place | Value | File |
|---|---|---|
| Now Playing scrubber and volume fill | `--fill: color-mix(in oklab, var(--accent) 65%, #fff)` (a tinted white). While dragging: `var(--accent)` | `player.css` |
| Mini player progress line | `background: color-mix(in oklab, var(--accent) 65%, #fff)` | `player.css` |
| Desktop bar scrubber on hover | `--fill: var(--accent)` | `player.css` |
| Shuffle and repeat when on | `var(--accent)` (already wired) | none |
| Mini player and desktop bar glass | `background-color: color-mix(in oklab, var(--accent) 8%, var(--glass))`, with the 600 ms transition | `player.css` |
| Active sidebar link | `background-color: color-mix(in oklab, var(--accent) 18%, var(--fill))`, with the 600 ms transition | `base.css` |
| Focus rings, switches | `var(--accent)` | `base.css`, `appearance.css` |
| Profile card when its colors are Auto and there is no avatar or banner | derived from `--accent` (section 3) | `profile.css` |

The play button stays white, as in Apple Music. The playing-bars overlay on list covers also stays white, because it sits on top of artwork.

### D2. Cover backdrop on Now Playing, without a live blur

Today `.np-wash img` runs `filter: blur(70px) saturate(1.8) brightness(0.62)` on a layer 150% of the screen. Replace it with what Lucid does: soften the cover once, then only move the result. Bloom still uses a live CSS blur, which is exactly what we are removing.

The wash image, made once per cover in `palette.ts` and cached with the accent:
1. Draw the 12×12 sample up to a 64×64 canvas with `imageSmoothingQuality = 'high'`.
2. In one JS pass over the 64×64 pixels:
   - run two passes of a 3-pixel box blur, which removes the cross-shaped artifacts that bilinear upscaling leaves;
   - multiply saturation by 1.4 and brightness by 0.62;
   - add ±1 of random noise to each channel, so dark gradients don't band on OLED screens.
3. Save it with `canvas.toDataURL('image/png')`, about 7 KB.

No cover: use the existing `gradientFor(title + artist)` fill, with no filter.

The `Wash` component (`src/ui/Wash.tsx`, new) is used by Now Playing and Playlist:
- It renders `<div class="wash">` holding the current wash `<img>`, plus the previous one while it fades.
- A new wash fades in over 600 ms on top of the old one. The old one is removed on `animationend`. This replaces today's fade from black.
- Keep the existing dark overlay `linear-gradient(rgba(0,0,0,.12), rgba(0,0,0,.55))`.
- **Now Playing, always in motion:**
  - Two copies of the wash, each a square box larger than the screen's diagonal: `position: absolute; left: 50%; top: 50%; width: 150vmax; height: 150vmax; margin: -75vmax 0 0 -75vmax;`.
  - No `filter`, `mask`, `border-radius` or `object-fit` on them. A plain bitmap `<img>` lets WebKit hand the 64×64 image to the GPU and scale it there. Otherwise it would paint a full-screen backing store, about 25 MB at 3×.
  - `.wash .a { animation: wash-turn 64s linear infinite; }`
  - `.wash .b { opacity: .55; transform-origin: 30% 70%; animation: wash-turn 90s linear infinite reverse; }`
  - `@keyframes wash-turn { from { transform: rotate(0) scale(1.3); } to { transform: rotate(1turn) scale(1.3); } }`
  - Transform only, so nothing is repainted per frame.
  - It runs only while `.np.open`; otherwise `animation-play-state: paused`.
  - Under reduced motion it is one still copy.
- **Playlist (D5):** one still copy, `inset: 0; width: 100%; height: 100%; object-fit: cover`.
- There is no Backdrop setting. Motion is the look, and reduced motion gives the still.
- Acceptance:
  - At 393×852, a high-contrast cover shows no visible blocks, crosses or banding. If it does, raise the sample to 16×16. Never put a CSS blur back on a moving layer.
  - On a real iPhone, Safari Web Inspector's Layers tab shows each wash layer well under 1 MB. If it shows full-screen backing stores, keep only copy `.a`.

### D3. Glow behind the cover (Spicetify's "ambience")

- Add `<img class="np-glow">` inside `.np-stage`, behind `.np-art`, using the same wash URL.
- CSS: `position: absolute; width: min(100cqw, 100cqh); aspect-ratio: 1; transform: scale(1.18); opacity: .6; -webkit-mask-image: radial-gradient(closest-side, #000 35%, transparent); mask-image: same;`
- No filter.
- It shares the art's play/pause scale: put it in a wrapper with `.np-art` (or the Vinyl record), and move the transform to the wrapper.

### D4. A fuller Now Playing on desktop

- Under `@media (min-width: 1100px) and (min-height: 700px)`, the sheet becomes two columns, like Spicetify's Full App Display:
  - `.np-sheet { max-width: 1080px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; grid-template-rows: 44px 1fr; column-gap: 72px; align-items: center; }`
  - `.np-top { grid-column: 1 / -1; }`
  - `.np-stage { height: min(560px, 70dvh); }`
  - The meta, scrubber, transport and volume move into one new wrapper, `<div class="np-controls">`, in column 2.
- Phones keep the current single column, plus D2, D3 and the accent.
- Desktop only. iPhone gets nothing extra here:
  - The installed PWA is already full screen, and the Fullscreen API on iPhone only works for video.
  - No separate "TV mode".

### D5. Cover wash behind playlist headers (Comfy and Galaxy style)

- `Playlist.tsx` gives its `<section>` the class `playlist` and renders `<Wash className="playlist-wash" still />` as the section's first child. All the CSS goes in `wash.css`, because `library.css` belongs to WP-B:
  - `.playlist { position: relative; isolation: isolate; }`
  - `.playlist-wash { position: absolute; top: -36px; left: -40px; right: -40px; height: 360px; opacity: .55; z-index: -1; pointer-events: none; -webkit-mask-image: linear-gradient(#000 30%, transparent); mask-image: linear-gradient(#000 30%, transparent); }`
  - Under `max-width: 899px`: `top: calc(-1 * (var(--safe-top) + 24px)); left: calc(-1 * var(--gutter)); right: calc(-1 * var(--gutter));`
- The art comes from the playlist's cover, else its first song's cover, else nothing.
- Skipped when a Wallpaper is set, because there is already an image behind the page.
- Never behind the song list. Putting a busy image behind a dense list is the mistake the research warns about.

### Already in Luma (keep, don't add again)

- Floating glass mini player (8px inset, 14px radius).
- Scrubber that grows from 4px to 9px while dragging.
- Global reduced-motion rule.
- Fisher–Yates shuffle (`queue.ts`).

### Not adopted, and why

- **Synced lyrics.** It is the most-starred extension, but Luma has no lyrics source. YouTube downloads carry none, and M4A lyric tags are rare and unsynced. Revisit with `.lrc` import as its own task.
- **Visualizers.** They need Web Audio, which breaks lock-screen playback.
- **A backdrop style switch (Motion / Still / Solid).** Motion costs two moving textures and reduced motion already gives Still, so a third control didn't earn its row.
- **Also left out:** timed color cycling, mascots (copyrighted sprites), retro and terminal skins, a font switch (the system font is the right UI font on iPhone) and hiding clutter (Luma has none to hide).

---

## 2. Appearance choices

### Themes (dark only)

There are five themes. Each one only replaces the tokens below.
- Themes live in `src/styles/themes.css` as `:root[data-theme='…']` blocks.
- `base.css` pulls them in with `@import './themes.css';` as its first line.
- `luma` stays the plain `:root` in `base.css`, which gains `--theme-accent: #a596ff` and `--accent: var(--theme-accent)`.

| id | Name | --bg | --surface | --surface-2 | --text | --text-2 | --text-3 | --theme-accent | --glass | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| `luma` | Luma | `#0a0a0c` | `#151518` | `#1e1e22` | `#f5f5f7` | `rgba(235,235,245,.62)` | `rgba(235,235,245,.32)` | `#a596ff` | `rgba(22,22,26,.74)` | Luma's own (current tokens) |
| `black` | Black | `#000000` | `#0e0e10` | `#18181b` | `#ffffff` | `rgba(255,255,255,.6)` | `rgba(255,255,255,.3)` | `#a596ff` | `rgba(0,0,0,.72)` | Original. True black for OLED iPhones. It keeps Luma's accent, because a white accent would hide the switch knob and make shuffle and repeat look the same on or off |
| `mocha` | Mocha | `#1e1e2e` base | `#313244` surface0 | `#45475a` surface1 | `#cdd6f4` text | `#a6adc8` subtext0 | `#6c7086` overlay0 | `#cba6f7` mauve | `rgba(30,30,46,.76)` | Catppuccin Mocha. MIT, "Copyright (c) 2021 Catppuccin", github.com/catppuccin/catppuccin |
| `fjord` | Fjord | `#2e3440` nord0 | `#3b4252` nord1 | `#434c5e` nord2 | `#eceff4` nord6 | `rgba(216,222,233,.66)` nord4 | `rgba(216,222,233,.34)` nord4 | `#88c0d0` nord8 | `rgba(46,52,64,.78)` | Nord. MIT, "Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)", github.com/nordtheme/nord |
| `rose` | Rosé | `#191724` base | `#1f1d2e` surface | `#26233a` overlay | `#e0def4` text | `#908caa` subtle | `#6e6a86` muted | `#ebbcba` rose | `rgba(25,23,36,.76)` | Rosé Pine (main). MIT, "Copyright (c) mvllow", github.com/rose-pine/rose-pine-palette |

- **Licenses.** The three credited palettes' LICENSE files, and the Catppuccin and Rosé Pine palette JSON, are in `research/spec/licenses/`. The review fetched the upstream files again on 2026-11-03, and the copyright lines above are quoted from them exactly. All the hex values were checked against the palette JSON and Nord's `src/nord.css`.
- **Other tokens.** `--fill`, `--fill-2`, `--hover`, `--line` and `--danger` stay as they are. They are see-through neutrals that work on every theme.
- **Wallpaper overlay.** `.wallpaper::after` must use `color-mix(in srgb, var(--bg) 74%, transparent)` and `90%` instead of the fixed `rgba(10,10,12,…)`.
- **Theme color.** `appearance.ts` also sets `<meta name="theme-color">` to the theme's `--bg`. Desktop PWA title bars and Safari's tab tint use it. The installed iPhone app's status bar is the frosted strip, which already uses `--glass`.
- **Left out on purpose:** Dracula, Gruvbox and Tokyo Night.
  - Dracula and Tokyo Night would only add more of the same.
  - Gruvbox says "MIT/X11" in its README but ships no license text or copyright line to credit (its `LICENSE` URL returns 404).

### The Appearance group: three rows, no helper text

`src/ui/Appearance.tsx` renders one `.group` block, with no heading. The You page places it under the profile card.

| Row | Control | Default | Stored as |
|---|---|---|---|
| Theme | Five 28px swatch circles on the right of the row, 16px apart, each with a 44px hit area. Each is filled with the theme's `--bg` and has a 10px dot of its `--theme-accent` in the middle. The selected one gets `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--text)`. Names are `aria-label` only. | Luma | `theme` |
| Cover Colors | Switch, 51×31, on color `var(--accent)` | on | `coverColors` |
| Vinyl | Switch | off | `vinyl` |

- **Store:** zustand `persist` under `luma-appearance` in localStorage.
  - It is tiny, belongs to this device and is read synchronously.
  - `appearance.ts` sets `document.documentElement.dataset.theme` (removed for `luma`) when it is imported. `main.tsx` imports it before `App`.
- **No flash on launch:** module scripts run after the first paint can happen. So `index.html` gets a one-line inline script in `<head>`:
  - `try { const t = JSON.parse(localStorage.getItem('luma-appearance')).state.theme; if (t && t !== 'luma') document.documentElement.dataset.theme = t } catch {}`
  - The built CSS `<link>` sits in `<head>` too, so the first paint already has the right theme.
- **The existing "Background" row is renamed "Wallpaper"** (and "Remove Background" becomes "Remove Wallpaper"), so it doesn't clash with the profile's own Background. This is in `You.tsx`, so WP-B does it.

### Vinyl: what the switch does

The Now Playing art becomes a record, with the cover as its label, as in Spicetify's Turntable theme. The CSS is our own.
- `.np-record`:
  - `width: min(100cqw, 100cqh); aspect-ratio: 1; border-radius: 50%;`
  - `background: radial-gradient(circle, transparent 0 21%, #0e0e10 21.5%), repeating-radial-gradient(circle, #111114 0 1.2px, #1c1c20 1.6px 2.6px);`
  - `box-shadow: 0 30px 60px -12px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.06);`
- Label: `TrackArt` clipped to a circle 42% wide, centered.
- Spindle: `::after`, 3.2% wide, `#d9d9de`.
- Spin: `animation: spin 8s linear infinite; animation-play-state: paused;`. It is `running` only under `.np.open.playing`, so a closed sheet never spins.
- A fixed sheen on a sibling that doesn't turn, so the light stays put while the record spins:
  - `conic-gradient(from 30deg, transparent 0 8%, rgba(255,255,255,.07) 12%, transparent 18% 50%, rgba(255,255,255,.05) 58%, transparent 64%)`
- The D3 glow stays behind the record.
- Under reduced motion: no spin.

---

## 3. Profile ("You"), Discord-style for music

### What changes and why

- Today, You has a banner, an avatar and a name input over the settings rows.
- It becomes a **profile card** (the Discord popout, built for music) with the settings groups below it.
- All editing moves into one **editor sheet with a live preview**.
- Kept from Discord as ideas only. No Discord art, assets, names or exact proportions are copied; for example, the banner is 3:1, not Discord's 5:2. The ideas kept:
  - an animated avatar and banner (images and GIFs; a video goes through the GIF maker), and an avatar frame;
  - profile colors with a ring in those colors around the card, background, profile effect;
  - display-name style, bio and badges;
  - the Board, which here holds pinned songs, pinned playlists and On Repeat.
- Changed or left out:

| Discord feature | In Luma | Why |
|---|---|---|
| Pronouns | Left out | A secondary label |
| Stats widget | Left out | Counts break the "no counts" rule; badges carry the same idea |
| "Listening to" strip on your own profile | Replaced by a playing dot on the avatar | A strip would repeat the mini player |
| Theme border | An automatic ring in the profile colors, with no setting | It looks right whatever colors are picked; a border picker would be one more tab for little gain |
| Nameplate | Desktop sidebar profile row and the You tab only, tied to the name style | Luma has no member list. It comes back fully with friends (task #9) |
| Per-server anything, Shop, Orbs | Left out | Not applicable |

### Card anatomy, from bottom layer to top

1. **Ring:** 2px, drawn just outside the card's edge.
2. **Card background:** profile colors as a gradient, or the uploaded Background image, GIF or video under a dark overlay.
3. **Banner** (image or GIF), or a gradient of the profile colors.
4. **Avatar** with a ring the color of the card, overlapping the bottom of the banner.
5. **Frame:** a box 1.2× the avatar, above it, ignoring taps.
6. **Playing dot** at the avatar's bottom right, while music plays.
7. **Body:** name (styled), badges, bio, then Pinned, Playlists and On Repeat.
8. **Effect canvas** over the whole card, ignoring taps.

### Layout and exact sizes

**Phone (393×852):**
- `.pc` card: `width: 100%` (357px inside the 16px gutters and the ring's padding), `border-radius: 20px`, `overflow: hidden`.
  - The card sits in `.pc-wrap { position: relative; padding: 2px; }`, which holds the ring (section 5).
  - Inside `.pc`, `--text-2` is `rgba(255,255,255,.72)`. The app's `--text-2` measures 3.9:1 on the card, which is too low.
  - The card is not full-bleed, so no frosted status-bar strip sits over an animated banner until the user scrolls.
- Banner: `aspect-ratio: 3 / 1` (357×119). This is the ratio of today's banner and of the GIF maker's banner crop, so what the user crops is what shows. Text never sits on it.
- Avatar:
  - 96px; `margin: -48px 0 0 16px`.
  - Ring: `box-shadow: 0 0 0 6px var(--pc-ring)`.
  - Frame layer: `position: absolute; inset: -10%; pointer-events: none; z-index: 2`.
- Playing dot:
  - A 26px circle at the avatar's `right: 0; bottom: 2px`, with a 4px ring in `var(--pc-ring)`.
  - Fill `var(--pc-accent)`, with the existing three white `.bars` at 3px wide.
  - Shown only while playing.
- Edit button: a `pill` reading "Edit Profile".
  - Height 34, padding `0 16px`, 14px/600, `background: rgba(255,255,255,.12)`.
  - It sits right-aligned, 12px below the banner: `position: absolute; right: 16px; top: calc(119px + 12px)`.
- Body, `padding: 12px 18px 20px`:
  - **Name:** 26px/700, `letter-spacing: -0.02em`, one line with an ellipsis. Hidden when empty.
  - **Badges:** `margin-top: 10px`. A row of 30px medallions, 6px apart, wrapping to two lines at most. They come from WP-C's `<BadgeRow size="card" />`.
  - **Bio:** `margin-top: 12px`, 15px/1.4, `color: rgba(255,255,255,.78)`, `white-space: pre-wrap`. Hidden when empty.
  - **Sections:** `margin-top: 22px`, with 22px between them. Each heading is `h3` 17px/700, `letter-spacing: -0.01em`, `margin-bottom: 8px`.
    - **Pinned:**
      - Up to 5 song rows, each 52px tall: a 40px cover with 6px corners, the title at 15/500, the artist at 13 in `--text-2`.
      - Tapping a row runs `playTracks(pinnedIds, i)`. The playing row shows the bars.
    - **Playlists:**
      - A 3-column grid with a 10px gap. Covers have 8px corners.
      - The name sits below each cover, 13/500, one line.
      - Tapping one opens the playlist.
    - **On Repeat:**
      - A horizontal scroller of 104px covers, 12px apart, each with its title below (13/500, one line).
      - Tapping one plays the On Repeat list from that song.
      - Shown only when at least 3 songs qualify (section 4).
- 28px below the card: `<Appearance />`, then the existing group with Wallpaper and YouTube Key.

**Desktop (1440×900):**
- Card `max-width: 960px`, `border-radius: 24px`. Banner `aspect-ratio: 3 / 1` (960×320).
- Avatar 128px; `margin: -64px 0 0 24px`; ring 8px.
- Edit pill at `right: 24px; top: calc(320px + 16px)`.
- Body: `display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 40px; padding: 16px 24px 28px`.
  - Left column: name (32px), badges (`size="card"`, 34px medallions), bio.
  - Right column: Pinned, Playlists (`repeat(auto-fill, minmax(120px, 1fr))`), On Repeat (120px covers).
- The settings groups below the card are capped at `max-width: 640px`.

### Card colors, kept readable

`profileColors(profile)` in `src/ui/profile/colors.ts` takes the colors from the first of these that exists:
1. `profile.colors`, the user's pick.
2. `profile.autoColors`, worked out from the avatar's still, else the banner's, when either is saved.
3. Neither: the cover accent (case 3 below).

It returns CSS variables:
- `--pa-raw`, `--pb-raw`: the colors exactly as chosen. Used for the empty banner and the card ring.
- `--pa`: the top color with OKLCH lightness capped at 0.42. `--pb`: the bottom color capped at 0.24. In both, chroma is lowered until the color fits sRGB.
  - The card background is `linear-gradient(180deg, var(--pa), var(--pb))`.
  - White text on any sRGB color at lightness 0.42 or less keeps at least 8:1, so no inner panels are needed.
- `--pc-accent`, `--pc-accent-2`: the top and bottom colors at L 0.76, made the same way as the cover accent (D1, step 7).
  - The Gradient name style, the halo frame, the neon name, the effects and the playing dot use them.
  - So the card keeps its own colors and doesn't change with every song.
- `--pc-ring`: equal to `--pa`. With a Background image it is `#0d0d10`.
- Case 3, with no colors and no images:
  - `--pa: color-mix(in oklab, var(--accent) 22%, var(--surface))` and `--pb: var(--surface)`;
  - `--pa-raw: var(--accent)` and `--pb-raw: var(--surface-2)`;
  - `--pc-accent: var(--accent)` and `--pc-accent-2: #fff`.

Other color rules:
- **Background image, GIF or video:**
  - It covers the card (`object-fit: cover`) under `linear-gradient(rgba(10,10,12,.7), rgba(10,10,12,.88))`. It is never blurred live.
  - The overlay starts at .7 because a pure-white image under .5 leaves white text at 3.7:1. At .7, the name is 7.6:1, the bio 5.4:1 and `--text-2` 4.9:1.
- **Empty banner:** `linear-gradient(135deg, var(--pa-raw), var(--pb-raw))`.

### Each element

| Element | What it accepts / options | Behavior |
|---|---|---|
| Avatar | Image (JPEG, PNG, HEIC, which iOS hands over as JPEG), GIF, APNG, animated WebP. A video opens `<GifMaker aspect={1}>`, and the GIF it makes is what gets saved | Lists, sidebar and tab bar always use the still. The card and editor preview play the animation (rules in section 6). |
| Frame | None, halo, aurora, vinyl, orbit, equalizer, laurel, blossoms, sparkles (section 5) | `vinyl` turns and `equalizer` pulses only while music plays: the component reads `usePlayer(s => s.playing)` and sets `data-playing`. |
| Banner | Same as the avatar, with `<GifMaker aspect={3}>` for a video | Center-cropped to 3:1. A banner GIF from the maker is 480px wide, so on desktop it looks softer than a still banner. Raising that width is a separate change to the GIF maker. |
| Background | Images and animated images as above, plus MP4/MOV, and WebM only when `canPlayType('video/webm; codecs="vp9"')`. Videos are stored as they are, because the card is tall and the GIF maker only crops 1:1 and 3:1 | Fills the card under the dark overlay. |
| Colors | Auto, 10 presets, or two custom colors | Presets (top → bottom): `#ff7ab8→#6b5bff`, `#38bdf8→#1e3a8a`, `#a3e635→#065f46`, `#fb923c→#7f1d1d`, `#fda4af→#9d174d`, `#fde68a→#92400e`, `#6ee7b7→#0f766e`, `#c4b5fd→#4c1d95`, `#e5e7eb→#374151`, `#1e293b→#020617`. |
| Effect | None, petals, snow, sparkles, stars, notes, fireflies | On the You page it plays for 8 s when the card first becomes visible after mounting, then fades out over 1.2 s. It loops in the editor preview. Under reduced motion it is one still frame. |
| Name style | Default, gradient, aurora, chrome, neon, pixel, script | Plays its animation for 2 cycles after the card appears, then rests. The style also sets the plate behind the name in the sidebar row. |
| Bio | Plain text, up to 190 characters (`maxLength`), with no counter | Hidden when empty. |
| Pinned songs | Up to 5, pinned from the song menu ("Pin to Profile" / "Unpin from Profile", Lucide `pin` icon) | A new pin goes first, and a sixth pin drops the last one. To move a song to the top, pin it again. Deleted songs leave the list (cleaned up in `deleteTrack`). |
| Pinned playlists | Up to 6, picked in the editor | Deleted playlists leave the list (cleaned up in `deletePlaylist`). |
| On Repeat | Automatic (section 4) | No switch. Nobody else can see the profile until friends ship; a hide switch can come with task #9. |
| Badges | Automatic (section 4) | Earned badges only. No locked or grey ones. |
| Nameplate | Comes from the name style | Desktop: the sidebar's `.side-profile` row gets the style's plate background and the name in the style's font at 15px, with no animation. Phone: the You tab shows the avatar's still at 26px instead of the user icon, with a 1.5px `--text` ring when the tab is active. |

### The editor sheet (`src/ui/profile/ProfileEditor.tsx`)

There is one component with one section list. Phones show the sections as tabs over a tray; desktop shows them stacked. The breakpoint is `matchMedia('(min-width: 900px)')`.

**Draft model:**
- Opening the editor copies `profile` into a draft.
- A picked file is processed at once by `media.ts` (resize, still copy, size checks). The result is held in the draft as `{ blob, still?, kind }` plus object URLs, so the preview shows exactly what will be saved.
- A video picked for the avatar or banner first opens the GIF maker. It is a fixed sheet at `z-index: 60`, so it sits above the editor's 50. Use passes its GIF to `media.ts`; Cancel returns to the editor unchanged.
- **Done** calls `saveProfile(draft)` in `library.ts`. It writes changed blobs, deletes removed ones, recomputes `autoColors` from the stills when the avatar or banner changed, and sets the profile.
- **Cancel** throws the draft away.
- While the editor is open, the page card underneath is paused (`live = false`).

**Phone layout:**
- `.pe`: `position: fixed; inset: 0; z-index: 50; background: var(--bg)`. It slides up over 420 ms with `var(--ease)`, like Now Playing.
- Header: 44px plus the top safe area.
  - "Cancel" on the left, 17px, `--text-2`.
  - "Done" on the right, 17px/600, `var(--accent)`.
  - No title.
- Preview: `flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px`. It holds the full `<ProfileCard draft live />`.
  - Picking a tab scrolls the preview to the matching part: the top for Images, Colors, Frame, Effect, Name and Bio, and the sections for Pinned.
- Tabs: a horizontal scroller, 44px tall. Each chip is 32px tall with 16px corners, `padding: 0 14px`, 14px/600.
  - Selected: `background: var(--text); color: var(--bg)`. Others: `var(--fill)`.
- Tray: 196px tall plus the bottom safe area (50dvh for Pinned), `background: var(--surface)`, top corners 20px, `padding: 14px 16px`.

**The seven tabs and what each tray holds:**

| Tab | Tray contents |
|---|---|
| **Images** | Three tiles in a row: Avatar (72px circle), Banner (144×48, 3:1) and Background (56×70, 4:5), each labelled with its one word. Tapping a tile opens the menu with Choose and Remove (Remove only when one is set). On an error the tile gets a 2px `--danger` outline, and its label reads "Too Large", "Too Long", "Unsupported" or "Storage Full" for 3 s. |
| **Colors** | Row 1: an "Auto" swatch, then the 10 preset swatches. Each is a 40px circle split diagonally between its two colors. Row 2: two 44×44 color wells with 12px corners (`<input type="color">`) for top and bottom. |
| **Frame** | A scroller with None and the 8 frames, each a 64px preview of your avatar. Only the selected one animates. |
| **Effect** | A scroller with None and the 6 effects, each a 64×84 tile showing one still frame. Picking one restarts it on the preview. |
| **Name** | A name field: 17px text (16px or more stops iOS zooming in), 44px tall, `var(--fill)`, 12px corners. Below it, a scroller of 120×52 chips showing your name in Default and in each of the 6 styles. |
| **Bio** | A 4-row textarea: 16px text, `maxLength={190}`, `var(--fill)`, 12px corners. |
| **Pinned** | Song rows: cover, title and a remove button, in pin order. Below them, a checklist of all playlists (36px cover, name, check). Once 6 are checked, the rest are dimmed and disabled. |

**Desktop layout:**
- Centered modal: `width: min(1000px, calc(100vw - 64px)); height: min(820px, calc(100dvh - 64px)); border-radius: 20px; background: var(--surface)`.
- Behind it: `rgba(0,0,0,.5)`, with no backdrop blur.
- Inside: `display: grid; grid-template-columns: 380px 1fr`.
  - Left: the same sections stacked and scrolling, each with an `h3` heading. Scrollers wrap instead.
  - Right: `var(--bg)`, with the card at 440px wide, centered and scrolling.
- Header with Cancel / Done across the top. Esc cancels.

### Data model additions (`src/types.ts`)

```ts
export type MediaKind = 'image' | 'animated' | 'video'
export type FrameId = 'halo' | 'aurora' | 'vinyl' | 'orbit' | 'equalizer' | 'laurel' | 'blossoms' | 'sparkles'
export type EffectId = 'petals' | 'snow' | 'sparkles' | 'stars' | 'notes' | 'fireflies'
export type NameStyleId = 'gradient' | 'aurora' | 'chrome' | 'neon' | 'pixel' | 'script'

export interface Profile {
  name: string
  avatar?: number // blob `avatar`; also `avatar-still` when avatarKind is 'animated'
  avatarKind?: MediaKind // undefined = 'image' (profiles saved before this change); never 'video' (videos become GIFs)
  banner?: number // blob `banner` (+ `banner-still`)
  bannerKind?: MediaKind // never 'video'
  backdrop?: number // blob `backdrop` (+ `backdrop-still`): the card's own background. Not `background`, which is the wallpaper's key
  backdropKind?: MediaKind
  colors?: [string, string] // '#rrggbb' top, bottom; undefined = Auto
  autoColors?: [string, string] // from the avatar's still (else the banner's), recomputed when either is saved
  frame?: FrameId
  effect?: EffectId
  nameStyle?: NameStyleId
  bio?: string // up to 190 characters
  pinnedSongs?: string[] // up to 5 track ids, newest first
  pinnedPlaylists?: string[] // up to 6 playlist ids
}

/** One listen, logged by plays.ts: [track id, started at (ms since epoch), listened ms]. */
export type Play = [id: string, at: number, ms: number]

export type BadgeId =
  | 'first-spin' | 'hours' | 'streak' | 'on-repeat' | 'night-owl' | 'early-bird'
  | 'marathon' | 'explorer' | 'crate-digger' | 'curator' | 'founder'
export type Tier = 1 | 2 | 3 | 4 // bronze, silver, gold, holo
export interface Badge { id: BadgeId; tier: Tier; name: string; fresh: boolean }
```

Every new field is optional, so profiles saved today load unchanged, and `avatar` and `banner` keep their meaning.

### Storage (IndexedDB blobs, size caps)

- **Blob keys** (add them to the lists in AGENTS.md and in the `blobs.ts` header):
  - `avatar`, `avatar-still`, `banner`, `banner-still`, `backdrop`, `backdrop-still`.
  - A `-still` key exists only when its slot's kind is `animated` or `video`.
  - Replacing a slot writes the same keys and bumps the version. Removing a slot deletes both keys.
- **`src/lib/media.ts`:** `processMedia(file, slot, { made }: { made?: boolean } = {})` returns `{ blob, still?, kind }` or throws `'too-large' | 'too-long' | 'unsupported'`.
  - `made: true` marks a GIF the GIF maker just produced. It skips the size caps, because the maker's own limits (10 s, 480px, 15 fps) already bound it.
  - **Still images:**
    1. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so portrait camera photos come out upright.
    2. Center-crop and resize.
    3. Fill the canvas with `#151518` first, so transparent PNGs don't turn black.
    4. Encode with `canvas.toBlob('image/jpeg', q)`. Safari cannot encode WebP, so the format is JPEG.
  - **Animation is detected from the file's bytes** with pure, tested functions:
    - GIF: walk the block structure (header, color tables, `0x21` extensions with their sub-blocks, `0x2C` image descriptors with their LZW sub-blocks, `0x3B` trailer) and count the descriptors. Never search the raw bytes for `0x2C`, because it also shows up inside image data.
    - PNG: an `acTL` chunk before `IDAT`; the frame count is in `num_frames`.
    - WebP: the `VP8X` animation flag; count the `ANMF` chunks.
  - **Animated images are stored as they are, never re-encoded.** Their still is the first frame from `createImageBitmap(blob)`, encoded as JPEG.
  - **Video** (Background only):
    1. Load it into a detached `<video muted playsinline preload="auto">` and read `duration` and `videoWidth`/`videoHeight`.
    2. Set `currentTime = 0.1`, wait for `seeked`, and draw the frame to a canvas as the JPEG still.
    3. iOS may not load a detached video's frames until it plays. If `seeked` hasn't fired after 2 s, call `play()` (muted, inside the picker's user gesture), then `pause()`, and seek again.
    4. If the video still fails to load, the result is `unsupported`.
  - Decoding must never touch the music `<audio>` element or Media Session.

| Slot | Still copy | Animated image limit | Video limit |
|---|---|---|---|
| avatar | 512×512 JPEG, q .86 (about 60–100 KB) | ≤ 2 MB, ≤ 640px on its long side, width × height × frames ≤ 16 M | none: the GIF maker |
| banner | 1500×500 JPEG, q .85 (about 200 KB) | ≤ 4 MB, ≤ 1200px wide, width × height × frames ≤ 48 M | none: the GIF maker |
| backdrop | 1080×1350 JPEG, q .82 (about 250 KB) | ≤ 4 MB, ≤ 1080px wide, width × height × frames ≤ 48 M | ≤ 8 MB, ≤ 12 s, ≤ 1920px on its long side |

- **Still images are never rejected,** only shrunk.
- **Background video:** the hardware decodes 1080p H.264 and HEVC cheaply, and iPhone clips are 1080p or larger, so the cap allows 1080p. A lower cap would turn away most camera clips. The megabyte cap exists only for storage and later upload. If ordinary Photos clips fail it, raise it.
- **Worst case is about 17 MB** of profile media (two maker GIFs of a few MB each, the 8 MB Background video, and the stills). That is small next to the songs, which already fill most of Luma's IndexedDB quota.
- **Quota:** on the first media save, call `navigator.storage.persist()`. A quota error on Done shows "Storage Full" on the Images tab and keeps the editor open.
- **Later sync:** these keys and versions map one-to-one to uploads to Luma's servers when the Supabase work (task #9) lands.
  - Nothing is uploaded in this round. Luma has no server yet, and everything stays on the device.

### How it stays readable and uncluttered

- **Text placement:** no text on the banner, ever. All text sits on card colors capped at lightness 0.42, or on the 70–88% dark overlay. On the card, `--text-2` is 72% white.
- **One of each:** one frame, one effect and one name style. The card uses its own colors; the rest of the app uses the cover accent.
- **No placeholders or counts:** empty fields and sections disappear, with no placeholder text and no counts. Badges show icons only, and their names appear on tap.
- **Motion settles:**
  - The effect plays 8 s and fades. The name style runs 2 cycles and rests.
  - Frames loop gently, and only while on screen.
  - Lists never animate profile media.
- **The editor:** seven one-word tabs, with swatches and previews and no explanations.

---

## 4. Badges (WP-C)

### Recording plays (`src/lib/plays.ts`)

Luma keeps no listening history today. `plays.ts` is imported once from `main.tsx` and only listens. It needs no change to `player.ts`.

- **What it listens to:**
  - The exported `audio` element: `timeupdate`, `play`, `pause` and `emptied`.
  - The `usePlayer` store: the current id is `queue.ids[queue.index]`.
- **Listened time:**
  - On each `timeupdate` while not paused, add the `audio.currentTime` difference Δ when `0 < Δ ≤ wallΔ + 0.5 s`. Here `wallΔ` is the `performance.now()` time since the last event.
    - This leaves out seeks and the hold-to-scan jumps, which move further than wall time allows.
    - It still counts listening when iOS spaces out events on the lock screen. A fixed "Δ ≤ 1.5 s" rule would drop that time.
  - A wrap on the same track closes the play and starts a new one. A wrap goes from within 1.5 s of the end to under 1 s, as in repeat one or the deliberate `audio.loop`.
- **When a listen counts as a play:** when listened ≥ `min(30, max(10, 0.5 × duration))` seconds, using 30 if the duration is unknown.
  - At that moment it writes `[id, startedAt, listenedMs]`.
  - It updates `listenedMs` on pause, track change, wrap, `visibilitychange` to hidden and `pagehide`.
  - It also updates it on a `timeupdate` when 60 s have passed since the last write. That check rides on `timeupdate`, not `setInterval`, because timers stall in the background.
- **Storage:**
  - A separate idb-keyval store, `createStore('luma-plays', 'days')`, so scans never walk the audio blob keys.
  - Each key is the local date of the play's start, `YYYY-MM-DD`, and its value is a `Play[]` (about 50 entries a day).
  - Earned tiers live in the same store under `badges` → `Record<BadgeId, Tier>`. Tiers never go down, so a deleted song or playlist cannot take a badge away.
- **Pure core, tested on its own:** `listen(state, event) → { state, write? }` handles the counting rules. Each event carries `currentTime`, `performance.now()`, `Date.now()` and the current id.
- **Dev and test helper:** `export function addPlays(plays: Play[])`, so Playwright can seed history with `page.evaluate`.

### Working out the stats (`src/lib/stats.ts`)

- **`computeStats(plays, library, now)`** is pure and covered by `test/stats.test.ts`. It returns:
  - `hours`: the sum of `ms` ÷ 3.6e6.
  - `longestStreak`: the longest run of consecutive local days with at least one play. Compare day keys at local noon so daylight-saving changes don't break runs.
  - `maxSongPlays`: the most plays of any single song.
  - `night`: plays starting 00:00–03:59 local time.
  - `early`: plays starting 05:00–07:59 local time.
  - `longestSessionMs`: plays join a session while `next.at − (prev.at + prev.ms) ≤ 10 min`, and a session's length is its summed `ms`.
  - `artists`: distinct artists among played songs that are still in the library. The artist string is lowercased, trimmed, and cut at the first `,`, `&`, ` feat.` or ` ft.`.
  - `songs`: `order.length`.
  - `playlists`: `playlists.length`.
  - `firstUse`: the earliest of every track's `addedAt` and the first play.
- **`useOnRepeat(): string[]`:**
  - Counts plays per song over the last 30 days, keeping songs still in the library with at least 3 plays.
  - Sorted by count, with ties broken by the most recent play. Returns the top 5.
  - The profile hides On Repeat when fewer than 3 songs qualify.
- **`useBadges(): Badge[]`:**
  - Computed when You mounts and again after each new play, about 10 ms for a year of history, and cached in memory.
  - `tier = max(stored, computed)`.
  - `fresh` means the computed tier is above the stored one. After the shine plays, the new tier is stored.

### The badges

Badges with four tiers use bronze, silver, gold and holo. The name shown on tap is the tier's name and nothing else.

| id | Rule | Tier 1 / 2 / 3 / 4 | Name shown on tap | Glyph | Glyph license |
|---|---|---|---|---|---|
| first-spin | 1 play | one tier (bronze) | First Spin | Lucide `disc-3` | ISC |
| hours | listening hours | 10 / 100 / 500 / 1,000 | 10 Hours · 100 Hours · 500 Hours · 1,000 Hours | Lucide `headphones` | ISC (Lucide) + MIT (Feather, which it comes from) |
| streak | longest daily streak | 7 / 30 / 100 / 365 days | 7 Days · 30 Days · 100 Days · 365 Days | Lucide `flame` | ISC |
| on-repeat | plays of one song | 25 / 50 / 100 / 250 | On Repeat | Lucide `repeat-1` | ISC |
| night-owl | plays 00:00–03:59 | 25 / 100 / 500 / 1,000 | Night Owl | Lucide `moon-star` | ISC |
| early-bird | plays 05:00–07:59 | 25 / 100 / 500 / 1,000 | Early Bird | Lucide `sunrise` | ISC |
| marathon | longest session | 1 / 2 / 4 / 8 hours | Marathon | Lucide `hourglass` | ISC |
| explorer | distinct artists | 25 / 100 / 250 / 500 | Explorer | Lucide `compass` | ISC + MIT (Feather) |
| crate-digger | songs saved | 100 / 500 / 1,000 / 5,000 | Crate Digger | Tabler `vinyl` | MIT |
| curator | playlists made | 5 / 10 / 25 / 50 | Curator | Lucide `list-music` | ISC |
| founder | first use before 2027-01-01 local time | one tier (holo) | Founder | Lucide `sparkles` | ISC |

Glyph paths are ready in `research/assets/badges/badge-glyphs.ts`. They come from Iconify's JSON copies of Lucide (ISC) and Tabler 3.50.0 (MIT), are 24×24 with 2px strokes, and match `Icon.tsx`.
- Copy only the 11 above into `src/ui/badgeGlyphs.ts`.
- Rename the keys `deep-listener` → `hours` and `hot-streak` → `streak`.
- Leave out `audiophile` and the Phosphor alternates.
- Spell the Tabler author "Paweł Kuna" in the header comment.

### Medallion (`src/ui/Badges.tsx`, `src/styles/badges.css`)

- **Sizes:**
  - `size="card"`: 30px on phones and 34px on desktop, glyph 16/18px.
  - `size="small"`: 22px, glyph 12px. Reserved for future friend rows.
- **Shape:** a circle with `box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 1px 2px rgba(0,0,0,.4)`.
- **Tier backgrounds and glyph colors:**

| Tier | Background | Glyph color |
|---|---|---|
| bronze | `radial-gradient(circle at 30% 25%, #ffd9b0, #c47a3a 48%, #6b3a17)` | `#4a2509` |
| silver | `radial-gradient(circle at 30% 25%, #ffffff, #b9c0c9 48%, #59616c)` | `#2b3038` |
| gold | `radial-gradient(circle at 30% 25%, #fff7cf, #e3b341 48%, #8a5a00)` | `#5a3a00` |
| holo | `radial-gradient(circle at 30% 25%, #fffc, #fff0 45%), conic-gradient(from 210deg, #ff9ad5, #ffd36e, #7affc9, #7cc4ff, #b388ff, #ff9ad5)` | `#fff`, with `filter: drop-shadow(0 1px 1px #0008)` (static, drawn once) |

- **Order:** by tier, highest first, then in the table's order.
- **Tap:**
  - A bubble 6px above the badge: `var(--surface-2)` with 10px corners, `padding: 6px 10px`, 13px/600. It holds only the name.
  - It fades in over 140 ms and hides after 1.6 s or on any tap elsewhere.
  - Each badge is a `<button>` with `aria-label` set to the name.
- **Fresh badge:**
  - `@keyframes badge-in` scales from .4 to 1 over 900 ms with `var(--spring)`. A sheen sweeps across in a `::after` moving `transform: translateX(-120% → 120%)`.
  - It plays once.
  - Under reduced motion it simply appears.

---

## 5. Assets

### Made in code (our own work, MIT with Luma, no files to ship)

Sources to port: `research/assets/preview/frames.js`, `effects.js` and `starter-preview.html`. They were written for Luma and are already rendered in `preview.png` and `preview-card.png`.

**Frames** (`src/ui/profile/frames.ts` + `Frame.tsx` + `profile.css`):
- All share one 120×120 viewBox over the avatar with `inset: -10%`. The avatar's edge is at radius 50, and decorations sit around radius 55, so nothing covers the face.
- **CSS rings:** a `.ring` element painted on its padding with the content box masked out (`-webkit-mask-composite: xor` / `mask-composite: exclude`).
- Every moving part is a whole element turning or fading (`transform`/`opacity`), which the compositor animates without repainting.
  - SVG children are the exception: WebKit repaints the SVG on every frame when they animate. So `equalizer` and `sparkles` are kept small, and run only while `live`.

| id | How it is built | Motion |
|---|---|---|
| halo | `conic-gradient(var(--pc-accent), transparent 30%, var(--pc-accent) 50%, transparent 80%, var(--pc-accent))`, 3px ring | turns once every 6 s |
| aurora | spectrum conic ring, 4px, plus a soft glow made with no filter: a second ring 14px wide behind it, faded at both edges by `mask: radial-gradient(closest-side, transparent 78%, #000 88%, transparent)` at opacity .6. The preview's `filter: blur(6px)` copy is dropped | both turn once every 9 s |
| vinyl | groove texture `repeating-radial-gradient(circle, #0d0d0f 0 1px, #26262a 1.4px 2.3px)` with a sheen; ring 9% wide | 4 s per turn, only while playing |
| orbit | faint 1px track; a glowing dot with a fading tail turns around it. The dot sits outside the masked ring so the mask doesn't clip it | 3.2 s loop |
| equalizer | SVG generator, 40 bars (the kit has 56; fewer bars cost less on iPhone) | bars pulse (`scaleY` .25 → 1, 0.8 s, staggered), only while playing |
| laurel | SVG generator: a gold wreath of 11 leaf pairs per side | static |
| blossoms | SVG generator: a branch and six five-petal flowers | the wrapper `div` sways ±3° over 5 s |
| sparkles | SVG generator: a thin ring and nine 4-point stars | 2.4 s twinkle |

- **Unique ids:** each SVG gradient id gets a per-instance suffix from `useId()`, because the editor can show a frame up to three times at once.
- **SVG animation trap:** a CSS animation on an SVG element replaces its `transform` attribute. Keep the position on a wrapper `<g>` and animate the shape inside it, with `transform-box: fill-box`.

**Effects** (`src/ui/profile/effects.ts` + `Effect.tsx`):
- Port `mountEffect(canvas, kind, { accent, fps, duration, still })` with the six kinds above. `accent` is the card's `--pc-accent`. Add a `still` option that draws one frame and stops; the thumbnails use it.
- The engine:
  - pauses when off screen (`IntersectionObserver`) or hidden (`visibilitychange`);
  - caps the screen scale at 2×;
  - draws glows from pre-made sprites instead of `shadowBlur`;
  - moves by elapsed time, so iOS Low Power Mode at 30 fps keeps the same speed.
- Touch screens (`(pointer: coarse)`) run at `fps: 30`; others at 60.

**Card ring** (`profile.css`):
- `.pc-ring`: `position: absolute; inset: 0; border-radius: 22px` (26px on desktop), sitting in the 2px padding of `.pc-wrap`.
- 2px mask-composite ring, `linear-gradient(160deg, var(--pa-raw), var(--pb-raw))`. Static.

**Name styles and plates** (`NameStyle.tsx`, `profile.css`):
- Text effects use `-webkit-background-clip: text; background-clip: text; color: transparent`.
- Check a long name in each clipped style: the ellipsis must still show.

| id | Name text | Font, size on card (phone) | Plate behind the name in the sidebar row |
|---|---|---|---|
| gradient | text gradient from `--pc-accent` to `--pc-accent-2` | system, 800, 26px | `linear-gradient(90deg, color-mix(in oklab, var(--pa-raw) 28%, transparent), transparent 75%)` |
| aurora | `linear-gradient(90deg, #ff9ad5, #ffd36e, #7affc9, #7cc4ff, #b388ff, #ff9ad5) 0 0 / 300% 100%`, sliding over 8 s | Bricolage Grotesque 700, 27px | `radial-gradient(120% 140% at 0% 0%, #8b7bff33, transparent 60%), radial-gradient(120% 140% at 100% 100%, #7affc922, transparent 60%)` |
| chrome | metallic `linear-gradient(180deg, #fff 0%, #d4d8de 42%, #6c727c 50%, #e9ebee 58%, #fff 100%)` with a shine sweeping across over 3.5 s | Unbounded 800, 22px, `letter-spacing: -0.02em` | `repeating-linear-gradient(90deg, #ffffff07 0 1px, transparent 1px 3px), linear-gradient(#202227, #131417)` |
| neon | `color: #fff2fa; text-shadow: 0 0 1px #fff, 0 0 6px var(--pc-accent), 0 0 14px var(--pc-accent)`. The glow is static, with one 2.2 s opacity flicker when it appears | Tilt Neon, 26px | `linear-gradient(#ff7ab810 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(90deg, #ff7ab810 1px, transparent 1px) 0 0 / 14px 14px, #0c0710` |
| pixel | `color: #7cffb2; text-shadow: 2px 2px 0 #0b4a29` | Silkscreen, 22px | `repeating-linear-gradient(0deg, #ffffff08 0 1px, transparent 1px 3px), #08130d` |
| script | `color: #fff7ee; text-shadow: 0 0 18px #ffcf6e55` | Instrument Serif italic, 32px | `radial-gradient(#ffffff14 1px, transparent 1.6px) 0 0 / 9px 9px, linear-gradient(90deg, #3a2414, #17120e)` |

- Desktop sizes are the phone sizes × 1.23.
- Every font stack ends in the system stack, so names in other scripts (Japanese, Arabic, and so on) fall back cleanly.

**Medallions:** CSS only (section 4).

**Empty banner:** the profile-color gradient. No stock images.

### Third-party files we ship

All notices go into `THIRD_PARTY_NOTICES.md` at the repo root. Step 0 writes it once (section 7). The copyright lines below are quoted from the upstream files the review fetched on 2026-11-03.

| Asset | Files | License and exact copyright line | Source |
|---|---|---|---|
| Lucide icons: `disc-3`, `headphones`, `flame`, `repeat-1`, `moon-star`, `sunrise`, `hourglass`, `compass`, `list-music`, `sparkles` (badges); `pin` (UI); **and the stroke icons already in `Icon.tsx`** (`repeat`, `chevron-down`, `plus`, `close`, `trash`, `expand` and others are Lucide paths, so far without a notice) | Inline SVG paths in `src/ui/badgeGlyphs.ts` and `src/ui/Icon.tsx` | ISC, "Copyright (c) 2026 Lucide Icons and Contributors". Icons derived from Feather (among them `headphones`, `compass`, `chevron-down`, `plus`, `x`, `trash`, `search`, `music`) are also MIT, "Copyright (c) 2013-present Cole Bemis". Copy Lucide's LICENSE whole; it has both parts | github.com/lucide-icons/lucide (`LICENSE`; npm `lucide-static` 1.67.0, ISC) |
| Tabler `vinyl` | Inline SVG path | MIT, "Copyright (c) 2020-2026 Paweł Kuna" | github.com/tabler/tabler-icons (`LICENSE`; npm `@tabler/icons` 3.50.0, MIT). Never any `brand-*` icon |
| Unbounded (800, latin) | `src/assets/fonts/unbounded-latin-800-normal.woff2`, 21.8 KB | OFL-1.1, "Copyright 2022 The Unbounded Project Authors (https://github.com/googlefonts/unbounded)" | npm `@fontsource/unbounded` 5.3.0; upstream github.com/google/fonts/tree/main/ofl/unbounded |
| Tilt Neon (400, latin) | `tilt-neon-latin-400-normal.woff2`, 19.8 KB | OFL-1.1, "Copyright 2019 The Tilt Project Authors (https://github.com/googlefonts/Tilt-Fonts)" | `@fontsource/tilt-neon` 5.3.0; …/ofl/tiltneon |
| Silkscreen (400, latin) | `silkscreen-latin-400-normal.woff2`, 8.4 KB | OFL-1.1, "Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen)" | `@fontsource/silkscreen` 5.3.0; …/ofl/silkscreen |
| Instrument Serif (400 italic, latin) | `instrument-serif-latin-400-italic.woff2`, 22.1 KB | OFL-1.1, "Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)" | `@fontsource/instrument-serif` 5.3.0; …/ofl/instrumentserif |
| Bricolage Grotesque (700, latin) | `bricolage-grotesque-latin-700-normal.woff2`, 22.4 KB | OFL-1.1, "Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)" | `@fontsource/bricolage-grotesque` 5.3.0; …/ofl/bricolagegrotesque |
| Catppuccin Mocha, Nord and Rosé Pine palettes | Hex values in `themes.css` | MIT (copyright lines in section 2) | links in section 2; LICENSE copies in `research/spec/licenses/` |
| Runtime code already bundled into the app, which has no notice yet | `react`, `react-dom` 19.3.1 and `scheduler` 0.28.0; `zustand` 5.0.16; `idb-keyval` 6.3.0; `gifenc` 1.0.3 (inlined in the GIF worker) | MIT, "Copyright (c) Meta Platforms, Inc. and affiliates." (react, react-dom, scheduler); MIT, "Copyright (c) 2019 Paul Henschel" (zustand); **Apache-2.0**, "Copyright 2016, Jake Archibald" (idb-keyval; it ships a `LICENCE` and no NOTICE file); MIT, "Copyright (c) 2017 Matt DesLauriers" (gifenc) | each package's own license file in `node_modules/` |

**How the font files are handled:**
- The files are already in `research/assets/preview/fonts/` (latin subsets). They are byte-identical to the files in the `@fontsource/*` 5.3.0 tarballs; the review checked their sha256.
- Copy each package's `LICENSE` from the tarball into `src/assets/fonts/OFL-<font>.txt`, keeping its exact copyright line.
- None of the five declares a Reserved Font Name. So the latin subsets, which Fontsource already cut down, may keep their names.
- `profile.css` declares them with `@font-face { font-display: swap; }`. The browser downloads a font only when text uses it, about 95 KB for all five.
- **Offline:** Vite puts them under `assets/`, but they are referenced only from the CSS. Today's service worker (`cacheShell` in `public/sw.js`) keeps only the `assets/` files named in `index.html`, so it would drop the fonts at each new build.
  - WP-B makes `cacheShell` also cache the `assets/` URLs found inside the CSS files it caches.

### Considered and not shipped

| Asset | License | Why not now |
|---|---|---|
| canvas-confetti | ISC | Our effect engine covers it |
| tsParticles | MIT | Heavier than our 9 KB engine |
| @kawarp/core | MIT | D2's two turning layers are enough, with no dependency |
| node-vibrant, fast-average-color | MIT | 40 lines of our own OKLCH code do the job |
| Monoton | OFL | Hard to read for long names; Tilt Neon instead |
| Rubik Vinyl | OFL | 74 KB |
| Pacifico | OFL | Overlaps Script |
| Phosphor duotone glyphs | MIT | Lucide and Tabler cover the 11 badges in one style |
| Hero Patterns, game-icons, Twemoji, Noto Animated Emoji | CC BY | Need per-file credit and aren't needed for v1 |

**Never ship:**
- **License problems:**
  - LottieFiles free animations (not open source), React Bits (Commons Clause), Aceternity (proprietary);
  - Hover.css (dual license), Trianglify (GPL), whatamesh (no license);
  - Remix Icon (its own "Remix Icon License v1.0" since January 2026), Haikei output (unconfirmed);
  - Gruvbox (no license text);
  - anything "free for personal use".
- **Copied from other apps:**
  - any Discord decoration, effect, nameplate or profile-effect art (including the URLs in `@discord-user-card/profile-effects`), and Decor's community decorations;
  - Spotify logos, colors or the Circular font;
  - Spicetify's mascot snippets and the oneko sprite;
  - any screenshot from the research.
- **Code we can't take:** Vencord (GPL) and AGPL Spicetify themes. Their ideas only.

---

## 6. iPhone constraints and performance budget

**Floor:** iOS 16.2 (`color-mix`, container units). Nothing in this spec needs a newer WebKit. `oklch` math happens in JS, which hands CSS plain `#rrggbb` values.

### WebKit support, checked per technique

| Technique | WebKit | Note |
|---|---|---|
| `backdrop-filter` | prefixed until Safari 18 | Keep the existing `-webkit-` pair. On iOS it is a native backdrop layer, so the tab bar and mini player stay cheap over a scrolling card |
| `conic-gradient` | Safari 12.1 | Animated only by rotating the element, never by animating an angle |
| `@property` | Safari 16.4 | Not used (D1) |
| `color-mix()` | Safari 16.2 | |
| Container units | Safari 16 | `.np-stage` is already `container-type: size` |
| `mask-composite` | `-webkit-mask-composite: xor` + unprefixed `exclude` | |
| `background-clip: text` | needs `-webkit-` | |
| `createImageBitmap(Blob)` | Safari 15 | Pass `imageOrientation: 'from-image'` |
| `canvas.toBlob('image/webp')` | falls back to PNG | Use JPEG |
| GIF / APNG / animated WebP in `<img>` | yes | Decoded on the CPU (below) |
| H.264 / HEVC `<video>` | hardware | HEVC with alpha is Safari-only; no transparent video is used |
| WebM VP9 | not everywhere | Gate on `canPlayType`; never required |
| `navigator.storage.persist()` | Safari 15.2 | |

### Budget for what is on screen at once

| Layer | Where | Allowed |
|---|---|---|
| `backdrop-filter` glass | tab bar, status-bar strip, mini player, desktop bar, sidebar, menu, settings `.group` | Only these, all existing. Blur stays at `--blur` (28px). **Never** on the profile card, editor, effects, Now Playing, or a new layer over a moving one. The editor's backdrop is plain dark |
| Now Playing backdrop | `.np.open` only | 2 directly composited 64×64 images, transform only, paused when closed. No CSS blur anywhere in Now Playing |
| Vinyl | Now Playing | 1 layer, transform only, runs only while open and playing |
| Effect canvas | You card or editor preview | **One at a time.** 30 fps on touch screens, at most 2× scale, 8 s then stops (loops only in the editor). Stops when off screen or hidden |
| Animated profile media (GIF, APNG, animated WebP, video) | You card, editor preview | **At most 2 playing**, in priority order avatar, banner, background; the third shows its still. Lists, sidebar, tab bar and everything else show stills |
| Frame loops | card, editor (selected frame only) | CSS transform/opacity on wrapper elements. `equalizer` (40 SVG rects) and `vinyl` run only while playing; SVG-internal motion repaints, so it stops whenever `live` is false |
| Name-style motion | card | 2 cycles, then rests. `chrome` and `aurora` animate `background-position`, which repaints, so it is time-limited |
| Text glow | neon name | Static `text-shadow`; only opacity flickers, once |

### `live` rule for profile media and animation

`live = cardOnScreen && document.visibilityState === 'visible' && !reducedMotion && !editorOpenOverIt`
- `cardOnScreen` comes from an `IntersectionObserver` with threshold 0.
- When `live` is false:
  - Animated images switch to their `-still` blob.
  - Videos are paused and keep their poster.
  - The effect stops.
  - Frames and the card get `data-still`, which pauses their animations: `[data-still], [data-still] * { animation-play-state: paused !important; }`.

### Formats on iOS Safari

- **GIF, APNG and animated WebP** play in `<img>`, and APNG and WebP support transparency.
  - All three are decoded on the CPU. WebKit keeps the decoded frames of small animations and re-decodes big ones on every frame. Either way, memory or CPU grows with width × height × frames.
  - The caps above bound that cost. Running out of memory is the white-screen reload risk.
  - GIF is fine for small avatars and poor for banners.
- **MP4 (H.264):** the best format for an animated Background, because the hardware decodes it. Avatar and banner videos become GIFs through the GIF maker instead.
  - Use `<video muted playsInline loop autoPlay disablePictureInPicture disableRemotePlayback preload="metadata" poster={stillUrl}>` with `pointer-events: none`.
  - Call `.play().catch(() => {})`. Low Power Mode blocks autoplay, and then the poster shows.
- **MOV (HEVC) from an iPhone:** fine on iPhone. Chromium on Windows may not play it (task #10). `media.ts` rejects whatever fails to load on this device.
- **WebM:** accepted only when `canPlayType('video/webm; codecs="vp9"')` says yes, never converted, and never required.
- **No transparent video,** and no video for frames or effects. Those are SVG, CSS and canvas only.
- **Avatars in lists and the tab bar** always use the still.
- **IndexedDB:** Luma already stores multi-megabyte audio blobs. An 8 MB Background video is no different, and the profile's ~17 MB worst case is small next to the songs.

### Must hold on a real iPhone

These are the acceptance checks on the device:
- A muted Background video never pauses the music, never takes over the lock-screen Now Playing, and keeps playing (muted) while music plays. The same goes for the GIF maker's hidden `<video>` while it makes a GIF.
- While the You page is open with a playing Background video, the Wallpaper video pauses, so two videos are never decoded at once (`App.tsx`, WP-B).
- A GIF avatar and a GIF banner at their caps play with music for 10 minutes on the oldest supported iPhone, and the page never reloads.
- A 48 MP photo (8064×6048) picked as the avatar imports without reloading the page, and a portrait camera photo comes out upright.
- A clip picked straight from Photos becomes a banner GIF through the GIF maker, and is accepted as a Background.
- With the keyboard up in Name or Bio, the field stays visible, and Done is reachable once the keyboard is dismissed.
- Scrolling You with everything on (GIF banner, GIF avatar, Background video, effect, frame, name style) stays smooth on an iPhone 12-class device.
- 10 minutes of listening on the lock screen logs about 10 minutes in `luma-plays`.
- With "Auto-Play Animated Images" turned off in iOS Settings (Accessibility › Motion), GIFs in the installed app may not animate. That is fine, but check that the page doesn't break.
- No Web Audio, ever: equalizer and vinyl motion follow `playing`, not the audio's real levels.

### Reduced motion (`prefers-reduced-motion: reduce`)

| Feature | Shows instead |
|---|---|
| Now Playing backdrop | One still copy |
| Vinyl | No spin |
| Effects | One still frame |
| Frames | Static |
| Name styles | Static; no flicker |
| Animated media | Stills |
| Badge shine | Skipped |
| Accent tint transition | 1 ms (the global rule) |
| Editor sheet | Fades instead of sliding |

### Battery

- Nothing animates on the Songs, Playlists or Search pages, except the existing playing bars.
- Everything stops when the page is hidden.
- Sampling a cover's colors happens once per cover: about 1 ms plus the decode.
- Badge stats are worked out when You opens, not while music plays.
- `plays.ts` does one small IndexedDB write when a play counts, then at most one a minute.

---

## 7. Build plan

### Step 0: contracts (the lead, one commit, before forking)

This step makes the three packages independent, so nobody edits another package's files.
1. **`src/types.ts`:** all the additions in section 3, in full.
2. **Stubs with final signatures:**
   - `src/lib/palette.ts`:
     - `coverLook(blobKey: string, v: number): Promise<CoverLook | undefined>`, where `CoverLook = { accent?: string; wash: string }`
     - `useCoverLook(blobKey: string, v: Version): CoverLook | undefined`
     - `imageColors(blob: Blob): Promise<[string, string] | undefined>`
     - `accentOf(hex: string): string` (the L 0.76, sRGB-clipped rule from D1, step 7; `colors.ts` uses it for `--pc-accent`)
     - Stubs return `undefined`, and `accentOf` returns its input.
   - `src/lib/appearance.ts`:
     - `ThemeId = 'luma' | 'black' | 'mocha' | 'fjord' | 'rose'`
     - `useAppearance`, a persisted store `{ theme, coverColors, vinyl }` with the defaults from section 2.
     - No side effects yet.
   - `src/ui/Appearance.tsx`: `export function Appearance()`, returning `null`. Leave the return type implicit; React 19's types have no global `JSX`.
   - `src/lib/plays.ts`: `export function addPlays(plays: Play[]): Promise<void>`, which does nothing.
   - `src/lib/stats.ts`: `useOnRepeat(): string[]` returns `[]`, and `useBadges(): Badge[]` returns `[]`.
   - `src/ui/Badges.tsx`: `BadgeRow({ size }: { size: 'card' | 'small' })` returns `null`.
3. **`src/main.tsx`:** `import './lib/appearance.ts'` and `import './lib/plays.ts'` after `base.css`, before `App`.
4. **`THIRD_PARTY_NOTICES.md`:** every entry from section 5, with the exact copyright lines. Include:
   - Lucide's LICENSE whole, with its ISC and Feather MIT parts;
   - Tabler's MIT text;
   - the three palette MIT texts;
   - the OFL, by reference to `src/assets/fonts/OFL-*.txt`;
   - the bundled runtime packages (React, zustand, gifenc MIT; idb-keyval Apache-2.0 in full).
   It also covers the Lucide paths already in `Icon.tsx`.
5. **`npm run check`** green.

After the three packages merge, the lead updates AGENTS.md:
- blob keys `avatar-still`, `banner-still`, `backdrop`, `backdrop-still`, and the `luma-plays` store;
- the new `lib` files and the `ui/profile/` folder;
- styles `themes.css`, `appearance.css`, `wash.css`, `profile.css` and `badges.css`;
- `THIRD_PARTY_NOTICES.md`, and the rule that any copied icon path or font gets an entry there.

Merge order doesn't matter, because the packages own disjoint files.

### File ownership

Each file is changed by exactly one owner. Everything else is read-only for everyone.

| Owner | Files |
|---|---|
| Step 0 (lead) | `src/types.ts`, `src/main.tsx`, `THIRD_PARTY_NOTICES.md`, the stub files (then handed over as listed below) |
| WP-A | `src/lib/palette.ts`, `src/lib/appearance.ts`, `src/ui/Appearance.tsx`, `src/ui/Wash.tsx`, `src/ui/NowPlaying.tsx`, `src/views/Playlist.tsx`, `src/styles/base.css`, `src/styles/player.css`, `src/styles/themes.css`, `src/styles/appearance.css`, `src/styles/wash.css`, `index.html`, `test/palette.test.ts` |
| WP-B | `src/ui/profile/*`, `src/lib/media.ts`, `src/views/You.tsx`, `src/lib/library.ts`, `src/lib/blobs.ts` (header comment only), `src/ui/Art.tsx`, `src/ui/Menu.tsx`, `src/ui/Nav.tsx`, `src/ui/Icon.tsx`, `src/App.tsx` (`Wallpaper` only), `public/sw.js`, `src/styles/library.css`, `src/styles/profile.css`, `src/assets/fonts/*`, `test/media.test.ts`, `test/colors.test.ts`, `test/fixtures/*` (new files) |
| WP-C | `src/lib/plays.ts`, `src/lib/stats.ts`, `src/ui/Badges.tsx`, `src/ui/badgeGlyphs.ts`, `src/styles/badges.css`, `test/plays.test.ts`, `test/stats.test.ts` |
| Lead, after merge | `AGENTS.md` |
| Nobody | `src/lib/player.ts`, `src/lib/queue.ts`, `package.json`, and the GIF maker: `src/lib/gif.ts`, `src/lib/gif.worker.ts`, `src/ui/GifMaker.tsx`, `src/styles/gif.css` (WP-B only imports `GifMaker`) |

### WP-A: Look (Spicetify defaults and Appearance)

**Owns:**

| New files | Changed files |
|---|---|
| `src/lib/palette.ts` (body) | `src/ui/NowPlaying.tsx` |
| `src/lib/appearance.ts` (body) | `src/views/Playlist.tsx` |
| `src/ui/Appearance.tsx` (body) | `src/styles/base.css` |
| `src/ui/Wash.tsx` | `src/styles/player.css` |
| `src/styles/themes.css` | `index.html` (theme script) |
| `src/styles/appearance.css` | |
| `src/styles/wash.css` | |
| `test/palette.test.ts` | |

**Builds:** D1–D5, the five themes, the Appearance group (3 rows) and Vinyl.

**Must not touch:** `library.css`, `Art.tsx`, `Menu.tsx`, `Nav.tsx`, `You.tsx`, `App.tsx`, `library.ts`, `types.ts`, `public/sw.js`.

**Acceptance:**
- `npm run check` is green.
- `test/palette.test.ts` covers:
  - sRGB → OKLCH against known values (±0.005);
  - `pickAccent` returning `undefined` for greyscale pixels;
  - a red-dominant sample giving a hue within 15° of red, with L = 0.76, C ≤ 0.15, and a result inside sRGB;
  - an accent for every hue in 5° steps reaching at least 5.4:1 on `#2e3440`;
  - `imageColors` returning two colors whose hues differ by at least 40°, or the same hue at a different lightness.
- Changing songs eases the mini player's background color over about 600 ms (check its computed `background-color` mid-transition in Playwright).
- A grey cover falls back to the theme accent.
- Cover Colors off shows the theme accent at once.
- No `filter: blur` remains in `player.css`: `rg "blur\(" src/styles/player.css` returns nothing.
- The wash animations pause when Now Playing closes (`getAnimations()[0].playState === 'paused'`), and so does Vinyl.
- Under reduced motion, nothing in Now Playing animates.
- All five themes switch with no reload. In a production build with Fjord stored, `<html>` already has `data-theme="fjord"` and Fjord's background before any module runs (Playwright: block the `assets/*.js` requests with `page.route`, then read the attribute and `getComputedStyle(document.documentElement).backgroundColor`).
- The playlist wash is hidden when a Wallpaper is set.
- On a real iPhone, the Layers check in D2 passes.

**Screenshots** (393×852 and 1440×900 unless noted):
- Now Playing with a colorful cover (phone).
- Now Playing with a grey cover, and with no cover (phone).
- Now Playing in Vinyl, playing (phone).
- Now Playing two-column (1440×900).
- Songs with the tinted mini player (phone).
- Playlist header wash (both sizes).
- The Appearance group (phone).
- Songs in each of the 5 themes (phone).
- Now Playing under reduced motion (phone).

### WP-B: Profile

**Owns:**

| New files | Changed files |
|---|---|
| `src/ui/profile/ProfileCard.tsx` | `src/views/You.tsx` (rewrite; the Background row becomes Wallpaper) |
| `src/ui/profile/ProfileEditor.tsx` | `src/lib/library.ts` (`saveProfile`, `pinSong`/`unpinSong`, pin cleanup in `deleteTrack`/`deletePlaylist`) |
| `src/ui/profile/ProfileMedia.tsx` | `src/ui/Art.tsx` (`Avatar` uses the still) |
| `src/ui/profile/Frame.tsx` + `frames.ts` | `src/ui/Menu.tsx` ("Pin to Profile" / "Unpin from Profile") |
| `src/ui/profile/Effect.tsx` + `effects.ts` | `src/ui/Nav.tsx` (sidebar nameplate, avatar on the You tab) |
| `src/ui/profile/NameStyle.tsx` | `src/ui/Icon.tsx` (`pin`) |
| `src/ui/profile/colors.ts` | `src/styles/library.css` (delete the old `.profile`, `.banner`, `.profile-avatar` and `.profile-name` block; keep `.group`) |
| `src/lib/media.ts` | `src/App.tsx` (`Wallpaper` pauses its video while You shows a playing Background video) |
| `src/styles/profile.css` | `public/sw.js` (`cacheShell` also caches the `assets/` URLs inside the cached CSS) |
| `src/assets/fonts/*` (5 woff2 files + 5 OFL texts) | `src/lib/blobs.ts` (header comment: the new keys) |
| `test/media.test.ts` | |
| `test/colors.test.ts` | |

**Uses (stubbed in Step 0):** `imageColors` and `accentOf` (A), `<Appearance />` (A), `<BadgeRow />` and `useOnRepeat()` (C).

**Must not touch:** `base.css`, `player.css`, `NowPlaying.tsx`, `Playlist.tsx`, `index.html`, the `lib/` files that belong to A or C, and `types.ts`.

**Acceptance:**
- `npm run check` is green.
- `test/media.test.ts` covers:
  - GIF frame counting on 1-frame and 3-frame files, plus a GIF whose image data contains `0x2C` bytes;
  - APNG `acTL` detection and `num_frames`;
  - animated vs still WebP (VP8X flag, `ANMF` count);
  - the cap checks for each slot.
  - Fixtures are made with ffmpeg (`gif`, `apng` and `libwebp_anim` encoders, all present) into `test/fixtures/`, each under 20 KB.
- **Profiles and storage:**
  - An old profile (`{ name, avatar, banner }` only) loads and shows unchanged.
  - Cancel leaves the stored profile and blobs exactly as they were (check the IndexedDB keys before and after).
  - Removing a banner deletes `banner` and `banner-still`.
  - A 5 MB GIF avatar is rejected ("Too Large"). A GIF from the GIF maker is accepted at any size. A 6 MB 4000px JPEG avatar is accepted and stored as 512×512 under 150 KB.
- **Pinning:**
  - Pinning a 6th song drops the last.
  - Deleting a pinned song or playlist removes it from the card.
- **Motion and visibility:**
  - Scrolling the card off screen switches the avatar and banner to stills and pauses the Background video.
  - Opening the editor pauses the page card.
- **Readability:** `test/colors.test.ts` checks at least 4.5:1 for the name (white), the bio (78% white) and `--text-2` (72% white). It covers:
  - every preset;
  - the `#ffffff/#ffffff` and `#000000/#000000` custom pairs;
  - a pure-white Background under the overlay's lightest stop.
- **Offline:** after a new build is installed, a name style's font still loads with the network off.
- **Video:** the iPhone checks in section 6.

**Screenshots:**
- You with an empty profile (both sizes).
- You with a full profile (both sizes): GIF banner, halo frame, aurora name, petals mid-effect, bio, 5 pinned songs, 4 playlists and On Repeat. Seed On Repeat after C merges, or stub it for the shot.
- The editor on each of the 7 tabs (phone).
- The GIF maker opened from the Banner tile, over the editor (phone).
- The editor (1440×900).
- Each frame, effect still and name style (one sheet per kind, phone).
- The sidebar nameplate (1440×900).
- The tab bar with the avatar (phone).
- You under reduced motion (phone).

### WP-C: Listening (play log, stats, badges, On Repeat data)

**Owns:**

| New files (all) |
|---|
| `src/lib/plays.ts` (body) |
| `src/lib/stats.ts` (body) |
| `src/ui/Badges.tsx` (body) |
| `src/ui/badgeGlyphs.ts` |
| `src/styles/badges.css` |
| `test/plays.test.ts` |
| `test/stats.test.ts` |

**Must not touch:** `player.ts` (listen only), `library.ts`, `types.ts`, and any view or style file other than `badges.css`.

**Acceptance:**
- `npm run check` is green.
- `test/plays.test.ts` (on the pure `listen` reducer):
  - 29 s of listening doesn't count; 30 s does.
  - A 16 s song counts at 10 s.
  - A seek (a 30 s jump within 0.25 s of wall time) doesn't add time.
  - Events 4 s apart with 4 s of wall time between them (throttled background) count in full.
  - A wrap in repeat one produces two plays.
  - Pausing at 45 s writes `ms = 45000`.
- `test/stats.test.ts`:
  - A streak across a daylight-saving change is unbroken. Set `process.env.TZ = 'America/New_York'` at the top of the file, and test March and November.
  - Night owl at 23:59 vs 00:00.
  - Session joining at a 10-minute gap.
  - On Repeat ordering, the minimum of 3, and deleted songs left out.
  - Every badge's thresholds at exactly n − 1 and n.
  - A stored tier never drops after a song is deleted.
- **On a device:** play 31 s of a song in dev and check that `luma-plays` has today's key with one entry. Seeding with `addPlays` through Playwright makes badges appear. The lock-screen check is in section 6.
- **Badges on screen:**
  - A fresh tier shines exactly once (after a reload, no shine).
  - Tapping a badge shows only its name and hides it after 1.6 s.

**Screenshots:**
- The card's badge row with all 11 seeded (phone and desktop). Use B's card if it has merged. Otherwise render `<BadgeRow size="card" />` in a local, uncommitted edit of `You.tsx`, take the shot, and revert it.
- The badge bubble (phone).
- One shine frame (phone).
- The On Repeat section with seeded plays (phone, after B merges).

### After all three merge (the lead)

- Run the full screenshot pass at 393×852 and 1440×900.
- Run the iPhone checks in section 6 on a real device.
- Update AGENTS.md as listed under Step 0.
