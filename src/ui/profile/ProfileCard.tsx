// The profile card: banner, avatar with its frame, the styled name, badges and bio. What is pinned and played sits
// beside it on the Board (Board.tsx). The same card shows on You, on someone's page and in the editor's live
// preview. Its layout follows its own width (a container query).
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { usePlayer } from '../../lib/player.ts'
import type { Badge, Profile } from '../../types.ts'
import { BadgeRow } from '../Badges.tsx'
import { Icon, type IconName } from '../Icon.tsx'
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

interface CardProps {
  profile: Profile
  media: CardMedia
  live: boolean
  /** ms the effect plays before fading; omit to loop (the editor preview). */
  effectFor?: number
  /** The buttons at the banner's lower right: `CardIcon`s and `.pill.pc-edit` pills. */
  actions?: ReactNode
  /** Bump to play the effect again from the start (picking one in the editor). */
  effectRun?: number
  /** Tells the Wallpaper to pause while this card plays a Background video (the You page, the editor's preview). */
  claimsVideo?: boolean
  /** Someone's public profile (/u/:handle): its badges come from the server, not this library. */
  remote?: { badges: Badge[] }
}

/** A round button among the card's actions (Share, More). */
export function CardIcon({ icon, label, onClick }: { icon: IconName; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className="pill pc-edit pc-share" aria-label={label} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
  )
}

export function ProfileCard({ profile, media, live, effectFor, effectRun = 0, actions, claimsVideo, remote }: CardProps) {
  const playing = usePlayer((s) => s.playing) && !remote
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
        {actions && <div className="pc-actions">{actions}</div>}
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
              <BadgeRow size="card" badges={remote?.badges} />
            </div>
            {profile.bio?.trim() && <p className="pc-bio">{profile.bio.trim()}</p>}
          </div>
        </div>
        {profile.effect && (
          <Effect key={`${profile.effect}-${effectRun}`} id={profile.effect} live={live} duration={effectFor} still={reduced} className="pc-effect" />
        )}
      </article>
    </div>
  )
}
