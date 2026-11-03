// The profile card: banner, avatar with its frame, the styled name, badges, bio, then Pinned, Playlists and
// On Repeat. The same card shows on You and in the editor's live preview. Its layout follows its own width
// (a container query), so the preview at 440px matches the phone.
import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import { useLibrary } from '../../lib/library.ts'
import { playTracks, usePlayer } from '../../lib/player.ts'
import { useOnRepeat } from '../../lib/stats.ts'
import type { Profile } from '../../types.ts'
import { PlaylistArt, TrackArt } from '../Art.tsx'
import { BadgeRow } from '../Badges.tsx'
import { Icon } from '../Icon.tsx'
import { Link } from '../kit.tsx'
import { profileColors } from './colors.ts'
import { Effect } from './Effect.tsx'
import { Frame } from './Frame.tsx'
import { NameStyle } from './NameStyle.tsx'
import { playingSlots, ProfileMedia, useCardVideo, type CardMedia } from './ProfileMedia.tsx'
import '../../styles/profile.css'

const reducedQuery = () => matchMedia('(prefers-reduced-motion: reduce)')

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedQuery().matches)
  useEffect(() => {
    const query = reducedQuery()
    const on = () => setReduced(query.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [])
  return reduced
}

/** On screen, the page visible, and motion allowed. */
export function useLive(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [onScreen, setOnScreen] = useState(true)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0 })
    observer.observe(el)
    const onVisibility = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ref])
  return enabled && onScreen && visible && !reduced
}

function Initial({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase()
  return initial ? <span className="pc-initial">{initial}</span> : <Icon name="user" size={48} />
}

function Pinned({ ids }: { ids: string[] }) {
  const tracks = useLibrary((s) => s.tracks)
  const currentId = usePlayer((s) => s.queue.ids[s.queue.index])
  const playing = usePlayer((s) => s.playing)
  const shown = ids.filter((id) => tracks[id])
  if (!shown.length) return null
  return (
    <section className="pc-section" data-section="pinned">
      <h3>Pinned</h3>
      <ul className="pc-pinned">
        {shown.map((id, i) => {
          const track = tracks[id]
          const current = id === currentId
          return (
            <li key={id}>
              <button type="button" className={`pc-song${current ? ' current' : ''}`} onClick={() => playTracks(shown, i)}>
                <TrackArt track={track} size={40} playing={current ? playing : undefined} />
                <span className="pc-song-text">
                  <span className="pc-song-title ellipsis">{track.title}</span>
                  {track.artist && <span className="pc-song-artist ellipsis">{track.artist}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Playlists({ ids }: { ids: string[] }) {
  const playlists = useLibrary((s) => s.playlists)
  const shown = ids.map((id) => playlists.find((p) => p.id === id)).filter((p) => !!p)
  if (!shown.length) return null
  return (
    <section className="pc-section" data-section="playlists">
      <h3>Playlists</h3>
      <div className="pc-playlists">
        {shown.map((p) => (
          <Link key={p.id} to={`/playlist/${p.id}`} className="pc-playlist">
            <PlaylistArt playlist={p} />
            <span className="ellipsis">{p.name}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function OnRepeat() {
  const ids = useOnRepeat()
  const tracks = useLibrary((s) => s.tracks)
  const shown = ids.filter((id) => tracks[id])
  if (shown.length < 3) return null
  return (
    <section className="pc-section" data-section="on-repeat">
      <h3>On Repeat</h3>
      <div className="pc-repeat">
        {shown.map((id, i) => (
          <button key={id} type="button" className="pc-repeat-item" onClick={() => playTracks(shown, i)}>
            <TrackArt track={tracks[id]} />
            <span className="ellipsis">{tracks[id].title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

interface CardProps {
  profile: Profile
  media: CardMedia
  live: boolean
  /** ms the effect plays before fading; omit to loop (the editor preview). */
  effectFor?: number
  onEdit?: () => void
  /** Bump to play the effect again from the start (picking one in the editor). */
  effectRun?: number
  /** Tells the Wallpaper to pause while this card plays a Background video (the You page, the editor's preview). */
  claimsVideo?: boolean
}

export function ProfileCard({ profile, media, live, effectFor, effectRun = 0, onEdit, claimsVideo }: CardProps) {
  const playing = usePlayer((s) => s.playing)
  const reduced = useReducedMotion()
  const plays = playingSlots(media, live)
  const { avatar, banner, backdrop } = media
  const backdropPlaying = !!backdrop && backdrop.kind === 'video' && plays.has('backdrop')

  useEffect(() => {
    if (!claimsVideo || !backdropPlaying) return
    useCardVideo.setState({ playing: true })
    return () => useCardVideo.setState({ playing: false })
  }, [claimsVideo, backdropPlaying])

  const style = profileColors(profile, !!backdrop) as CSSProperties
  const name = profile.name.trim()
  return (
    <div className="pc-wrap" style={style}>
      <i className="pc-ring" aria-hidden="true" />
      <article className={`pc${backdrop ? ' has-backdrop' : ''}`} data-still={live ? undefined : ''}>
        {backdrop && (
          <div className="pc-backdrop crop-box" aria-hidden="true">
            <ProfileMedia media={backdrop} play={plays.has('backdrop')} crop={profile.backdropCrop} />
          </div>
        )}
        <div className="pc-banner crop-box">{banner && <ProfileMedia media={banner} play={plays.has('banner')} crop={profile.bannerCrop} />}</div>
        {onEdit && (
          <button type="button" className="pill pc-edit" onClick={onEdit}>
            Edit Profile
          </button>
        )}
        <div className="pc-avatar">
          <div className="pc-photo crop-box">{avatar ? <ProfileMedia media={avatar} play={plays.has('avatar')} crop={profile.avatarCrop} /> : <Initial name={profile.name} />}</div>
          <Frame id={profile.frame} live={live} />
          {playing && (
            <span className="pc-dot" aria-hidden="true">
              <span className="bars on">
                <i />
                <i />
                <i />
              </span>
            </span>
          )}
        </div>
        <div className="pc-body">
          <div className="pc-id">
            {name && (
              <h2 className="pc-name">
                <NameStyle key={profile.nameStyle ?? ''} name={name} style={profile.nameStyle} />
              </h2>
            )}
            <div className="pc-badges">
              <BadgeRow size="card" />
            </div>
            {profile.bio?.trim() && <p className="pc-bio">{profile.bio.trim()}</p>}
          </div>
          <div className="pc-sections">
            <Pinned ids={profile.pinnedSongs ?? []} />
            <Playlists ids={profile.pinnedPlaylists ?? []} />
            <OnRepeat />
          </div>
        </div>
        {profile.effect && (
          <Effect key={`${profile.effect}-${effectRun}`} id={profile.effect} live={live} duration={effectFor} still={reduced} className="pc-effect" />
        )}
      </article>
    </div>
  )
}
