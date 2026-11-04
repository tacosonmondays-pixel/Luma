// Home's building blocks: a titled shelf, a row that scrolls on phones and fills one grid row on desktop, the
// cards in it, and a shelf that loads from the network once it scrolls near (its outline meanwhile). Also a sentinel
// that asks for a list's next page as it scrolls near.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { peek } from '../lib/feed.ts'
import { useLibrary } from '../lib/library.ts'
import { usePlayer } from '../lib/player.ts'
import { TrackArt, PlaylistArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { Link } from './kit.tsx'
import { ResultTile } from './ResultTile.tsx'
import type { SearchResult } from '../types.ts'
import '../styles/home.css'

const phoneQuery = matchMedia('(max-width: 899px)')
export const usePhone = () =>
  useSyncExternalStore(
    (change) => (phoneQuery.addEventListener('change', change), () => phoneQuery.removeEventListener('change', change)),
    () => phoneQuery.matches,
  )

/** A shelf: its title (a link with a chevron when there is more to see) over its content. */
export function Shelf({ title, more, children, className = '' }: { title: string; more?: string | (() => void); children: ReactNode; className?: string }) {
  const chevron = (
    <>
      <span className="ellipsis">{title}</span>
      <Icon name="chevron-right" size={20} />
    </>
  )
  return (
    <section className={`shelf ${className}`}>
      <h2 className="shelf-title">
        {typeof more === 'string' ? (
          <Link to={more} className="shelf-more" label={`Show All ${title}`}>
            {chevron}
          </Link>
        ) : more ? (
          <button type="button" className="shelf-more" aria-label={`Show All ${title}`} onClick={more}>
            {chevron}
          </button>
        ) : (
          <span className="ellipsis">{title}</span>
        )}
      </h2>
      {children}
    </section>
  )
}

/**
 * Cards in a row. Phones scroll it sideways with snap; desktops show as many as fit one grid row. With `all`, every
 * card shows, wrapping onto more rows of the same columns (phones too).
 */
export function Row({ wide, all, children }: { wide?: boolean; all?: boolean; children: ReactNode[] }) {
  const phone = usePhone()
  const grid = all || !phone
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!grid || !el) return
    const min = wide ? 232 : 150
    const fit = () => {
      const style = getComputedStyle(el)
      const gap = parseFloat(style.columnGap) || 0
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setCols(Math.max(2, Math.floor((width + gap) / (min + gap))))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [grid, wide])
  const shown = all || phone ? children : children.slice(0, cols || 0)
  return (
    <div
      ref={ref}
      className={`row${wide ? ' wide' : ''}${all ? ' all' : ''}`}
      style={grid ? { gridTemplateColumns: `repeat(${cols || 1}, minmax(0, 1fr))` } : undefined}
    >
      {shown}
    </div>
  )
}

export function SongCard({ id, onPlay }: { id: string; onPlay: () => void }) {
  const track = useLibrary((s) => s.tracks[id])
  const current = usePlayer((s) => s.queue.ids[s.queue.index] === id)
  const playing = usePlayer((s) => s.playing)
  if (!track) return null
  return (
    <button type="button" className={`card${current ? ' current' : ''}`} onClick={onPlay}>
      <TrackArt track={track} playing={current ? playing : undefined} />
      <span className="card-title ellipsis">{track.title}</span>
      {track.artist && <span className="card-sub ellipsis">{track.artist}</span>}
    </button>
  )
}

export function PlaylistCard({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  if (!playlist) return null
  return (
    <Link to={`/playlist/${playlist.id}`} className="card">
      <PlaylistArt playlist={playlist} />
      <span className="card-title ellipsis">{playlist.name}</span>
    </Link>
  )
}

/** True once the element is within a screen of being visible (in the nearest scroller: Y2K's desktop window). It stays
 * true: key the element's owner to watch again. */
export function useNear(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    let root: HTMLElement | null = el.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root,
      rootMargin: '0px 0px 100% 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, near])
  return near
}

/** A shelf's outline while it loads: wide 16:9 tiles, else square cards. */
export function GhostShelf({ title, wide }: { title: string; wide?: boolean }) {
  return (
    <Shelf title={title} className="loading">
      <Row wide={wide}>{Array.from({ length: 6 }, (_, i) => <div key={i} className={wide ? 'tile-ghost' : 'card-ghost'} />)}</Row>
    </Shelf>
  )
}

/** Calls `onNear` once it comes within a screen of being visible: the next page of a list. Key it by the list's
 * cursor, so each page asks once. */
export function Sentinel({ onNear }: { onNear: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  const call = useRef(onNear)
  call.current = onNear
  useEffect(() => {
    if (near) call.current()
  }, [near])
  return <div ref={ref} className="sentinel" aria-hidden="true" />
}

/**
 * A shelf of YouTube results that loads once it scrolls near and gives up quietly: while loading it shows its
 * outline, and with nothing to show (offline, a failed request, no results) it is not there at all.
 * Key it by `cacheKey`, so a new query starts over.
 */
export function NetShelf({
  title,
  cacheKey,
  load,
  more,
}: {
  title: string
  cacheKey: string
  load: (signal: AbortSignal) => Promise<SearchResult[] | null>
  more?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  const [results, setResults] = useState<SearchResult[] | null | undefined>(() => peek(cacheKey))
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!near || results !== undefined) return
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (r) => setResults(r?.length ? r : null),
      () => {}, // aborted
    )
    return () => controller.abort()
  }, [near, results])

  if (results === null) return null
  if (results === undefined)
    return (
      <div ref={ref} className="shelf-pending">
        {near && <GhostShelf title={title} wide />}
      </div>
    )
  return (
    <Shelf title={title} more={results.length > 4 ? more : undefined}>
      <Row wide>
        {results.slice(0, 12).map((r) => (
          <ResultTile key={r.id} result={r} small />
        ))}
      </Row>
    </Shelf>
  )
}
