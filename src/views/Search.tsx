import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react'
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

// ── Layouts ──────────────────────────────────────────────────────────────

/** 'list' is rows; a number is tiles per row. Phones and desktops each remember their own choice. */
type Layout = 'list' | 1 | 2 | 3 | 5
const LAYOUTS = { phone: ['list', 1, 2], desktop: ['list', 1, 3, 5] } satisfies Record<string, Layout[]>
const DEFAULT: Record<Device, Layout> = { phone: 1, desktop: 3 }
type Device = keyof typeof LAYOUTS

const phoneQuery = matchMedia('(max-width: 899px)')
const useDevice = (): Device =>
  useSyncExternalStore(
    (change) => (phoneQuery.addEventListener('change', change), () => phoneQuery.removeEventListener('change', change)),
    () => (phoneQuery.matches ? 'phone' : 'desktop'),
  )

const layoutKey = (device: Device) => `luma-search-layout-${device}`

function readLayout(device: Device): Layout {
  try {
    const saved = localStorage.getItem(layoutKey(device))
    const layout = saved === 'list' ? saved : Number(saved)
    if ((LAYOUTS[device] as Layout[]).includes(layout as Layout)) return layout as Layout
  } catch {}
  return DEFAULT[device]
}

function useLayout(): [Layout, (layout: Layout) => void, Device] {
  const device = useDevice()
  const [chosen, setChosen] = useState<Partial<Record<Device, Layout>>>({})
  const layout = chosen[device] ?? readLayout(device)
  const set = (next: Layout) => {
    setChosen((c) => ({ ...c, [device]: next }))
    try {
      localStorage.setItem(layoutKey(device), String(next))
    } catch {}
  }
  return [layout, set, device]
}

const LAYOUT_LABELS: Record<string, string> = { list: 'List', 1: 'Large tiles', 2: 'Two per row', 3: 'Three per row', 5: 'Five per row' }

/** Filled 24×24 glyphs, drawn here so the shared icon set stays small. */
function LayoutGlyph({ layout }: { layout: Layout }) {
  const box = (x: number, y: number, w: number, h: number, r = 1.5) => <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} rx={r} />
  const grid = (n: number, size: number, gap: number) => {
    const start = (24 - (n * size + (n - 1) * gap)) / 2
    const cells: ReactNode[] = []
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) cells.push(box(start + col * (size + gap), start + row * (size + gap), size, size, size / 4))
    return cells
  }
  const shapes =
    layout === 'list'
      ? [3.5, 10, 16.5].flatMap((y) => [box(3, y, 4, 4, 1.2), box(9.5, y + 1, 11.5, 2, 1)])
      : layout === 1
        ? [box(3, 4, 18, 11, 2.5), box(3, 17.5, 12, 2.5, 1.25)]
        : layout === 2
          ? grid(2, 8, 2.5)
          : layout === 3
            ? grid(3, 5, 2)
            : grid(4, 3.5, 1.5)
  return (
    <svg className="icon" width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {shapes}
    </svg>
  )
}

/** A segmented control: one thumb that slides between equal segments. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
  className = '',
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  render: (option: T) => { content: ReactNode; label?: string }
  className?: string
}) {
  const index = Math.max(0, options.indexOf(value))
  const style = { '--n': options.length, '--i': index } as CSSProperties
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label} style={style}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => {
        const { content, label: name } = render(option)
        return (
          <button key={option} type="button" role="radio" aria-checked={option === value} aria-label={name} onClick={() => onChange(option)}>
            {content}
          </button>
        )
      })}
    </div>
  )
}

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Relevant' },
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' },
]

// ── Screen ───────────────────────────────────────────────────────────────

export function Search() {
  const [input, setInput] = useState(last.input)
  const [sort, setSort] = useState(last.sort)
  const [response, setResponse] = useState(last.response)
  const [status, setStatus] = useState<Status>(last.status)
  const abort = useRef<AbortController | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const [layout, setLayout, device] = useLayout()

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
        <div className="search-controls">
          <Segmented
            label="Sort"
            className="sort"
            options={SORTS.map((s) => s.value)}
            value={sort}
            onChange={changeSort}
            render={(by) => ({ content: SORTS.find((s) => s.value === by)!.label })}
          />
          <Segmented
            label="Layout"
            className="layouts"
            options={LAYOUTS[device] as Layout[]}
            value={layout}
            onChange={setLayout}
            render={(l) => ({ content: <LayoutGlyph layout={l} />, label: LAYOUT_LABELS[l] })}
          />
        </div>
      </form>
      <Body status={status} response={response} layout={layout} />
    </section>
  )
}

function Body({ status, response, layout }: { status: Status; response: SearchResponse | null; layout: Layout }) {
  if (status === 'offline') return <Empty icon="offline" text="Offline" />
  if (status === 'missing') return <Empty icon="alert" text="Install yt-dlp" />
  if (status === 'failed') return <Empty text="No results" />
  if (!response) return null
  if (!response.results.length) return <Empty text="No results" />
  return (
    <div className={`search-results${status === 'loading' ? ' stale' : ''}`}>
      {response.playlist !== undefined && <PlaylistHead title={response.playlist} results={response.results} />}
      {layout === 'list' ? (
        <ul className="results">
          {response.results.map((r) => (
            <Row key={r.id} result={r} />
          ))}
        </ul>
      ) : (
        <ul className={`tiles tiles-${layout}`}>
          {response.results.map((r) => (
            <Tile key={r.id} result={r} small={layout === 5} />
          ))}
        </ul>
      )}
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

/** What a row or tile shows and does: tap to play if saved, else download and then play. */
function useResult(result: SearchResult) {
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

  return { saved, state, current, title, artist, open, press }
}

function Thumb({ id, small }: { id: string; small: boolean }) {
  return (
    <img
      src={`/api/cover/${id}${small ? '?small=1' : ''}`}
      alt=""
      loading="lazy"
      draggable={false}
      onError={(e) => (e.currentTarget.style.opacity = '0')}
    />
  )
}

function Row({ result }: { result: SearchResult }) {
  const { saved, state, current, title, artist, open, press } = useResult(result)
  return (
    <li className={`result${current ? ' current' : ''}`}>
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
    </li>
  )
}

function Tile({ result, small }: { result: SearchResult; small: boolean }) {
  const { saved, state, current, title, artist, open, press } = useResult(result)
  return (
    <li className={`tile${current ? ' current' : ''}`}>
      <button type="button" className="tile-main" onClick={open}>
        <span className="tile-thumb">
          <Thumb id={result.id} small={small} />
          {result.duration > 0 && <span className="tile-time">{formatTime(result.duration)}</span>}
        </span>
        <span className="tile-title">{title}</span>
        {artist && <span className="tile-artist ellipsis">{artist}</span>}
      </button>
      <StateButton className="tile-state" size={20} saved={saved} state={state} onClick={press} />
    </li>
  )
}

function StateButton({
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

const R = 9.5
const C = 2 * Math.PI * R

function Ring({ progress, size }: { progress: number | null; size: number }) {
  const indeterminate = progress === null
  return (
    <svg
      className={`ring${indeterminate ? ' spin' : ''}`}
      width={size}
      height={size}
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
