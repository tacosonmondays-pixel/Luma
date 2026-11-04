// Songs from YouTube as Search's rows and tiles (Home's network shelves use the tiles too), with the same states:
// play when saved, else download and then play. And songs from elsewhere (someone's plays, a post): a YouTube
// result when they carry a YouTube id, else a tile or row that searches for them.

import { useState, type MouseEvent, type ReactNode } from 'react'
import { formatTime, gradientFor } from '../lib/format.ts'
import { useDownloads, type DownloadState } from '../lib/helper.ts'
import { isDownloaded, useLibrary } from '../lib/library.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { searchFor } from '../lib/search-link.ts'
import { downloadTrack, thumbnails } from '../lib/source.ts'
import { cleanTitle } from '../lib/titles.ts'
import { Icon } from './Icon.tsx'
import { Ring } from './Ring.tsx'
import type { SearchResult } from '../types.ts'
import '../styles/search.css'

/** A song that isn't (necessarily) in this library: the same shape as social.ts's `Song`. */
export interface Song {
  youtubeId?: string
  title: string
  artist: string
}

/** The element a row or tile is: `li` inside Search's lists, else `div`. */
type As = 'li' | 'div'

/** The result last tapped while it was still downloading; it plays when it finishes. */
let wantsPlay: string | null = null

/** What a row or tile shows and does: tap to play if saved, else download and then play. */
export function useResult(result: SearchResult) {
  const saved = useLibrary((s) => isDownloaded(s.tracks[result.id]))
  const state = useDownloads((s) => s[result.id])
  const current = usePlayer((s) => s.queue.ids[s.queue.index] === result.id)
  const { title, artist } = cleanTitle(result.title, result.channel)

  const download = async () => {
    if ((await downloadTrack(result)) && wantsPlay === result.id) {
      wantsPlay = null
      playTracks([result.id])
    }
  }
  const open = () => {
    if (saved) {
      wantsPlay = null
      return playTracks([result.id])
    }
    wantsPlay = result.id
    void download()
  }
  const press = (e: MouseEvent) => {
    e.stopPropagation()
    if (saved) return open()
    if (state === undefined || state === 'error') void download()
  }
  return { saved, state, current, title, artist, open, press }
}

/** The first thumbnail that exists. YouTube answers a missing size with a 120×90 placeholder. */
export function Thumb({ id, small }: { id: string; small: boolean }) {
  const sources = thumbnails(id, small)
  const [index, setIndex] = useState(0)
  const next = (img: HTMLImageElement) => {
    if (index + 1 < sources.length) setIndex(index + 1)
    else img.style.opacity = '0'
  }
  return (
    <img
      src={sources[index]}
      alt=""
      loading="lazy"
      draggable={false}
      onLoad={(e) => e.currentTarget.naturalWidth <= 120 && index + 1 < sources.length && next(e.currentTarget)}
      onError={(e) => next(e.currentTarget)}
    />
  )
}

/** A result as a row: its thumbnail, title, channel and length, and the state button. */
export function ResultRow({ result, as: Tag = 'div' }: { result: SearchResult; as?: As }) {
  const { saved, state, current, title, artist, open, press } = useResult(result)
  return (
    <Tag className={`result${current ? ' current' : ''}`}>
      <button type="button" className="result-main" onClick={open}>
        <span className="result-art">
          <Thumb id={result.id} small />
        </span>
        <span className="result-text">
          <span className="result-title ellipsis">{title}</span>
          {artist && <span className="result-artist ellipsis">{artist}</span>}
        </span>
        {result.duration > 0 && <span className="result-time">{formatTime(result.duration)}</span>}
      </button>
      <StateButton saved={saved} state={state} onClick={press} />
    </Tag>
  )
}

