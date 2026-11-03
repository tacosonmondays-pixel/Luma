import { useEffect, useRef, type PointerEvent } from 'react'
import { useBlobUrl } from '../lib/blobs.ts'
import { gradientFor } from '../lib/format.ts'
import { setOpen, usePlayer, useCurrentTrack } from '../lib/player.ts'
import type { Track } from '../types.ts'
import { TrackArt } from './Art.tsx'
import { IconButton } from './kit.tsx'
import { openTrackMenu } from './Menu.tsx'
import { Scrubber, Transport, Volume } from './Transport.tsx'
import '../styles/player.css'

const CLOSE_AT = 120 // px dragged down before release closes the sheet

function Wash({ track }: { track: Track }) {
  const url = useBlobUrl(`cover:${track.id}`, track.cover)
  return (
    <div className="np-wash" aria-hidden="true">
      {url ? <img key={url} src={url} alt="" draggable={false} /> : <div className="np-wash-fill" style={{ background: gradientFor(track.title + track.artist) }} />}
    </div>
  )
}

/** Swipe the sheet down on touch screens to close it. */
function useSwipeDown() {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; y: number; x: number; t: number; dy: number; locked?: 'y' | 'x' } | null>(null)

  const move = (dy: number) => {
    const el = ref.current
    if (el) el.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || drag.current) return
    if ((e.target as HTMLElement).closest('input, button')) return
    drag.current = { id: e.pointerId, y: e.clientY, x: e.clientX, t: e.timeStamp, dy: 0 }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dy = e.clientY - d.y
    if (!d.locked) {
      if (Math.abs(dy) < 6 && Math.abs(e.clientX - d.x) < 6) return
      d.locked = Math.abs(dy) > Math.abs(e.clientX - d.x) ? 'y' : 'x'
      if (d.locked === 'y') {
        ref.current?.classList.add('dragging')
        try {
          ref.current?.setPointerCapture(e.pointerId)
        } catch {
          // The pointer is already gone.
        }
      }
    }
    if (d.locked !== 'y') return
    d.dy = Math.max(0, dy)
    move(d.dy)
  }
  const onPointerEnd = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    ref.current?.classList.remove('dragging')
    const fast = d.dy > 40 && d.dy / Math.max(1, e.timeStamp - d.t) > 0.6
    move(0)
    if (d.locked === 'y' && (d.dy > CLOSE_AT || fast)) setOpen(false)
  }
  return { ref, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}

/** Fullscreen Now Playing. Stays mounted so it can slide out; closing never pauses. */
export function NowPlaying() {
  const current = useCurrentTrack()
  const open = usePlayer((s) => s.open)
  const playing = usePlayer((s) => s.playing)
  const last = useRef(current)
  if (current) last.current = current
  const track = current ?? last.current
  const swipe = useSwipeDown()

  useEffect(() => {
    if (open && !current) setOpen(false)
  }, [open, current])

  // Focus moves into the sheet when it opens (App makes the page behind it inert) and back to whatever
  // opened it when it closes, unless something else took focus meanwhile (a new playlist's name).
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const frame = requestAnimationFrame(() => swipe.ref.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(frame)
      const now = document.activeElement
      const lost = !now || now === document.body || !!swipe.ref.current?.contains(now)
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shown = open && !!current
  return (
    <div
      ref={swipe.ref}
      className={`np${shown ? ' open' : ''}${playing ? ' playing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      inert={!shown}
      tabIndex={-1}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
      {track && (
        <>
          <Wash track={track} />
          <div className="np-sheet">
            <div className="np-top">
              <IconButton icon="chevron-down" label="Close" onClick={() => setOpen(false)} size={26} />
            </div>
            <div className="np-stage">
              <TrackArt track={track} className="np-art" />
            </div>
            <div className="np-meta">
              <div className="np-text">
                <h2 className="np-title ellipsis">{track.title}</h2>
                <p className="np-artist ellipsis">{track.artist}</p>
              </div>
              <IconButton icon="more" label="More" className="np-more" onClick={(e) => openTrackMenu(e.currentTarget, track.id)} />
            </div>
            <Scrubber className="np-scrub" active={shown} />
            <Transport size="full" />
            <Volume className="np-volume" />
          </div>
        </>
      )}
    </div>
  )
}
