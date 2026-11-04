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
// The ids, in display order. The server accepts only these (luma.ids() in supabase/migrations/0001_luma.sql).
export const FRAME_IDS = ['halo', 'aurora', 'vinyl', 'orbit', 'equalizer', 'laurel', 'blossoms', 'sparkles'] as const
export const EFFECT_IDS = ['petals', 'snow', 'sparkles', 'stars', 'notes', 'fireflies'] as const
export const NAME_STYLE_IDS = ['shimmer', 'aurora', 'chrome', 'neon', 'glitch', 'wave', 'pop', 'sparkle', 'outline', 'pixel', 'script'] as const
export type FrameId = (typeof FRAME_IDS)[number]
export type EffectId = (typeof EFFECT_IDS)[number]
export type NameStyleId = (typeof NAME_STYLE_IDS)[number]

/** Which part of a profile image shows in its frame: the focus point (0..1 of the source, kept at the frame's
 * center as far as the edges allow) and a zoom of 1 (cover) to 4. Undefined = centered at 1×. */
export interface Crop {
  x: number
  y: number
  zoom: number
}

export interface Profile {
  name: string
  avatar?: number // blob `avatar` (+ `avatar-still` when avatarKind is 'animated')
  avatarKind?: MediaKind // undefined = 'image'; never 'video' (videos become GIFs through the GIF maker)
  banner?: number // blob `banner` (+ `banner-still`)
  bannerKind?: MediaKind // never 'video'
  backdrop?: number // blob `backdrop` (+ `backdrop-still`): the card's own background (not the app wallpaper `background`)
  backdropKind?: MediaKind
  avatarCrop?: Crop
  bannerCrop?: Crop
  backdropCrop?: Crop
  colors?: [string, string] // '#rrggbb' top, bottom; undefined = Auto
  autoColors?: [string, string] // from the avatar's still (else the banner's)
  frame?: FrameId
  effect?: EffectId
  nameStyle?: NameStyleId
  bio?: string // up to 190 characters
  pinnedSongs?: string[] // up to 5 track ids, newest first
  pinnedPlaylists?: string[] // up to 6 playlist ids
}

// ── Listening ───────────────────────────────────────────────────────────

/** One listen, logged by plays.ts: [track id, started at (ms since epoch), listened ms]. */
export type Play = [id: string, at: number, ms: number]

export const BADGE_IDS = [
  'first-spin', 'hours', 'streak', 'on-repeat', 'night-owl', 'early-bird', 'marathon', 'explorer', 'crate-digger', 'curator', 'founder',
] as const
export type BadgeId = (typeof BADGE_IDS)[number]
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

// ── Server (Supabase, supabase/migrations/) ─────────────────────────────

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
  sharing_since: string | null // the server's time when sharing last turned on
  created_at: string
  updated_at: string
}

export type RedeemResult = 'ok' | 'member' | 'invalid' | 'rate_limited' | 'banned'

/** A `videos` row. Paths are '<user_id>/videos/<file>'; the song is metadata only. */
export interface VideoRow {
  id: string
  user_id: string
  path: string
  still_path: string | null
  caption: string
  youtube_id: string | null
  track_title: string | null
  track_artist: string | null
  duration: number
  created_at: string
  removed_at: string | null
}

/** A `posts` row: text and up to 4 images ('<user_id>/posts/<file>'), and a song as metadata (0002). */
export interface PostRow {
  id: string
  user_id: string
  body: string
  image_paths: string[]
  youtube_id: string | null
  track_title: string | null
  track_artist: string | null
  created_at: string
  removed_at: string | null
}

/** A `plays` row as the feed reads it. */
export interface PlayRow {
  user_id: string
  track_id: string
  youtube_id: string | null
  title: string
  artist: string
  played_at: string
}

export interface FollowRow {
  follower_id: string
  followee_id: string
  created_at: string
}

export type ReportKind = 'profile' | 'video' | 'post'
/** The reasons the app offers. The column takes any text up to 500 characters. */
export const REPORT_REASONS = ['spam', 'abuse', 'explicit', 'copyright', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export interface ReportRow {
  id: string
  reporter_id: string
  kind: ReportKind
  target_id: string
  reason: string
  created_at: string
  resolved_at: string | null
}

/** A row of `luma_search(q)`, best first. */
export interface LumaSearchRow {
  kind: ReportKind
  id: string
  user_id: string
  handle: string
  title: string
  rank: number
}