/** A result as a tile: its 16:9 thumbnail (small: the dense size) with `overlay` on it, title and channel. */
export function ResultTile({ result, small = false, overlay, as: Tag = 'div' }: { result: SearchResult; small?: boolean; overlay?: ReactNode; as?: As }) {
  const { saved, state, current, title, artist, open, press } = useResult(result)
  return (
    <Tag className={`tile${current ? ' current' : ''}`}>
      <button type="button" className="tile-main" onClick={open}>
        <span className="tile-thumb">
          <Thumb id={result.id} small={small} />
          {result.duration > 0 && <span className="tile-time">{formatTime(result.duration)}</span>}
          {overlay}
        </span>
        <span className="tile-title">{title}</span>
        {artist && <span className="tile-artist ellipsis">{artist}</span>}
      </button>
      <StateButton className="tile-state" size={20} saved={saved} state={state} onClick={press} />
    </Tag>
  )
}

/** Play when saved; else Download, its progress, or Retry. */
export function StateButton({
  saved,
  state,
  onClick,
  className = 'result-state',
  size = 22,
}: {
  saved: boolean
  state: DownloadState | undefined
  onClick: (e: MouseEvent) => void
  className?: string
  size?: number
}) {
  const busy = !saved && state !== undefined && state !== 'error'
  const [label, view] = saved
    ? ['Play', <Icon key="check" name="check" size={size} />]
    : state === 'error'
      ? ['Retry', <Icon key="alert" name="alert" size={size} />]
      : busy
        ? ['Downloading', <Ring key="ring" progress={state} size={size} />]
        : ['Download', <Icon key="download" name="download" size={size} />]
  return (
    <button
      type="button"
      className={`icon-btn state-btn ${className}${saved ? ' saved' : ''}${state === 'error' ? ' error' : ''}${busy ? ' busy' : ''}`}
      aria-label={label}
      onClick={onClick}
    >
      {view}
    </button>
  )
}

// ── Songs from elsewhere ─────────────────────────────────────────────────

const queryOf = (song: Song) => [song.title, song.artist].filter(Boolean).join(' ')

/** A song with no YouTube id (an imported file) as a tile: its gradient and a note. Tapping searches for it. */
export function QueryTile({ song, overlay, as: Tag = 'div' }: { song: Song; overlay?: ReactNode; as?: As }) {
  return (
    <Tag className="tile">
      <button type="button" className="tile-main" onClick={() => searchFor(queryOf(song))}>
        <span className="tile-thumb query-thumb" style={{ background: gradientFor(song.title + song.artist) }}>
          <Icon name="music" size={32} />
          {overlay}
        </span>
        <span className="tile-title">{song.title}</span>
        {song.artist && <span className="tile-artist ellipsis">{song.artist}</span>}
      </button>
    </Tag>
  )
}

/** The same as a row. */
export function QueryRow({ song, as: Tag = 'div' }: { song: Song; as?: As }) {
  return (
    <Tag className="result">
      <button type="button" className="result-main" onClick={() => searchFor(queryOf(song))}>
        <span className="result-art query-thumb" style={{ background: gradientFor(song.title + song.artist) }}>
          <Icon name="music" size={18} />
        </span>
        <span className="result-text">
          <span className="result-title ellipsis">{song.title}</span>
          {song.artist && <span className="result-artist ellipsis">{song.artist}</span>}
        </span>
      </button>
    </Tag>
  )
}

const resultOf = (song: Song, id: string): SearchResult => ({ id, title: song.title, channel: song.artist, duration: 0 })

/** Any song as a tile (Home's shelves): a YouTube result when it has an id, else a search for it. */
export function SongTile({ song, overlay }: { song: Song; overlay?: ReactNode }) {
  return song.youtubeId ? <ResultTile result={resultOf(song, song.youtubeId)} small overlay={overlay} /> : <QueryTile song={song} overlay={overlay} />
}

/** Any song as a row. */
export function SongRow({ song }: { song: Song }) {
  return song.youtubeId ? <ResultRow result={resultOf(song, song.youtubeId)} /> : <QueryRow song={song} />
}
