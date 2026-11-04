// Someone's public profile, /u/<handle>: a read-only card from their server row and the public media URLs, and
// beside it the tabs: Board (their pinned songs), Activity (what they're listening to: members who follow them,
// while they share it) and Posts. Works signed out. Pinned songs show art and title; tapping one searches for it
// (no audio comes from the server). Pinned playlists stay private: playlists aren't public.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { badgesOf, ensureRow, fetchPublicProfile, pinnedOf, profileFromRow, profilePath, useAccount } from '../lib/account.ts'
import { usePlayer } from '../lib/player.ts'
import {
  follow, loadListening, loadMine, loadPosts, personOf, rememberPerson, unfollow, useMe, useOnline, useSocial,
  type FriendPlay,
} from '../lib/social.ts'
import { badgeName } from '../lib/stats.ts'
import { mediaUrl } from '../lib/supabase.ts'
import { useViewer } from '../lib/viewer.ts'
import { Icon } from '../ui/Icon.tsx'
import { openMenu } from '../ui/Menu.tsx'
import { PeopleSheet, profileMenuItems } from '../ui/People.tsx'
import { PostGrid } from '../ui/Post.tsx'
import { BoardGhost, BoardSection, ProfileTabs, RemoteSongGrid } from '../ui/profile/Board.tsx'
import { CardIcon, ProfileCard, useLive } from '../ui/profile/ProfileCard.tsx'
import type { CardMedia } from '../ui/profile/ProfileMedia.tsx'
import { SongTile } from '../ui/ResultTile.tsx'
import type { MediaKind, PinnedSong, ProfileRow } from '../types.ts'
import '../styles/profile.css'
import '../styles/social.css'

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
  const [reload, setReload] = useState(0) // after Remove Profile or Ban
  useEffect(() => {
    let live = true
    if (!reload) setState({})
    fetchPublicProfile(handle).then(
      (row) => live && setState({ row }),
      () => live && setState((s) => (reload && s.row ? s : { offline: true })),
    )
    return () => {
      live = false
    }
  }, [handle, reload])
  const cardRef = useRef<HTMLDivElement>(null)
  const viewing = useViewer((s) => !!s.post)
  // Now Playing and the Viewer cover the page completely, and the observer can't tell: the card rests behind them.
  const covered = usePlayer((s) => s.open) || viewing
  const live = useLive(cardRef, !covered)
  const { row } = state
  const view = useMemo(() => row && { profile: profileFromRow(row), media: mediaOf(row), pinned: pinnedOf(row), remote: { badges: badgesOf(row).map((b) => ({ ...b, name: badgeName(b.id, b.tier), fresh: false })) } }, [row])
  const person = useMemo(() => (row ? personOf(row) : undefined), [row])
  const me = useMe()
  const self = !!me && me.id === row?.id
  const [people, setPeople] = useState<'following' | 'followers'>()

  useEffect(() => {
    if (person) rememberPerson(person)
  }, [person])
  useEffect(() => {
    if (me) void loadMine()
  }, [me])

  if (!view)
    return (
      <section className="profile user-page">
        {(state.offline || row === null) && (
          <div className="user-missing" aria-label={state.offline ? 'Offline' : 'Not Found'} role="img">
            <Icon name={state.offline ? 'offline' : 'user'} size={44} />
          </div>
        )}
      </section>
    )
  const more = (e: MouseEvent<HTMLButtonElement>) =>
    person && openMenu(e.currentTarget, profileMenuItems({ person, self, onPeople: setPeople, onChange: () => setReload((n) => n + 1) }))
  return (
    <section className="profile user-page">
      <div className="profile-side" ref={cardRef}>
        <ProfileCard
          profile={view.profile}
          media={view.media}
          live={live}
          effectFor={EFFECT_MS}
          remote={view.remote}
          actions={
            person && (
              <>
                <CardIcon icon="more" label="More" onClick={more} />
                {me && !self && <FollowPill id={person.id} />}
              </>
            )
          }
          claimsVideo
        />
      </div>
      {row && <Tabs key={row.id} userId={row.id} pinned={view.pinned} />}
      {people && row && <PeopleSheet userId={row.id} which={people} onClose={() => setPeople(undefined)} />}
    </section>
  )
}

/** Follow, or Following: it changes at once, and shakes back if the server says no. Shown once the follows load. */
function FollowPill({ id }: { id: string }) {
  const following = useSocial((s) => s.following)
  const [wrong, setWrong] = useState(false)
  if (!following) return null
  const on = following.includes(id)
  const press = async () => {
    setWrong(false)
    if (!(await (on ? unfollow(id) : follow(id)))) setWrong(true)
  }
  return (
    <button
      type="button"
      className={`pill pc-edit pc-follow${wrong ? ' wrong' : ''}`}
      aria-pressed={on}
      onClick={() => void press()}
      onAnimationEnd={(e) => e.animationName === 'sheet-shake' && setWrong(false)}
    >
      {on ? 'Following' : 'Follow'}
    </button>
  )
}

/** The tabs, once Listening To and Posts have both answered (a ghost row until then), so nothing jumps. Each tab
 * shows only with something in it. Waits for the account, so a member's Listening To doesn't arrive late; a row that
 * didn't load (a failure at start) is asked for once more, and then the posts load whatever the answer. */
function Tabs({ userId, pinned }: { userId: string; pinned: PinnedSong[] }) {
  const known = useAccount((s) => s.ready && (!s.user || s.row !== undefined))
  const checked = useAccount((s) => s.ready)
  const online = useOnline()
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    if (known || !checked || !online) return
    let live = true
    void ensureRow().then(() => live && setAsked(true))
    return () => {
      live = false
    }
  }, [known, checked, online])
  const ready = known || asked
  const me = useMe()
  const list = useSocial((s) => s.lists[userId])
  const [loaded, setLoaded] = useState<{ listening: FriendPlay[] | null; me?: string }>()

  useEffect(() => {
    if (!ready && online) return
    let live = true
    void Promise.allSettled([loadListening(userId), loadPosts(userId)]).then(([listening]) => {
      if (live) setLoaded({ listening: listening.status === 'fulfilled' ? listening.value : null, me: me?.id })
    })
    return () => {
      live = false
    }
  }, [userId, ready, online, me?.id])

  if (!loaded) return <BoardGhost />
  const listening = loaded.me === me?.id ? (loaded.listening ?? []) : []
  return (
    <ProfileTabs
      panels={{
        board: pinned.length > 0 && (
          <BoardSection title="Songs" section="pinned">
            <RemoteSongGrid songs={pinned} />
          </BoardSection>
        ),
        activity: listening.length > 0 && (
          <BoardSection title="Listening To" section="listening">
            <div className="board-tiles">
              {listening.map((p) => (
                <SongTile key={p.key} song={p.song} />
              ))}
            </div>
          </BoardSection>
        ),
        posts: !!list?.items.length && (
          <BoardSection title="Posts" section="posts">
            <PostGrid userId={userId} />
          </BoardSection>
        ),
      }}
    />
  )
}
