// The settings, inside Edit Profile: Theme, Cover Colors, Player Style; Wallpaper; the YouTube key (phone mode);
// Connect YouTube; and the account rows (Sign In, the handle, Sync, Invite, Reports, Sign Out).
import { useEffect, useState } from 'react'
import { useBlobUrl } from '../lib/blobs.ts'
import { masked } from '../lib/board.ts'
import { setBackground, useLibrary } from '../lib/library.ts'
import { detect, useSource } from '../lib/source.ts'
import { setYouTubeKey, useYouTubeKey } from '../lib/youtube.ts'
import { AccountRows } from './Account.tsx'
import { Appearance } from './Appearance.tsx'
import { Icon } from './Icon.tsx'
import { pickFiles } from './kit.tsx'
import { YouTubeRow } from './YouTube.tsx'
import '../styles/appearance.css'

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

/** Phone mode only: the helper searches with yt-dlp instead. At rest it shows only the key's last 4 characters;
 *  the whole key shows while the field is being edited. */
function YouTubeKey() {
  const mode = useSource((s) => s.mode)
  const key = useYouTubeKey()
  const [editing, setEditing] = useState(false)
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
        value={editing ? key : masked(key)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => editing && setYouTubeKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}

export function Settings() {
  const hasBackground = useLibrary((s) => !!s.background)
  return (
    <div className="settings">
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
  )
}
