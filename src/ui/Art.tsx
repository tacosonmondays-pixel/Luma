import type { CSSProperties } from 'react'
import { useBlobUrl } from '../lib/blobs.ts'
import { useCrop } from '../lib/crop.ts'
import { gradientFor } from '../lib/format.ts'
import { useLibrary } from '../lib/library.ts'
import { Icon } from './Icon.tsx'
import type { Crop, Playlist, Track, Version } from '../types.ts'

interface ArtProps {
  blobKey: string
  v: Version
  seed: string // picks the fallback gradient
  size?: number // px; omit to fill the parent
  className?: string
  playing?: boolean // show the animated "now playing" bars
}

/** Square artwork: the stored image, or a gradient with a note (the playing bars take the note's place). */
export function Art({ blobKey, v, seed, size, className = '', playing }: ArtProps) {
  const url = useBlobUrl(blobKey, v)
  const style: CSSProperties = { background: url ? undefined : gradientFor(seed) }
  if (size) Object.assign(style, { width: size, height: size })
  return (
    <div className={`art ${className}`} style={style}>
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        playing === undefined && <Icon name="music" size={size ? Math.round(size * 0.4) : 32} />
      )}
      {playing !== undefined && (
        <span className={`bars${playing ? ' on' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  )
}

export function TrackArt({ track, ...rest }: { track: Track } & Omit<ArtProps, 'blobKey' | 'v' | 'seed'>) {
  return <Art blobKey={`cover:${track.id}`} v={track.cover} seed={track.title + track.artist} {...rest} />
}

/** A playlist's own cover, else its first song's cover. */
export function PlaylistArt({ playlist, ...rest }: { playlist: Playlist } & Omit<ArtProps, 'blobKey' | 'v' | 'seed'>) {
  const first = useLibrary((s) => s.tracks[playlist.trackIds[0] ?? ''])
  if (playlist.cover) return <Art blobKey={`playlist-cover:${playlist.id}`} v={playlist.cover} seed={playlist.id} {...rest} />
  if (first) return <TrackArt track={first} {...rest} />
  return <Art blobKey="" v={undefined} seed={playlist.id} {...rest} />
}

/** A profile image placed by its crop. Its parent is the `.crop-box`. */
export function CropImg({ src, crop }: { src: string; crop?: Crop }) {
  const { onLoadedMetadata: _, ...props } = useCrop(crop)
  return <img src={src} alt="" draggable={false} {...props} />
}

/** The profile photo (always its still: lists and bars never animate), else the first letter of the name. */
export function Avatar({ size }: { size: number }) {
  const profile = useLibrary((s) => s.profile)
  const animated = !!profile.avatarKind && profile.avatarKind !== 'image'
  const url = useBlobUrl(animated ? 'avatar-still' : 'avatar', profile.avatar)
  const initial = profile.name.trim().charAt(0).toUpperCase()
  // Without a photo: --fill-2 made opaque, so it looks the same over the banner, the page and a wallpaper.
  const background = url ? undefined : 'linear-gradient(var(--fill-2), var(--fill-2)) var(--bg)'
  return (
    <div className="art round crop-box" style={{ width: size, height: size, background }}>
      {url ? (
        <CropImg src={url} crop={profile.avatarCrop} />
      ) : initial ? (
        <span className="avatar-initial" style={{ fontSize: size * 0.42 }}>
          {initial}
        </span>
      ) : (
        <Icon name="user" size={Math.round(size * 0.55)} />
      )}
    </div>
  )
}
