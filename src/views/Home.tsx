import { useEffect, useMemo, useState } from 'react'
import { loadArtists, loadMix, loadSearch, searchKey } from '../lib/feed.ts'
import { BUILTIN_TITLES, isBuiltin, useHome, visibleShelves, type CustomShelf } from '../lib/home.ts'
import { useLibrary } from '../lib/library.ts'
import { playTracks, setOpen, toggle, usePlayer } from '../lib/player.ts'
import { loadPlays, usePlayLog } from '../lib/plays.ts'
import { navigate } from '../lib/router.ts'
import { searchFor } from '../lib/search-link.ts'
import { continueItem, jumpBackIn, mixSeed, quickPicks, recentlySaved, topArtists, type Item } from '../lib/shelves.ts'
import { detect, useSource } from '../lib/source.ts'
import { useOnRepeat } from '../lib/stats.ts'
import { PlaylistArt, TrackArt } from '../ui/Art.tsx'
import { EditHome } from '../ui/EditHome.tsx'
import { Icon } from '../ui/Icon.tsx'
import { IconButton } from '../ui/kit.tsx'
import { NetShelf, PlaylistCard, Row, Shelf, SongCard } from '../ui/Shelf.tsx'
import { Wash } from '../ui/Wash.tsx'
import type { Play } from '../types.ts'
import '../styles/home.css'

const none: Play[] = []
const mixLink = (id: string) => `https://www.youtube.com/watch?v=${id}&list=RD${id}`

/** Everything the shelves are made from, worked out once per change. */
function useHomeData() {
  const plays = usePlayLog((s) => s.plays) ?? none
  const played = useHome((s) => s.played)
  const tracks = useLibrary((s) => s.tracks)
  const order = useLibrary((s) => s.order)
  const playlists = useLibrary((s) => s.playlists)
  const queue = usePlayer((s) => s.queue)
  const repeat = useOnRepeat()
  useEffect(() => void loadPlays(), [])
  // A new day can change the windows; computing once per visit is enough.
  const [now] = useState(Date.now)
  return useMemo(() => {
    const resume = continueItem(queue, playlists, tracks, plays)
    return {
      resume,
      quick: quickPicks(plays, played, tracks, playlists, now),
      jump: jumpBackIn(plays, played, tracks, playlists, resume),
      repeat,
      seed: mixSeed(repeat, plays, tracks, now),
      artists: topArtists(plays, tracks, now),
      saved: recentlySaved(order, tracks),
      playlists: playlists.map((p) => p.id),
      songs: order.length,
    }
  }, [plays, played, tracks, order, playlists, queue, repeat, now])
}

type Data = ReturnType<typeof useHomeData>

export function Home() {
  const layout = useHome()
  const data = useHomeData()
  const mode = useSource((s) => s.mode)
  const [editing, setEditing] = useState(false)
  const seedTrack = useLibrary((s) => (data.seed ? s.tracks[data.seed] : undefined))

  useEffect(() => {
    if (!useSource.getState().mode) void detect()
  }, [])

  const fresh = !data.songs && !data.playlists.length && !layout.custom.length
  const mixTitle = seedTrack ? `Mix from ${seedTrack.title}` : BUILTIN_TITLES.mix

  return (
    <section className="home">
      <header className="view-head">
        <h1>Home</h1>
        <IconButton icon="sliders" label="Edit Home" onClick={() => setEditing(true)} />
      </header>
      {fresh ? (
        <div className="home-fresh">
          <button type="button" className="pill primary" onClick={() => navigate('/search')}>
            <Icon name="search" size={18} />
            Search
          </button>
        </div>
      ) : (
        <div className="shelves">
          {visibleShelves(layout).map((id) =>
            isBuiltin(id) ? (
              <Builtin key={id} id={id} data={data} phone={mode === 'phone'} mixTitle={mixTitle} />
            ) : (
              <Custom key={id} shelf={layout.custom.find((c) => c.id === id)} />
            ),
          )}
        </div>
      )}
      {editing && <EditHome mixTitle={mixTitle} hideMix={mode === 'phone'} onClose={() => setEditing(false)} />}
    </section>
  )
}

function Builtin({ id, data, phone, mixTitle }: { id: string; data: Data; phone: boolean; mixTitle: string }) {
  switch (id) {
    case 'continue':
      return data.resume ? <Continue item={data.resume} /> : null
    case 'quick':
      return data.quick.length ? <QuickPicks items={data.quick} /> : null
    case 'jump':
      return data.jump.length ? <Items title={BUILTIN_TITLES.jump} items={data.jump} /> : null
    case 'repeat':
      return data.repeat.length ? <Songs title={BUILTIN_TITLES.repeat} ids={data.repeat} /> : null
    case 'mix':
      // Phone mode has no mix (the YouTube API doesn't give one).
      if (phone || !data.seed) return null
      return <NetShelf key={data.seed} title={mixTitle} cacheKey={`mix:${data.seed}`} load={(s) => loadMix(data.seed!, s)} more={() => searchFor(mixLink(data.seed!))} />
    case 'artists': {
      if (!data.artists.length) return null
      const key = `artists:${data.artists.join('|')}`
      return <NetShelf key={key} title={BUILTIN_TITLES.artists} cacheKey={key} load={(s) => loadArtists(data.artists, s)} />
    }
    case 'saved':
      return data.saved.length ? <Songs title={BUILTIN_TITLES.saved} ids={data.saved} more={data.songs > data.saved.length || data.saved.length > 6 ? '/songs' : undefined} /> : null
    case 'playlists':
      return data.playlists.length ? (
        <Shelf title={BUILTIN_TITLES.playlists} more={data.playlists.length > 6 ? '/playlists' : undefined}>
          <Row>
            {data.playlists.slice(0, 12).map((p) => (
              <PlaylistCard key={p} id={p} />
            ))}
          </Row>
        </Shelf>
      ) : null
  }
  return null
}

