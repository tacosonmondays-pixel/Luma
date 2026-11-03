import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { downloadAll, downloadTrack, health, HelperError, search, useDownloads, type DownloadState } from '../lib/helper.ts'
import { formatTime } from '../lib/format.ts'
import { useLibrary } from '../lib/library.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { cleanTitle } from '../lib/titles.ts'
import { Icon } from '../ui/Icon.tsx'
import type { SearchResponse, SearchResult, SearchSort } from '../types.ts'
import '../styles/search.css'

type Status = 'idle' | 'loading' | 'done' | 'offline' | 'missing' | 'failed'

/** Kept across visits to the screen. */
const last: { input: string; query: string; sort: SearchSort; response: SearchResponse | null; status: Status } = {
  input: '',
  query: '',
  sort: 'relevance',
  response: null,
  status: 'idle',
}

/** The result the user last tapped while it was still downloading; it plays when it finishes. */
let wantsPlay: string | null = null

function statusOf(e: unknown): Status {
  if (!(e instanceof HelperError)) return 'failed'
  if (e.code === 'offline') return 'offline'
  if (e.code === 'ytdlp-missing') return 'missing'
  return 'failed'
}

export function Search() {
  const [input, setInput] = useState(last.input)
  const [sort, setSort] = useState(last.sort)
  const [response, setResponse] = useState(last.response)
  const [status, setStatus] = useState<Status>(last.status)
  const abort = useRef<AbortController | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Object.assign(last, { input, sort, response, status: status === 'loading' ? last.status : status })
  }, [input, sort, response, status])

  // With nothing on screen yet, check the helper so a missing one shows up before the first search.
  useEffect(() => {
    if (last.response || last.status === 'loading') return
    let live = true
    health().then(
      (h) => live && setStatus((s) => (s === 'loading' ? s : h.ytdlp ? 'idle' : 'missing')),
      (e) => live && setStatus((s) => (s === 'loading' ? s : statusOf(e))),
    )
    return () => {
      live = false
      abort.current?.abort()
    }
  }, [])

  async function run(query: string, by: SearchSort) {
    query = query.trim()
    if (!query) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    last.query = query
    setStatus('loading')
    try {
      const r = await search(query, by, controller.signal)
      setResponse(r)
      setStatus('done')
      window.scrollTo({ top: 0 })
    } catch (e) {
      if (controller.signal.aborted) return
      setResponse(null)
      setStatus(statusOf(e))
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    field.current?.blur()
    void run(input, sort)
  }

  const changeSort = (by: SearchSort) => {
    if (by === sort) return
    setSort(by)
    if (last.query) void run(last.query, by)
  }

  const clearInput = () => {
    setInput('')
    field.current?.focus()
  }

  return (
    <section className="search">
      <header className="view-head search-title">
        <h1>Search</h1>
      </header>
      <form className="search-bar" role="search" onSubmit={submit}>
        <label className="search-field">
          {status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Icon name="search" size={17} />}
          <input
            ref={field}
            type="search"
            enterKeyHint="search"
            placeholder="Search"
            aria-label="Search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {input && (
            <button type="button" className="search-clear" aria-label="Clear" onClick={clearInput}>
              <Icon name="close" size={12} />
            </button>
          )}
        </label>
        <div className="segmented" role="radiogroup" aria-label="Sort" data-at={sort}>
          <span className="segmented-thumb" aria-hidden="true" />
          {(['relevance', 'recent'] as const).map((by) => (
            <button key={by} type="button" role="radio" aria-checked={sort === by} onClick={() => changeSort(by)}>
              {by === 'relevance' ? 'Relevant' : 'Recent'}
            </button>
          ))}
        </div>
      </form>
      <Body status={status} response={response} />
    </section>
  )
}

function Body({ status, response }: { status: Status; response: SearchResponse | null }) {
  if (status === 'offline') return <Empty icon="offline" text="Offline" />
  if (status === 'missing') return <Empty icon="alert" text="Install yt-dlp" />
  if (status === 'failed') return <Empty text="No results" />
  if (!response) return null
  if (!response.results.length) return <Empty text="No results" />
  return (
    <div className={`search-results${status === 'loading' ? ' stale' : ''}`}>
      {response.playlist !== undefined && <PlaylistHead title={response.playlist} results={response.results} />}
      <ul className="results">
        {response.results.map((r) => (
          <Row key={r.id} result={r} />
        ))}
      </ul>
    </div>
  )
}

function Empty({ icon, text }: { icon?: 'offline' | 'alert'; text: string }) {
  return (
    <div className="empty search-empty">
      {icon && <Icon name={icon} size={40} />}
      <h2>{text}</h2>
    </div>
  )
}

function PlaylistHead({ title, results }: { title: string; results: SearchResult[] }) {
  const tracks = useLibrary((s) => s.tracks)
  const downloads = useDownloads()
  const left = results.some((r) => !tracks[r.id] && (downloads[r.id] === undefined || downloads[r.id] === 'error'))
  return (
    <div className="search-playlist">
      <h2 className="ellipsis">{title || 'Playlist'}</h2>
      <button type="button" className="pill primary" disabled={!left} onClick={() => void downloadAll(results)}>
        Download All
      </button>
    </div>
  )
}

function Row({ result }: { result: SearchResult }) {
  const saved = useLibrary((s) => Boolean(s.tracks[result.id]))
  const state = useDownloads((s) => s[result.id])
  const current = usePlayer((s) => s.queue.ids[s.queue.index] === result.id)
  const { title, artist } = cleanTitle(result.title, result.channel)

  const download = async () => {
    if (await downloadTrack(result)) {
      if (wantsPlay === result.id) {
        wantsPlay = null
        playTracks([result.id])
      }
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

  return (
    <li className={`result${current ? ' current' : ''}`}>
      <button type="button" className="result-main" onClick={open}>
        <span className="result-art">
          <img src={`/api/cover/${result.id}`} alt="" loading="lazy" draggable={false} onError={(e) => (e.currentTarget.style.opacity = '0')} />
        </span>
        <span className="result-text">
          <span className="result-title ellipsis">{title}</span>
          {artist && <span className="result-artist ellipsis">{artist}</span>}
        </span>
        {result.duration > 0 && <span className="result-time">{formatTime(result.duration)}</span>}
      </button>
      <StateButton saved={saved} state={state} onClick={press} />
    </li>
  )
}

function StateButton({ saved, state, onClick }: { saved: boolean; state: DownloadState | undefined; onClick: (e: MouseEvent) => void }) {
  const [label, view] = saved
    ? ['Play', <Icon key="check" name="check" size={22} />]
    : state === 'error'
      ? ['Retry', <Icon key="alert" name="alert" size={22} />]
      : state === undefined
        ? ['Download', <Icon key="download" name="download" size={22} />]
        : ['Downloading', <Ring key="ring" progress={state} />]
  return (
    <button
      type="button"
      className={`icon-btn result-state${saved ? ' saved' : ''}${state === 'error' ? ' error' : ''}`}
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
      width={22}
      height={22}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(progress * 100)}
    >
      <circle className="ring-track" cx="12" cy="12" r={R} />
      <circle
        className="ring-fill"
        cx="12"
        cy="12"
        r={R}
        strokeDasharray={C}
        strokeDashoffset={indeterminate ? C * 0.72 : C * (1 - progress)}
      />
    </svg>
  )
}
