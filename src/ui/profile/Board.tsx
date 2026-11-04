// What sits beside the profile card (under it on a phone): text tabs (Board, Activity, Posts) over section cards,
// each with its title and, on your own profile, a More menu. A tab with nothing in it doesn't show, and a lone tab
// shows without the tab row. The tab lives in memory only: the URL stays the profile's.
import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { gradientFor } from '../../lib/format.ts'
import { shownTab, TAB_NAMES, tabsOf, type ProfileTab } from '../../lib/board.ts'
import { useLibrary } from '../../lib/library.ts'
import { playTracks, usePlayer } from '../../lib/player.ts'
import { searchFor } from '../../lib/search-link.ts'
import { thumbnails } from '../../lib/youtube.ts'
import type { Item } from '../../lib/shelves.ts'
import type { PinnedSong } from '../../types.ts'
import { PlaylistArt, TrackArt } from '../Art.tsx'
import { Icon } from '../Icon.tsx'
import { IconButton, Link } from '../kit.tsx'
import { openTrackMenu } from '../Menu.tsx'
import '../../styles/board.css'

/** The tab row and the shown tab's panel. `panels` holds only tabs with something in them, in order. */
export function ProfileTabs({ panels }: { panels: Partial<Record<ProfileTab, ReactNode>> }) {
  const tabs = tabsOf({ board: !!panels.board, activity: !!panels.activity, posts: !!panels.posts })
  const [picked, setPicked] = useState<ProfileTab>()
  const id = useId()
  const tab = shownTab(tabs, picked)
  if (!tab) return null
  return (
    <div className="board">
      {tabs.length > 1 && (
        <div className="board-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${id}-${t}`}
              aria-selected={t === tab}
              aria-controls={`${id}-panel`}
              className="board-tab"
              onClick={() => setPicked(t)}
            >
              {TAB_NAMES[t]}
            </button>
          ))}
        </div>
      )}
      <div
        key={tab}
        className="board-panel"
        id={`${id}-panel`}
        role={tabs.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={tabs.length > 1 ? `${id}-${tab}` : undefined}
        data-tab={tab}
      >
        {panels[tab]}
      </div>
    </div>
  )
}

/** One card on a tab: its title, a More button when there is something to manage, and what it holds. */
export function BoardSection({
  title,
  more,
  children,
  section,
}: {
  title: string
  more?: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
  section: string
}) {
  return (
    <section className="board-section" data-section={section}>
      <header className="board-head">
        <h3>{title}</h3>
        {more && <IconButton icon="more" label={`${title} Options`} size={20} className="board-more" onClick={more} />}
      </header>
      {children}
    </section>
  )
}

/** A song in this library as a cover and its title. Tapping plays `queue` from it (a song not downloaded yet opens
 *  its menu, which offers Download); right-click opens the song menu. */
function TrackTile({ id, queue }: { id: string; queue: string[] }) {
  const track = useLibrary((s) => s.tracks[id])
  const current = usePlayer((s) => s.queue.ids[s.queue.index] === id)
  const playing = usePlayer((s) => s.playing)
  if (!track) return null
  const i = queue.indexOf(id)
  return (
    <button
      type="button"
      className={`board-tile${current ? ' current' : ''}`}
      onClick={(e) => (i >= 0 && !track.missing ? playTracks(queue, i) : openTrackMenu(e.currentTarget, id))}
      onContextMenu={(e) => {
        e.preventDefault()
        openTrackMenu({ x: e.clientX, y: e.clientY }, id)
      }}
    >
      <TrackArt track={track} playing={current ? playing : undefined} />
      <span className="board-name ellipsis">{track.title}</span>
    </button>
  )
}

function PlaylistTile({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  if (!playlist) return null
  return (
    <Link to={`/playlist/${playlist.id}`} className="board-tile">
      <PlaylistArt playlist={playlist} />
      <span className="board-name ellipsis">{playlist.name}</span>
    </Link>
  )
}

/** Songs and playlists of this library as covers. A song plays with the other songs here. */
export function ItemGrid({ items }: { items: Item[] }) {
  const tracks = useLibrary((s) => s.tracks)
  const queue = items.filter((i) => i.kind === 'song' && tracks[i.id] && !tracks[i.id].missing).map((i) => i.id)
  return (
    <div className="board-grid">
      {items.map((item) =>
        item.kind === 'song' ? <TrackTile key={`s${item.id}`} id={item.id} queue={queue} /> : <PlaylistTile key={`p${item.id}`} id={item.id} />,
      )}
    </div>
  )
}

export const songItems = (ids: string[]): Item[] => ids.map((id) => ({ kind: 'song', id }))
export const playlistItems = (ids: string[]): Item[] => ids.map((id) => ({ kind: 'playlist', id }))

/** Someone's pinned songs: art and title only. Tapping one searches for it; nothing streams from the server. */
export function RemoteSongGrid({ songs }: { songs: PinnedSong[] }) {
  return (
    <div className="board-grid">
      {songs.map((song) => (
        <button key={song.id} type="button" className="board-tile" onClick={() => searchFor([song.title, song.artist].filter(Boolean).join(' '))}>
          <RemoteArt song={song} />
          <span className="board-name ellipsis">{song.title}</span>
        </button>
      ))}
    </div>
  )
}

function RemoteArt({ song }: { song: PinnedSong }) {
  const [failed, setFailed] = useState(false)
  const src = song.source === 'youtube' && !failed ? thumbnails(song.id, true)[0] : undefined
  return (
    <div
      className="art"
      style={{
        background: src ? undefined : gradientFor(song.title + song.artist),
      }}
    >
      {src ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} /> : <Icon name="music" size={22} />}
    </div>
  )
}

/** A loading tab area: a row of ghost covers, so nothing jumps when it fills. */
export function BoardGhost() {
  return (
    <div className="board board-loading" aria-hidden="true">
      <div className="board-section">
        <div className="board-grid post-ghosts">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="board-ghost" />
          ))}
        </div>
      </div>
    </div>
  )
}
