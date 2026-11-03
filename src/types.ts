// Shared data shapes. The server imports these as types only.

/** A blob version. Undefined means "no blob". Bump it to replace the blob. */
export type Version = number | undefined

export interface Track {
  id: string // YouTube video id, or `f-…` for imported files
  title: string
  artist: string
  duration: number // seconds, 0 when unknown
  source: 'youtube' | 'file'
  addedAt: number
  cover?: number // blob `cover:<id>`
  canvas?: number // blob `canvas:<id>`: a looping image/GIF/video shown behind the Canvas player style
  canvasKind?: MediaKind
  missing?: true // saved (from YouTube) or synced from another device: the metadata is here, the audio isn't yet
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  cover?: number // blob `playlist-cover:<id>`
  youtubeId?: string // linked to this YouTube playlist: Refresh from YouTube adds its new songs
}

// ── Profile ─────────────────────────────────────────────────────────────

export type MediaKind = 'image' | 'animated' | 'video'
export type FrameId = 'halo' | 'aurora' | 'vinyl' | 'orbit' | 'equalizer' | 'laurel' | 'blossoms' | 'sparkles'
export type EffectId = 'petals' | 'snow' | 'sparkles' | 'stars' | 'notes' | 'fireflies'
export type NameStyleId =
  | 'shimmer' | 'aurora' | 'chrome' | 'neon' | 'glitch' | 'wave' | 'pop' | 'sparkle' | 'outline' | 'pixel' | 'script'

export interface Profile {
  name: string
  avatar?: number // blob `avatar` (+ `avatar-still` when avatarKind is 'animated')
  avatarKind?: MediaKind // undefined = 'image'; never 'video' (videos become GIFs through the GIF maker)
  banner?: number // blob `banner` (+ `banner-still`)
  bannerKind?: MediaKind // never 'video'
  backdrop?: number // blob `backdrop` (+ `backdrop-still`): the card's own background (not the app wallpaper `background`)
  backdropKind?: MediaKind
  colors?: [string, string] // '#rrggbb' top, bottom; undefined = Auto
  autoColors?: [string, string] // from the avatar's still (else the banner's)
  frame?: FrameId
  effect?: EffectId
  nameStyle?: NameStyleId
  bio?: string // up to 190 characters
  pinnedSongs?: string[] // up to 5 track ids, newest first
  pinnedPlaylists?: string[] // up to 6 playlist ids
  avatarCrop?: Crop // the visible position and zoom of each image
  bannerCrop?: Crop
  backdropCrop?: Crop
}

export interface Crop {
  x: number
  y: number
  zoom: number
}

// ── Listening ───────────────────────────────────────────────────────────

/** One listen, logged by plays.ts: [track id, started at (ms since epoch), listened ms]. */
export type Play = [id: string, at: number, ms: number]

export type BadgeId =
  | 'first-spin' | 'hours' | 'streak' | 'on-repeat' | 'night-owl' | 'early-bird'
  | 'marathon' | 'explorer' | 'crate-digger' | 'curator' | 'founder'
export type Tier = 1 | 2 | 3 | 4 // bronze, silver, gold, holo
export interface Badge {
  id: BadgeId
  tier: Tier
  name: string
  fresh: boolean
}

export interface Background {
  v: number // blob `background`
  kind: 'image' | 'video'
}

// ── Helper API (server/api.ts) ──────────────────────────────────────────

export type SearchSort = 'relevance' | 'recent' | 'popular'

export interface SearchResult {
  id: string // 11-character YouTube video id
  title: string
  channel: string
  duration: number // seconds, 0 when unknown (e.g. live)
}

export interface SearchResponse {
  results: SearchResult[]
  playlist?: string // title, when the query was a playlist link
}

export interface Health {
  ok: true
  ytdlp: string | null // yt-dlp version, null when it is not installed
}

/** Error body for every non-2xx /api response. */
export interface ApiError {
  error: 'ytdlp-missing' | 'bad-request' | 'not-found' | 'failed'
}

// ── Server (Supabase, supabase/migrations/0001_luma.sql) ────────────────

/** A pinned song as the public profile shows it: metadata only, never audio. */
export interface PinnedSong {
  id: string
  title: string
  artist: string
  source: Track['source']
}

/** A `profiles` row. */
export interface ProfileRow {
  id: string
  handle: string | null
  member: boolean
  admin: boolean
  banned: boolean
  name: string
  bio: string | null
  colors: [string, string] | null
  auto_colors: [string, string] | null
  frame: FrameId | null
  effect: EffectId | null
  name_style: NameStyleId | null
  pinned_songs: PinnedSong[]
  pinned_playlists: string[]
  badges: { id: BadgeId; tier: Tier }[]
  avatar_path: string | null
  avatar_still_path: string | null
  avatar_kind: MediaKind | null
  avatar_version: number | null
  banner_path: string | null
  banner_still_path: string | null
  banner_kind: MediaKind | null
  banner_version: number | null
  backdrop_path: string | null
  backdrop_still_path: string | null
  backdrop_kind: MediaKind | null
  backdrop_version: number | null
  crops: Partial<Record<'avatar' | 'banner' | 'backdrop', Crop>>
  share_activity: boolean
  created_at: string
  updated_at: string
}

export type RedeemResult = 'ok' | 'member' | 'invalid' | 'rate_limited' | 'banned'
