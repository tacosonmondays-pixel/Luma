import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useBlobUrl } from '../lib/blobs.ts'
import { setBackground, useLibrary } from '../lib/library.ts'
import { usePlayer } from '../lib/player.ts'
import { detect, useSource } from '../lib/source.ts'
import { setYouTubeKey, useYouTubeKey } from '../lib/youtube.ts'
import { useAccount } from '../lib/account.ts'
import { loadPosts, personOf, useMe, useSocial, type Me } from '../lib/social.ts'
import { useViewer } from '../lib/viewer.ts'
import { AccountRows } from '../ui/Account.tsx'
import { Appearance } from '../ui/Appearance.tsx'
import { Composer } from '../ui/Composer.tsx'
import { YouTubeRow } from '../ui/YouTube.tsx'
import { Icon } from '../ui/Icon.tsx'
import { pickFiles } from '../ui/kit.tsx'
import { openMenu } from '../ui/Menu.tsx'
import { PeopleSheet, profileMenuItems } from '../ui/People.tsx'
import { PostCard } from '../ui/Post.tsx'
import { CardIcon, ProfileCard, useLive } from '../ui/profile/ProfileCard.tsx'
import { GhostShelf, Row, Shelf } from '../ui/Shelf.tsx'
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
  const viewing = useViewer((s) => !!s.post)
  // Now Playing and the Viewer cover the page completely, and the observer can't tell: the card rests behind them too.
  const covered = usePlayer((s) => s.open) || viewing
  const live = useLive(cardRef, !editing && !covered)
  // A member, online: New Post, More (Share Profile, Following, Followers) and the Posts shelf.
  const me = useMe()
  const row = useAccount((s) => s.row)
  const [composing, setComposing] = useState(false)
  const [people, setPeople] = useState<'following' | 'followers'>()
  const more = (e: MouseEvent<HTMLButtonElement>) => {
    const person = row && personOf(row)
    if (person) openMenu(e.currentTarget, profileMenuItems({ person, self: true, onPeople: setPeople }))
  }

  return (
    <section className="you">
      <div ref={cardRef}>
        <ProfileCard
          profile={profile}
          media={media}
          live={live}
          effectFor={EFFECT_MS}
          actions={
            <>
              {me && <CardIcon icon="plus" label="New Post" onClick={() => setComposing(true)} />}
              {me && <CardIcon icon="more" label="More" onClick={more} />}
              <button type="button" className="pill pc-edit" onClick={() => setEditing(true)}>
                Edit Profile
              </button>
            </>
          }
          claimsVideo
        />
      </div>
      {me && <MyPosts me={me} />}
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
      {composing && <Composer onClose={() => setComposing(false)} />}
      {people && me && <PeopleSheet userId={me.id} which={people} onClose={() => setPeople(undefined)} />}
    </section>
  )
}

/** My posts, newest first (a new one shows here as soon as it's up); the chevron opens my public page. */
function MyPosts({ me }: { me: Me }) {
  const list = useSocial((s) => s.lists[me.id])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    void loadPosts(me.id).finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [me.id])
  if (!list?.items.length) return loaded ? null : <div className="you-posts"><GhostShelf title="Posts" /></div>
  return (
    <div className="you-posts">
      <Shelf title="Posts" more={`/u/${me.handle}`}>
        {/* A new first post starts the row over: a phone's snapped row would otherwise keep the old first in view. */}
        <Row key={`${list.items[0].kind}:${list.items[0].id}`}>
          {list.items.slice(0, 12).map((post) => (
            <PostCard key={`${post.kind}:${post.id}`} post={post} />
          ))}
        </Row>
      </Shelf>
    </div>
  )
}
