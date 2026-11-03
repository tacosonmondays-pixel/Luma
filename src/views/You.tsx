import { useBlobUrl } from '../lib/blobs.ts'
import { setBackground, setProfileImage, setProfileName, useLibrary } from '../lib/library.ts'
import { Avatar } from '../ui/Art.tsx'
import { Icon } from '../ui/Icon.tsx'
import { pickFiles } from '../ui/kit.tsx'
import '../styles/library.css'

const pickImage = (which: 'avatar' | 'banner') => () =>
  void pickFiles('image/*').then(([file]) => file && setProfileImage(which, file))

function BackgroundThumb() {
  const background = useLibrary((s) => s.background)
  const url = useBlobUrl('background', background?.v)
  if (!background || !url) return null
  return (
    <span className="bg-thumb">
      {background.kind === 'video' ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" /> : <img src={url} alt="" />}
    </span>
  )
}

export function You() {
  const profile = useLibrary((s) => s.profile)
  const hasBackground = useLibrary((s) => !!s.background)
  const banner = useBlobUrl('banner', profile.banner)

  return (
    <section className="profile">
      <button type="button" className="banner" aria-label="Change Banner" onClick={pickImage('banner')}>
        {banner && <img src={banner} alt="" draggable={false} />}
      </button>
      <button type="button" className="profile-avatar" aria-label="Change Photo" onClick={pickImage('avatar')}>
        <Avatar size={104} />
      </button>
      <input
        className="profile-name"
        aria-label="Name"
        placeholder="Name"
        value={profile.name}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setProfileName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="group">
        <button type="button" className="group-row" onClick={() => void pickFiles('image/*,video/*').then(([file]) => file && setBackground(file))}>
          <span>Background</span>
          <span className="group-value">
            <BackgroundThumb />
            <Icon name="chevron-right" size={18} />
          </span>
        </button>
        {hasBackground && (
          <button type="button" className="group-row danger" onClick={() => void setBackground(null)}>
            Remove Background
          </button>
        )}
      </div>
    </section>
  )
}
