// Your profile: the card, and beside it (under it on a phone) the tabs: Board (what you pinned), Activity (what you
// played: Recently Played and On Repeat) and Posts. Settings live in Edit Profile.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from '../lib/account.ts'
import { useHome } from '../lib/home.ts'
import { pinPlaylist, unpinPlaylist, unpinSong, useLibrary } from '../lib/library.ts'
import { usePlayer } from '../lib/player.ts'
import { loadPlays, usePlayLog } from '../lib/plays.ts'
import { jumpBackIn } from '../lib/shelves.ts'
import { loadPosts, personOf, useMe, useSocial, type Me } from '../lib/social.ts'
import { useOnRepeat } from '../lib/stats.ts'
import { useViewer } from '../lib/viewer.ts'
import { Composer } from '../ui/Composer.tsx'
import { openMenu, type MenuItem } from '../ui/Menu.tsx'
import { PeopleSheet, profileMenuItems } from '../ui/People.tsx'
import { PostGrid } from '../ui/Post.tsx'
import { BoardSection, ItemGrid, playlistItems, ProfileTabs, songItems } from '../ui/profile/Board.tsx'
import { CardIcon, ProfileCard, useLive } from '../ui/profile/ProfileCard.tsx'
import { ProfileEditor, type EditorStart } from '../ui/profile/ProfileEditor.tsx'
import { useSavedMedia } from '../ui/profile/ProfileMedia.tsx'
import type { Play } from '../types.ts'
import '../styles/library.css'
import '../styles/profile.css'

/** The effect plays this long when the card first shows, then fades. */
const EFFECT_MS = 8000
const none: Play[] = []

export function You() {
  const profile = useLibrary((s) => s.profile)
  const media = useSavedMedia(profile)
  const [editing, setEditing] = useState<EditorStart | false>(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const viewing = useViewer((s) => !!s.post)
  // Now Playing and the Viewer cover the page completely, and the observer can't tell: the card rests behind them too.
  const covered = usePlayer((s) => s.open) || viewing
  const live = useLive(cardRef, !editing && !covered)
  // A member, online: New Post, More (Share Profile, Following, Followers) and the Posts tab.
  const me = useMe()
  const row = useAccount((s) => s.row)
  const [composing, setComposing] = useState(false)
  const [people, setPeople] = useState<'following' | 'followers'>()
  const more = (e: MouseEvent<HTMLButtonElement>) => {
    const person = row && personOf(row)
    if (person) openMenu(e.currentTarget, profileMenuItems({ person, self: true, onPeople: setPeople }))
  }

  return (
    <section className="profile you">
      <div className="profile-side" ref={cardRef}>
        <ProfileCard
          profile={profile}
          media={media}
          live={live}
          effectFor={EFFECT_MS}
          actions={
            <>
              {me && <CardIcon icon="plus" label="New Post" onClick={() => setComposing(true)} />}
              {me && <CardIcon icon="more" label="More" onClick={more} />}
              <button type="button" className="pill pc-edit" onClick={() => setEditing('Profile')}>
                Edit Profile
              </button>
            </>
          }
          claimsVideo
        />
      </div>
      <MyTabs me={me} onEditPins={() => setEditing('Pinned')} />
      {/* On body, beside Now Playing and the menu: Y2K's desktop window would otherwise trap it under the player bar. */}
      {editing && createPortal(<ProfileEditor start={editing} onClose={() => setEditing(false)} />, document.body)}
      {composing && <Composer onClose={() => setComposing(false)} />}
      {people && me && <PeopleSheet userId={me.id} which={people} onClose={() => setPeople(undefined)} />}
    </section>
  )
}

function MyTabs({ me, onEditPins }: { me?: Me; onEditPins: () => void }) {
  const profile = useLibrary((s) => s.profile)
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const plays = usePlayLog((s) => s.plays) ?? none
  const played = useHome((s) => s.played)
  const repeat = useOnRepeat().filter((id) => tracks[id])
  const posts = useSocial((s) => (me ? s.lists[me.id]?.items.length : 0))
  useEffect(() => void loadPlays(), [])
  useEffect(() => {
    if (me) void loadPosts(me.id)
  }, [me?.id])

  const songs = (profile.pinnedSongs ?? []).filter((id) => tracks[id])
  const lists = (profile.pinnedPlaylists ?? []).filter((id) => playlists.some((p) => p.id === id))
  const recent = useMemo(() => jumpBackIn(plays, played, tracks, playlists), [plays, played, tracks, playlists])

  const named = (id: string, name: string, onSelect: () => void): MenuItem => ({
    label: name || id,
    onSelect,
  })
  const edit: MenuItem = {
    label: 'Edit',
    icon: 'sliders',
    onSelect: onEditPins,
  }
  const songsMenu = (e: MouseEvent<HTMLButtonElement>) =>
    openMenu(e.currentTarget, [
      {
        label: 'Unpin',
        icon: 'unpin',
        items: songs.map((id) => named(id, tracks[id].title, () => unpinSong(id))),
      },
      edit,
    ])
  const playlistsMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const others = playlists.filter((p) => !lists.includes(p.id))
    openMenu(e.currentTarget, [
      ...(others.length
        ? [
            {
              label: 'Pin Playlist',
              icon: 'pin' as const,
              items: others.map((p) => named(p.id, p.name, () => pinPlaylist(p.id))),
            },
          ]
        : []),
      {
        label: 'Unpin',
        icon: 'unpin',
        items: lists.map((id) => named(id, playlists.find((p) => p.id === id)!.name, () => unpinPlaylist(id))),
      },
      edit,
    ])
  }

  return (
    <ProfileTabs
      panels={{
        board: (songs.length > 0 || lists.length > 0) && (
          <>
            {lists.length > 0 && (
              <BoardSection title="Playlists" section="playlists" more={playlistsMenu}>
                <ItemGrid items={playlistItems(lists)} />
              </BoardSection>
            )}
            {songs.length > 0 && (
              <BoardSection title="Songs" section="pinned" more={songsMenu}>
                <ItemGrid items={songItems(songs)} />
              </BoardSection>
            )}
          </>
        ),
        activity: (recent.length > 0 || repeat.length >= 3) && (
          <>
            {recent.length > 0 && (
              <BoardSection title="Recently Played" section="recent">
                <ItemGrid items={recent} />
              </BoardSection>
            )}
            {repeat.length >= 3 && (
              <BoardSection title="On Repeat" section="on-repeat">
                <ItemGrid items={songItems(repeat)} />
              </BoardSection>
            )}
          </>
        ),
        posts: !!me && !!posts && (
          <BoardSection title="Posts" section="posts">
            <PostGrid userId={me.id} />
          </BoardSection>
        ),
      }}
    />
  )
}