function Custom({ shelf }: { shelf?: CustomShelf }) {
  if (!shelf) return null
  const key = searchKey(shelf.query, shelf.sort)
  return <NetShelf key={key} title={shelf.query} cacheKey={key} load={(s) => loadSearch(shelf.query, shelf.sort, s)} more={() => searchFor(shelf.query)} />
}

// ── Continue ─────────────────────────────────────────────────────────────

/** The last thing played, big, on its cover's wash. Play resumes it right where it is. */
function Continue({ item }: { item: Item }) {
  const track = useLibrary((s) => (item.kind === 'song' ? s.tracks[item.id] : undefined))
  const playlist = useLibrary((s) => (item.kind === 'playlist' ? s.playlists.find((p) => p.id === item.id) : undefined))
  const first = useLibrary((s) => (playlist ? s.tracks[playlist.trackIds[0] ?? ''] : undefined))
  const queued = usePlayer((s) => s.queue.ids[s.queue.index])
  const current = useLibrary((s) => (queued ? s.tracks[queued] : undefined))
  const playing = usePlayer((s) => s.playing)
  const inQueue = item.kind === 'song' ? queued === item.id : !!playlist && !!current
  if (!track && !playlist) return null

  const wash = playlist
    ? playlist.cover
      ? { blobKey: `playlist-cover:${playlist.id}`, v: playlist.cover, seed: playlist.id }
      : { blobKey: `cover:${first?.id}`, v: first?.cover, seed: playlist.id }
    : { blobKey: `cover:${track!.id}`, v: track!.cover, seed: track!.title + track!.artist }

  const open = () => (playlist ? navigate(`/playlist/${playlist.id}`) : inQueue ? setOpen(true) : playTracks([track!.id]))
  const play = () => (inQueue ? toggle() : playlist ? playTracks(playlist.trackIds) : playTracks([track!.id]))
  const on = inQueue && playing

  return (
    <section className="shelf hero-shelf">
      <h2 className="shelf-title">
        <span>{BUILTIN_TITLES.continue}</span>
      </h2>
      <div className={`hero${on ? ' on' : ''}`}>
        <Wash still className="hero-wash" {...wash} />
        <button type="button" className="hero-main" onClick={open}>
          {playlist ? <PlaylistArt playlist={playlist} className="hero-art" /> : <TrackArt track={track!} className="hero-art" />}
          <span className="hero-text">
            <span className="hero-title">{playlist ? playlist.name : track!.title}</span>
            <span className="hero-sub ellipsis">{playlist ? (inQueue ? current?.title : first?.title) : track!.artist}</span>
          </span>
        </button>
        <button type="button" className="hero-play" aria-label={on ? 'Pause' : 'Play'} onClick={play}>
          <Icon name={on ? 'pause' : 'play'} size={24} />
        </button>
      </div>
    </section>
  )
}

// ── Quick Picks ──────────────────────────────────────────────────────────

function QuickPicks({ items }: { items: Item[] }) {
  const songs = items.filter((i) => i.kind === 'song').map((i) => i.id)
  return (
    <Shelf title={BUILTIN_TITLES.quick}>
      <div className="quick">
        {items.map((item) =>
          item.kind === 'song' ? (
            <QuickSong key={`s${item.id}`} id={item.id} onPlay={() => playTracks(songs, songs.indexOf(item.id))} />
          ) : (
            <QuickPlaylist key={`p${item.id}`} id={item.id} />
          ),
        )}
      </div>
    </Shelf>
  )
}

function QuickSong({ id, onPlay }: { id: string; onPlay: () => void }) {
  const track = useLibrary((s) => s.tracks[id])
  const current = usePlayer((s) => s.queue.ids[s.queue.index] === id)
  const playing = usePlayer((s) => s.playing)
  if (!track) return null
  return (
    <button type="button" className={`qp${current ? ' current' : ''}`} onClick={onPlay}>
      <TrackArt track={track} playing={current ? playing : undefined} />
      <span className="qp-name">{track.title}</span>
    </button>
  )
}

function QuickPlaylist({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  if (!playlist) return null
  return (
    <button type="button" className="qp" onClick={() => navigate(`/playlist/${id}`)}>
      <PlaylistArt playlist={playlist} />
      <span className="qp-name">{playlist.name}</span>
    </button>
  )
}

// ── Library shelves ──────────────────────────────────────────────────────

function Songs({ title, ids, more }: { title: string; ids: string[]; more?: string }) {
  return (
    <Shelf title={title} more={more}>
      <Row>
        {ids.map((id, i) => (
          <SongCard key={id} id={id} onPlay={() => playTracks(ids, i)} />
        ))}
      </Row>
    </Shelf>
  )
}

/** Songs and playlists together (Jump Back In). A song plays with the other songs here after it. */
function Items({ title, items }: { title: string; items: Item[] }) {
  const songs = items.filter((i) => i.kind === 'song').map((i) => i.id)
  return (
    <Shelf title={title}>
      <Row>
        {items.map((item) =>
          item.kind === 'song' ? (
            <SongCard key={`s${item.id}`} id={item.id} onPlay={() => playTracks(songs, songs.indexOf(item.id))} />
          ) : (
            <PlaylistCard key={`p${item.id}`} id={item.id} />
          ),
        )}
      </Row>
    </Shelf>
  )
}
