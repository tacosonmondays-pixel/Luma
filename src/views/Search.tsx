import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useDownloads } from '../lib/helper.ts'
import { isDownloaded, useLibrary } from '../lib/library.ts'
import { detect, downloadAll, importDownloads, problemOf, search, useSource, type Problem } from '../lib/source.ts'
import { askedSearch, clearSearch } from '../lib/search-link.ts'
import { lumaSearch, useSignedIn, useSocial, type LumaHit } from '../lib/social.ts'
import { parseLink } from '../lib/youtube.ts'
import { Icon, type IconName } from '../ui/Icon.tsx'
import { Link, pickFiles } from '../ui/kit.tsx'
import { PersonCard } from '../ui/People.tsx'
import { PostCard } from '../ui/Post.tsx'
import { ResultRow, ResultTile } from '../ui/ResultTile.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { Row, Shelf } from '../ui/Shelf.tsx'
import type { SearchResponse, SearchResult, SearchSort } from '../types.ts'
import '../styles/search.css'

type Status = 'idle' | 'loading' | 'done' | Problem

/** Kept across visits to the screen. `shown`: the query whose YouTube results are on screen. `luma`: the Luma row's
 * hits for `query` (signed in only). */
const last: { input: string; query: string; sort: SearchSort; response: SearchResponse | null; status: Status; shown?: string; luma?: LumaHit[] } = {
  input: '',
  query: '',
  sort: 'relevance',
  response: null,
  status: 'idle',
}

/** The nearest element that scrolls `el` (Y2K's desktop window), else null for the page itself. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement
  return node === document.body ? null : node
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

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Relevant' },
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' },
]

// ── Screen ───────────────────────────────────────────────────────────────

export function Search() {
  const [asked] = useState(askedSearch)
  const [input, setInput] = useState(asked ?? last.input)
  const [sort, setSort] = useState(last.sort)
  const [response, setResponse] = useState(last.response)
  const [status, setStatus] = useState<Status>(last.status)
  const abort = useRef<AbortController | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [layout, setLayout, device] = useLayout()
  const signedIn = useSignedIn()
  const [luma, setLuma] = useState(last.luma)
  const lumaAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    Object.assign(last, { input, sort, response, status: status === 'loading' ? last.status : status })
  }, [input, sort, response, status])

  // With nothing on screen yet, look for the helper (or the YouTube key) so a problem shows up before the first search.
  useEffect(() => {
    if (asked) {
      clearSearch()
      void run(asked, sort)
      runLuma(asked)
      return () => {
        abort.current?.abort()
        lumaAbort.current?.abort()
      }
    }
    if (last.response || last.status === 'loading') return
    let live = true
    // A search answers for itself; a late check must not replace its outcome.
    void detect().then((problem) => live && !abort.current && setStatus(problem ?? 'idle'))
    return () => {
      live = false
      abort.current?.abort()
      lumaAbort.current?.abort()
    }
  }, [])

  /** Luma's people and posts for the query, beside YouTube's results and waiting on neither. Signed in only, and not
   * for a YouTube link. An answer that comes once the query's YouTube results are on screen and the bar has scrolled
   * away is kept for the next visit instead: the page never moves under a finger. */
  function runLuma(query: string) {
    query = query.trim()
    lumaAbort.current?.abort()
    lumaAbort.current = null
    last.luma = undefined
    setLuma(undefined)
    if (!query || !signedIn || parseLink(query)) return
    const controller = new AbortController()
    lumaAbort.current = controller
    void lumaSearch(query, controller.signal).then((hits) => {
      if (controller.signal.aborted || last.query !== query) return
      const found = hits?.length ? hits : undefined
      last.luma = found
      const el = form.current
      const scroller = el && scrollerOf(el)
      const away = !!el && el.getBoundingClientRect().bottom <= (scroller ? scroller.getBoundingClientRect().top : 0)
      if (away && last.shown === query) return
      setLuma(found)
    })
  }

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
      last.shown = query
      setResponse(r)
      setStatus('done')
      window.scrollTo({ top: 0 })
    } catch (e) {
      if (controller.signal.aborted) return
      last.shown = undefined
      setResponse(null)
      setStatus(problemOf(e))
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    field.current?.blur()
    void run(input, sort)
    runLuma(input)
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

  const importing = useSource((s) => s.importing)
  const importFiles = () => void pickFiles('audio/*', true).then(importDownloads)

  return (
    <section className="search">
      <header className={`view-head search-title${importing ? ' has-import' : ''}`}>
        <h1>Search</h1>
        {importing && (
          <button type="button" className="pill primary search-import" onClick={importFiles}>
            Import
          </button>
        )}
      </header>
      <form ref={form} className="search-bar" role="search" onSubmit={submit}>
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
      {signedIn && luma && <LumaRow hits={luma} />}
      <Body status={status} response={response} layout={layout} luma={!!(signedIn && luma)} />
    </section>
  )
}

/** People first, then posts, in rank order: one row, or all of them once its chevron is pressed. */
function LumaRow({ hits }: { hits: LumaHit[] }) {
  const [all, setAll] = useState(false)
  const people = useSocial((s) => s.people)
  const hidden = useSocial((s) => s.hidden)
  const shown = hits.filter((h) => h.kind === 'person' || !hidden.has(`${h.post.kind}:${h.post.id}`))
  if (!shown.length) return null
  return (
    <Shelf title="Luma" className="luma-results" more={shown.length > 4 ? () => setAll((a) => !a) : undefined}>
      <Row all={all}>
        {shown.map((h) =>
          h.kind === 'person' ? (
            <PersonCard key={`person:${h.person.id}`} person={h.person} />
          ) : (
            <PostCard key={`${h.post.kind}:${h.post.id}`} post={h.post} author={people[h.post.userId]} />
          ),
        )}
      </Row>
    </Shelf>
  )
}

function Body({ status, response, layout, luma }: { status: Status; response: SearchResponse | null; layout: Layout; luma: boolean }) {
  if (status === 'offline') return <Empty icon="offline" text="Offline" />
  if (status === 'missing') return <Empty icon="alert" text="Install yt-dlp" />
  if (status === 'key')
    return (
      <div className="empty search-empty">
        <Icon name="key" size={40} />
        <Link to="/you" className="pill primary">
          Add YouTube Key
        </Link>
      </div>
    )
  if (status === 'quota') return <Empty text="Daily limit reached" />
  if (status === 'failed') return <Empty icon="alert" text="Search failed" />
  if (!response) return null
  if (!response.results.length) return luma ? null : <Empty text="No results" />
  return (
    <div className={`search-results${status === 'loading' ? ' stale' : ''}`}>
      {response.playlist !== undefined && <PlaylistHead title={response.playlist} results={response.results} />}
      {layout === 'list' ? (
        <ul className="results">
          {response.results.map((r) => (
            <ResultRow key={r.id} result={r} as="li" />
          ))}
        </ul>
      ) : (
        <ul className={`tiles tiles-${layout}`}>
          {response.results.map((r) => (
            <ResultTile key={r.id} result={r} small={layout === 5} as="li" />
          ))}
        </ul>
      )}
    </div>
  )
}

function Empty({ icon, text }: { icon?: IconName; text: string }) {
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
  const left = results.some((r) => !isDownloaded(tracks[r.id]) && (downloads[r.id] === undefined || downloads[r.id] === 'error'))
  return (
    <div className="search-playlist">
      <h2 className="ellipsis">{title || 'Playlist'}</h2>
      <button type="button" className="pill primary" disabled={!left} onClick={() => downloadAll(results, last.query)}>
        Download All
      </button>
    </div>
  )
}
