// Someone's public profile, /u/<handle>: a read-only card from their server row and the public media URLs.
// Works signed out. Pinned songs show art and title; tapping one searches for it (no audio comes from the server).
import { useEffect, useMemo, useRef, useState } from 'react'
import { badgesOf, fetchPublicProfile, pinnedOf, profileFromRow, profilePath } from '../lib/account.ts'
import { usePlayer } from '../lib/player.ts'
import { badgeName } from '../lib/stats.ts'
import { mediaUrl } from '../lib/supabase.ts'
import { Icon } from '../ui/Icon.tsx'
import { ProfileCard, useLive } from '../ui/profile/ProfileCard.tsx'
import type { CardMedia } from '../ui/profile/ProfileMedia.tsx'
import type { MediaKind, ProfileRow } from '../types.ts'
import '../styles/profile.css'

const EFFECT_MS = 8000

const KINDS: Record<'avatar' | 'banner' | 'backdrop', MediaKind[]> = { avatar: ['image', 'animated'], banner: ['image', 'animated'], backdrop: ['image', 'animated', 'video'] }

/** The row's media, only from its own profile folder (the row is anyone's JSON). */
function mediaOf(row: ProfileRow): CardMedia {
  const media: CardMedia = {}
  for (const slot of ['avatar', 'banner', 'backdrop'] as const) {
    const path = profilePath(row, row[`${slot}_path`])
    if (!path) continue
    const still = profilePath(row, row[`${slot}_still_path`])
    const kind = KINDS[slot].find((k) => k === row[`${slot}_kind`]) ?? 'image'
    media[slot] = { url: mediaUrl(path), still: still ? mediaUrl(still) : undefined, kind }
  }
  return media
}

export function User({ handle }: { handle: string }) {
  const [state, setState] = useState<{ row?: ProfileRow | null; offline?: boolean }>({})
  useEffect(() => {
    let live = true
    setState({})
    fetchPublicProfile(handle).then(
      (row) => live && setState({ row }),
      () => live && setState({ offline: true }),
    )
    return () => {
      live = false
    }
  }, [handle])
  const cardRef = useRef<HTMLDivElement>(null)
  const live = useLive(cardRef, !usePlayer((s) => s.open))
  const { row } = state
  const view = useMemo(() => row && { profile: profileFromRow(row), media: mediaOf(row), remote: { pinned: pinnedOf(row), badges: badgesOf(row).map((b) => ({ ...b, name: badgeName(b.id, b.tier), fresh: false })) } }, [row])

  if (!view)
    return (
      <section className="you user-page">
        {(state.offline || row === null) && (
          <div className="user-missing" aria-label={state.offline ? 'Offline' : 'Not Found'} role="img">
            <Icon name={state.offline ? 'offline' : 'user'} size={44} />
          </div>
        )}
      </section>
    )
  return (
    <section className="you user-page">
      <div ref={cardRef}>
        <ProfileCard profile={view.profile} media={view.media} live={live} effectFor={EFFECT_MS} remote={view.remote} claimsVideo />
      </div>
    </section>
  )
}
