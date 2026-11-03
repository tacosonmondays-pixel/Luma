// Avatar, banner and Background media on the card: animated images and videos play only while `play` is on,
// and show their still copy otherwise.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useBlobUrl } from '../../lib/blobs.ts'
import { useCrop } from '../../lib/crop.ts'
import type { ProfileSlot } from '../../lib/library.ts'
import type { Crop, MediaKind, Profile } from '../../types.ts'

export interface ShownMedia {
  url: string
  still?: string
  kind: MediaKind
}

export type CardMedia = Partial<Record<ProfileSlot, ShownMedia>>

/** True while the You page or the editor's preview shows a playing Background video: the app's Wallpaper video
 * pauses meanwhile. */
export const useCardVideo = create<{ playing: boolean }>(() => ({ playing: false }))

function useSaved(profile: Profile, slot: ProfileSlot): ShownMedia | undefined {
  const kind = profile[`${slot}Kind`] ?? 'image'
  const v = profile[slot]
  const url = useBlobUrl(slot, v)
  const still = useBlobUrl(`${slot}-still`, kind === 'image' ? undefined : v)
  return url ? { url, still, kind } : undefined
}

/** Object URLs for the stored profile media. */
export function useSavedMedia(profile: Profile): CardMedia {
  const avatar = useSaved(profile, 'avatar')
  const banner = useSaved(profile, 'banner')
  const backdrop = useSaved(profile, 'backdrop')
  return { avatar, banner, backdrop }
}

/** Which slots may play: at most two at once, in the order avatar, banner, Background. */
export function playingSlots(media: CardMedia, live: boolean): Set<ProfileSlot> {
  const on = new Set<ProfileSlot>()
  if (!live) return on
  for (const slot of ['avatar', 'banner', 'backdrop'] as const) {
    const m = media[slot]
    if (m && m.kind !== 'image' && on.size < 2) on.add(slot)
  }
  return on
}

/** One slot's media, placed by its crop inside the parent `.crop-box`. */
export function ProfileMedia({ media, play, crop, className }: { media: ShownMedia; play: boolean; crop?: Crop; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const { onLoad, onLoadedMetadata, ...placed } = useCrop(crop, className)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (play) video.play().catch(() => {}) // Low Power Mode blocks autoplay: the poster stays
    else video.pause()
  }, [play, media.url])

  if (media.kind === 'video')
    return (
      <video
        ref={ref}
        {...placed}
        onLoadedMetadata={onLoadedMetadata}
        src={media.url}
        poster={media.still}
        muted
        playsInline
        loop
        autoPlay={play}
        disablePictureInPicture
        disableRemotePlayback
        preload="metadata"
      />
    )
  const src = media.kind === 'animated' && !play ? (media.still ?? media.url) : media.url
  return <img {...placed} onLoad={onLoad} src={src} alt="" draggable={false} />
}
