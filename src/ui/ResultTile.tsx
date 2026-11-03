// A YouTube result as a tile on Home: the same look and states as Search's tiles (play when saved, else download
// and then play). Search.tsx keeps its own copy for now; it can import this one once nothing else is editing it.

import { useState, type MouseEvent } from 'react'
import { formatTime } from '../lib/format.ts'
import { useDownloads, type DownloadState } from '../lib/helper.ts'
import { isDownloaded, useLibrary } from '../lib/library.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { downloadTrack, thumbnails } from '../lib/source.ts'
import { cleanTitle } from '../lib/titles.ts'
import { Icon } from './Icon.tsx'
import type { SearchResult } from '../types.ts'
import '../styles/search.css'

/** The result last tapped while it was still downloading; it plays when it finishes. */
let wantsPlay: string | null = null

function useResult(result: SearchResult) {
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
function Thumb({ id }: { id: string }) {
  const sources = thumbnails(id, true)
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

export function ResultTile({ result }: { result: SearchResult }) {
  const { saved, state, current, title, artist, open, press } = useResult(result)
  return (
    <div className={`tile${current ? ' current' : ''}`}>
      <button type="button" className="tile-main" onClick={open}>
        <span className="tile-thumb">
          <Thumb id={result.id} />
          {result.duration > 0 && <span className="tile-time">{formatTime(result.duration)}</span>}
        </span>
        <span className="tile-title">{title}</span>
        {artist && <span className="tile-artist ellipsis">{artist}</span>}
      </button>
      <StateButton saved={saved} state={state} onClick={press} />
    </div>
  )
}

function StateButton({ saved, state, onClick }: { saved: boolean; state: DownloadState | undefined; onClick: (e: MouseEvent) => void }) {
  const busy = !saved && state !== undefined && state !== 'error'
  const [label, view] = saved
    ? ['Play', <Icon key="check" name="check" size={20} />]
    : state === 'error'
      ? ['Retry', <Icon key="alert" name="alert" size={20} />]
      : busy
        ? ['Downloading', <Ring key="ring" progress={state} />]
        : ['Download', <Icon key="download" name="download" size={20} />]
  return (
    <button
      type="button"
      className={`icon-btn state-btn tile-state${saved ? ' saved' : ''}${state === 'error' ? ' error' : ''}${busy ? ' busy' : ''}`}
      aria-label={label}
      onClick={onClick}
    >
      {view}
    </button>
  )
}

const R = 9.5
const C = 2 * Math.PI * R

function Ring({ progress }: { progress: number | null }) {
  const indeterminate = progress === null
  return (
    <svg
      className={`ring${indeterminate ? ' spin' : ''}`}
      width={20}
      height={20}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(progress * 100)}
    >
      <circle className="ring-track" cx="12" cy="12" r={R} />
      <circle className="ring-fill" cx="12" cy="12" r={R} strokeDasharray={C} strokeDashoffset={indeterminate ? C * 0.72 : C * (1 - progress)} />
    </svg>
  )
}
