import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBlobUrl } from '../lib/blobs.ts'
import { setBackground, useLibrary } from '../lib/library.ts'
import { usePlayer } from '../lib/player.ts'
import { detect, useSource } from '../lib/source.ts'
import { setYouTubeKey, useYouTubeKey } from '../lib/youtube.ts'
import { profileLink, useAccount } from '../lib/account.ts'
import { AccountRows } from '../ui/Account.tsx'
import { Appearance } from '../ui/Appearance.tsx'
import { YouTubeRow } from '../ui/YouTube.tsx'
import { Icon } from '../ui/Icon.tsx'
import { pickFiles } from '../ui/kit.tsx'
import { ProfileCard, useLive } from '../ui/profile/ProfileCard.tsx'
import { ProfileEditor } from '../ui/profile/ProfileEditor.tsx'
import { useSavedMedia } from '../ui/profile/ProfileMedia.tsx'
import '../styles/library.css'
import '../styles/profile.css'

function WallpaperThumb() {
  const background = useLibrary((s) => s.background)
  const url = useBlobUrl('background', background?.v)
  if (!background || !url) return null
  return (
    <span className="bg-thumb">
      {background.kind === 'video' ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" /> : <img src={url} alt="" />}
    </span>
  )
}

/** Phone mode only: the helper searches with yt-dlp instead. */
function YouTubeKey() {
  const mode = useSource((s) => s.mode)
  const key = useYouTubeKey()
  useEffect(() => {
    if (!useSource.getState().mode) void detect()
  }, [])
  if (mode !== 'phone') return null
  return (
    <label className="group-row">
      <span>YouTube Key</span>
      <input
        className="group-input"
        aria-label="YouTube Key"
        value={key}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => setYouTubeKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

/** The effect plays this long when the card first shows, then fades. */
const EFFECT_MS = 8000

export function You() {
  const profile = useLibrary((s) => s.profile)
  const hasBackground = useLibrary((s) => !!s.background)
  const media = useSavedMedia(profile)
  const [editing, setEditing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // Now Playing covers the page completely, and the observer can't tell: the card rests behind it too.
  const covered = usePlayer((s) => s.open)
  const live = useLive(cardRef, !editing && !covered)
  const handle = useAccount((s) => (s.row?.member && !s.row.banned ? s.row.handle : null))
  const share = async () => {
    if (!handle) return
    const url = profileLink(handle)
    try {
      if (navigator.share) return await navigator.share({ url })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
    await navigator.clipboard?.writeText(url).catch(() => {})
  }

  return (
    <section className="you">
      <div ref={cardRef}>
        <ProfileCard profile={profile} media={media} live={live} effectFor={EFFECT_MS} onEdit={() => setEditing(true)} onShare={handle ? () => void share() : undefined} claimsVideo />
      </div>
      <div className="you-settings">
        <Appearance />
        <div className="group">
          <button type="button" className="group-row" onClick={() => void pickFiles('image/*,video/*').then(([file]) => file && setBackground(file))}>
            <span>Wallpaper</span>
            <span className="group-value">
              <WallpaperThumb />
              <Icon name="chevron-right" size={18} />
            </span>
          </button>
          {hasBackground && (
            <button type="button" className="group-row danger" onClick={() => void setBackground(null)}>
              Remove Wallpaper
            </button>
          )}
          <YouTubeKey />
          <YouTubeRow />
          <AccountRows />
        </div>
      </div>
      {/* On body, beside Now Playing and the menu: Y2K's desktop window would otherwise trap it under the player bar. */}
      {editing && createPortal(<ProfileEditor onClose={() => setEditing(false)} />, document.body)}
    </section>
  )
}
