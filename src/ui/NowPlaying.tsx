import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { styleFor, useAppearance } from '../lib/appearance.ts'
import { useBlobUrl } from '../lib/blobs.ts'
import { useCoverLook, type CoverLook } from '../lib/palette.ts'
import { setOpen, usePlayer, useCurrentTrack, useTime } from '../lib/player.ts'
import type { Track } from '../types.ts'
import { TrackArt } from './Art.tsx'
import { IconButton } from './kit.tsx'
import { openTrackMenu } from './Menu.tsx'
import { Scrubber, Transport, Volume } from './Transport.tsx'
import { Wash } from './Wash.tsx'
import { ThemeDecor } from './y2k/ThemeDecor.tsx'
import '../styles/player.css'

const CLOSE_AT = 120 // px dragged down before release closes the sheet
const HIDE_AFTER = 3000 // ms before the Canvas style hides its controls

const reduce = matchMedia('(prefers-reduced-motion: reduce)')

/** Swipe the sheet down on touch screens to close it. `dragged` tells a click that ended a drag apart from a tap. */
function useSwipeDown() {
  const ref = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const drag = useRef<{ id: number; y: number; x: number; t: number; dy: number; locked?: 'y' | 'x' } | null>(null)

  const move = (dy: number) => {
    const el = ref.current
    if (el) el.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }

  const onPointerDown = (e: PointerEvent) => {
    dragged.current = false
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
      dragged.current = true
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
  return { ref, dragged, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }
}

/** Canvas style: the controls fade out after a few seconds of playing, and a tap brings them back. */
function useAutoHide(enabled: boolean) {
  const [hidden, setHidden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(false) // a finger or the mouse is on a control
  const on = useRef(enabled)
  on.current = enabled

  const poke = useCallback(() => {
    clearTimeout(timer.current)
    setHidden(false)
    if (on.current && !held.current) timer.current = setTimeout(() => setHidden(true), HIDE_AFTER)
  }, [])
  const hide = () => {
    clearTimeout(timer.current)
    setHidden(true)
  }
  useEffect(() => {
    poke()
    return () => clearTimeout(timer.current)
  }, [enabled, poke])
  return { hidden: enabled && hidden, poke, hide, held }
}

/** Canvas style: where the title and the bar travel to when the controls hide (offsets ignore transforms). */
function useRestingPlace(np: RefObject<HTMLDivElement | null>, enabled: boolean, trackId: string | undefined) {
  useLayoutEffect(() => {
    const root = np.current
    if (!root || !enabled) return
    const topIn = (el: HTMLElement | null) => {
      let y = 0
      while (el && el !== root) {
        y += el.offsetTop
        el = el.offsetParent as HTMLElement | null
      }
      return y
    }
    const measure = () => {
      const title = root.querySelector<HTMLElement>('.np-title')
      const bar = root.querySelector<HTMLElement>('.np-scrub .range')
      const sheet = root.querySelector<HTMLElement>('.np-sheet')
      if (!title || !bar || !sheet) return
      const target = root.clientHeight - parseFloat(getComputedStyle(sheet).paddingBottom) + 2
      const desk = root.clientWidth >= 900
      root.style.setProperty('--bar-drop', `${target - (topIn(bar) + bar.offsetHeight / 2)}px`)
      root.style.setProperty('--title-drop', `${target - 14 - (topIn(title) + title.offsetHeight)}px`)
      root.style.setProperty('--title-scale', ((desk ? 17 : 15) / parseFloat(getComputedStyle(title).fontSize)).toFixed(3))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [np, enabled, trackId])
}

// ── Color ───────────────────────────────────────────────────────────────

function Cover({ track, look }: { track: Track; look?: CoverLook }) {
  return (
    <div className="np-cover">
      {look && <img className="np-glow" src={look.wash} alt="" draggable={false} />}
      <TrackArt key={track.id} track={track} className="np-art" />
    </div>
  )
}

// ── Vinyl ───────────────────────────────────────────────────────────────

// Deck geometry in deck units (0–1): record center and radius, tonearm pivot and length.
const C = { x: 0.461, y: 0.52 }
const R = 0.4
const P = { x: 0.9, y: 0.1 }
const ARM = 0.5
const REST = -4 // degrees: the arm parked beside the record
const R_OUT = R * 0.955 // first groove
const R_IN = R * 0.47 // last groove

/** The arm angle that puts the needle on the groove at radius r (positive turns toward the record). */
function angleFor(r: number): number {
  let lo = 0
  let hi = 70
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const t = (mid * Math.PI) / 180
    if (Math.hypot(P.x - ARM * Math.sin(t) - C.x, P.y + ARM * Math.cos(t) - C.y) > r) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Grooves, drawn once per size into a canvas that never repaints while the label turns. */
function drawGrooves(cv: HTMLCanvasElement) {
  const css = cv.getBoundingClientRect().width
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const W = Math.round(css * dpr)
  if (!W || cv.width === W) return
  cv.width = cv.height = W
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const c = W / 2
  const r = W / 2
  const base = ctx.createRadialGradient(c, c, 0, c, c, r)
  base.addColorStop(0, '#151517')
  base.addColorStop(1, '#0a0a0b')
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.fill()
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gaps = [0.585, 0.665, 0.795, 0.875].map((f) => f * r)
  const step = Math.max(1, dpr * 0.75)
  ctx.lineWidth = Math.max(0.6, dpr * 0.4)
  for (let rr = r * 0.47; rr < r * 0.965; rr += step) {
    if (gaps.some((g) => Math.abs(rr - g) < dpr * 2.4)) continue
    const k = rr / r
    const env = 0.55 + 0.45 * Math.sin(k * 61) * Math.sin(k * 13 + 1.1)
    ctx.strokeStyle = `rgba(255,255,255,${(0.025 + 0.06 * env * (0.6 + 0.4 * rnd())).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(c, c, rr, 0, Math.PI * 2)
    ctx.stroke()
  }
  for (const g of gaps) {
    ctx.lineWidth = dpr * 1.8
    ctx.strokeStyle = 'rgba(0,0,0,.4)'
    ctx.beginPath()
    ctx.arc(c, c, g, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = Math.max(0.6, dpr * 0.5)
    ctx.strokeStyle = 'rgba(255,255,255,.035)'
    ctx.beginPath()
    ctx.arc(c, c, g + dpr * 1.2, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.lineWidth = Math.max(0.6, dpr * 0.5)
  for (const f of [0.445, 0.455]) {
    ctx.strokeStyle = 'rgba(255,255,255,.07)'
    ctx.beginPath()
    ctx.arc(c, c, r * f, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.lineWidth = dpr * 1.2
  ctx.strokeStyle = 'rgba(255,255,255,.09)'
  ctx.beginPath()
  ctx.arc(c, c, r - dpr * 1.6, 0, Math.PI * 2)
  ctx.stroke()
}

/** The arm follows the song: it swings over and drops when playing, lifts and parks when paused, and creeps
 * inward with the time. A jump (new song, seek) lifts it, moves it and drops it again. */
function Tonearm({ playing }: { playing: boolean }) {
  const { time, duration } = useTime(false)
  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const target = playing ? angleFor(R_OUT + (R_IN - R_OUT) * progress) : REST
  const [angle, setAngle] = useState(REST)
  const [down, setDown] = useState(false)
  const current = useRef(REST)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, reduce.matches ? 0 : ms))
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const swing = (deg: number) => {
    current.current = deg
    setAngle(deg)
  }

  useEffect(() => {
    clear()
    if (!playing) {
      setDown(false) // lift first, then swing home
      later(() => swing(REST), 180)
      return
    }
    const parked = current.current === REST
    swing(target) // swing over, still lifted, then drop the needle
    later(() => setDown(true), parked ? 760 : 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  useEffect(() => {
    if (!playing || current.current === REST) return
    const gap = Math.abs(target - current.current)
    if (gap <= 0.3) return
    if (gap < 2) return swing(target) // the slow creep inward
    clear()
    setDown(false)
    later(() => swing(target), 160)
    later(() => setDown(true), 940)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, playing])

  useEffect(() => clear, [])

  const style = { '--a': `${angle.toFixed(2)}deg` } as CSSProperties
  return (
    <div className={`tonearm${down ? ' down' : ''}`} style={style} aria-hidden="true">
      <div className="arm-base" />
      <div className="arm-shadow">
        <svg viewBox="-100 -100 200 720">
          <defs>
            <filter id="np-arm-shadow" x="-1" y="-1" width="3" height="3">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
          <g fill="#000" filter="url(#np-arm-shadow)">
            <rect x="-24" y="-92" width="48" height="58" rx="10" />
            <rect x="-6" y="-30" width="12" height="470" rx="6" />
            <rect x="-17" y="428" width="34" height="86" rx="8" />
          </g>
        </svg>
      </div>
      <div className="arm">
        <svg viewBox="-100 -100 200 720">
          <defs>
            <linearGradient id="np-arm-rod" x1="0" x2="1">
              <stop offset="0" stopColor="#5d5d63" />
              <stop offset=".38" stopColor="#f6f6f8" />
              <stop offset=".7" stopColor="#a3a3a9" />
              <stop offset="1" stopColor="#4c4c51" />
            </linearGradient>
            <linearGradient id="np-arm-weight" x1="0" x2="1">
              <stop offset="0" stopColor="#3a3a3f" />
              <stop offset=".34" stopColor="#d9d9de" />
              <stop offset=".62" stopColor="#8b8b91" />
              <stop offset="1" stopColor="#2e2e33" />
            </linearGradient>
            <linearGradient id="np-arm-head" x1="0" x2="1">
              <stop offset="0" stopColor="#121214" />
              <stop offset=".45" stopColor="#2e2e33" />
              <stop offset="1" stopColor="#0f0f11" />
            </linearGradient>
            <radialGradient id="np-arm-bearing" cx=".42" cy=".38" r=".7">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset=".45" stopColor="#b8b8be" />
              <stop offset="1" stopColor="#55555b" />
            </radialGradient>
          </defs>
          <rect x="-24" y="-92" width="48" height="58" rx="10" fill="url(#np-arm-weight)" />
          <rect x="-24" y="-46" width="48" height="4" fill="rgba(0,0,0,.35)" />
          <rect x="-5.5" y="-34" width="11" height="476" rx="5.5" fill="url(#np-arm-rod)" />
          <path
            d="M-13 432h26a4 4 0 0 1 4 4v68a10 10 0 0 1-10 10h-14a10 10 0 0 1-10-10v-68a4 4 0 0 1 4-4Z"
            fill="url(#np-arm-head)"
            stroke="rgba(255,255,255,.14)"
            strokeWidth="1.5"
          />
          <path d="M17 446c8 0 14-3 19-9" fill="none" stroke="url(#np-arm-rod)" strokeWidth="5" strokeLinecap="round" />
          <rect x="-9" y="486" width="18" height="16" rx="3" className="arm-cart" />
          <circle r="25" fill="url(#np-arm-bearing)" />
          <circle r="25" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="1.5" />
          <circle r="10" fill="#1b1b1e" />
          <circle r="10" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  )
}

/** A record with the cover as its label. Only the label turns (grooves look the same at any angle), and only
 * while Now Playing is open and playing; it spins up and coasts down like a platter. */
function Deck({ track, open, playing }: { track: Track; open: boolean; playing: boolean }) {
  const grooves = useRef<HTMLCanvasElement>(null)
  const spin = useRef<HTMLDivElement>(null)
  const anim = useRef<Animation>(undefined)

  useEffect(() => {
    const cv = grooves.current
    if (!cv) return
    drawGrooves(cv)
    const observer = new ResizeObserver(() => drawGrooves(cv))
    observer.observe(cv)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const a = spin.current?.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 3600, iterations: Infinity })
    if (!a) return
    a.pause()
    a.playbackRate = 0.0001
    anim.current = a
    return () => a.cancel()
  }, [])

  useEffect(() => {
    const a = anim.current
    if (!a) return
    if (!open || reduce.matches) return void a.pause()
    const to = playing ? 1 : 0
    const from = a.playState === 'running' ? a.playbackRate : 0.0001
    if (to > 0) a.play()
    const start = performance.now()
    const ms = to > 0 ? 700 : 1500
    let frame = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      // Spinning up is smooth; slowing down coasts like a heavy platter.
      const e = to > from ? k * k * (3 - 2 * k) : 1 - (1 - k) * (1 - k)
      a.playbackRate = Math.max(0.0001, from + (to - from) * e)
      if (k < 1) frame = requestAnimationFrame(tick)
      else if (to === 0) a.pause()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [open, playing])

  return (
    <div className="deck">
      <div className="deck-glow" />
      <div className="record">
        <canvas ref={grooves} className="grooves" />
        <div className="record-sheen" />
        <div ref={spin} className="record-spin">
          <TrackArt key={track.id} track={track} className="record-label" />
        </div>
        <div className="record-spindle" />
      </div>
      <Tonearm playing={open && playing} />
    </div>
  )
}

// ── Canvas ──────────────────────────────────────────────────────────────

/** The song's own looping image, GIF or video, full-bleed. A video plays muted and inline, only while Now
 * Playing is open and the song plays; it never touches the audio session. */
function CanvasMedia({ track, active }: { track: Track; active: boolean }) {
  const url = useBlobUrl(`canvas:${track.id}`, track.canvas)
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (active && !reduce.matches) v.play().catch(() => {}) // Low Power Mode blocks autoplay: the first frame stays
    else v.pause()
  }, [active, url])
  if (!url) return null
  return (
    <div className="np-canvas" key={url}>
      {track.canvasKind === 'video' ? (
        <video
          ref={video}
          src={url}
          muted
          loop
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          aria-hidden="true"
        />
      ) : (
        <img src={url} alt="" draggable={false} />
      )}
    </div>
  )
}

// ── Sheet ───────────────────────────────────────────────────────────────

/** Fullscreen Now Playing in the chosen player style. Stays mounted so it can slide out; closing never pauses. */
export function NowPlaying() {
  const current = useCurrentTrack()
  const open = usePlayer((s) => s.open)
  const playing = usePlayer((s) => s.playing)
  const chosen = useAppearance((s) => s.playerStyle)
  const last = useRef(current)
  if (current) last.current = current
  const track = current ?? last.current
  const swipe = useSwipeDown()
  const style = styleFor(chosen, track)
  const shown = open && !!current

  const fresh = useCoverLook(`cover:${track?.id}`, track?.cover)
  const lastLook = useRef<{ id?: string; look?: CoverLook }>({})
  if (fresh || track?.cover === undefined) lastLook.current = { id: track?.id, look: fresh }
  const look = lastLook.current.look

  const chrome = useAutoHide(style === 'canvas' && shown && playing)
  useEffect(() => chrome.poke(), [track?.id, chrome.poke]) // a new song shows its name for a moment
  useRestingPlace(swipe.ref, style === 'canvas', track?.id)

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

  const onControl = (e: PointerEvent) => !!(e.target as HTMLElement).closest('button, input, a')
  const room = look?.tones ? ({ '--np-glow': look.tones[0], '--np-glow2': look.tones[1] } as CSSProperties) : undefined

  return (
    <div
      ref={swipe.ref}
      className={`np${shown ? ' open' : ''}${playing ? ' playing' : ''}${chrome.hidden ? ' chrome-hidden' : ''}`}
      data-style={style}
      style={style === 'vinyl' ? room : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      inert={!shown}
      tabIndex={-1}
      onPointerDown={(e) => {
        swipe.onPointerDown(e)
        if (onControl(e)) {
          chrome.held.current = true
          chrome.poke()
        }
      }}
      onPointerMove={(e) => {
        swipe.onPointerMove(e)
        if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) chrome.poke()
      }}
      onPointerUp={(e) => {
        swipe.onPointerUp(e)
        if (chrome.held.current) {
          chrome.held.current = false
          chrome.poke()
        }
      }}
      onPointerCancel={(e) => {
        swipe.onPointerCancel(e)
        chrome.held.current = false
      }}
      onClick={(e) => {
        if (style !== 'canvas' || swipe.dragged.current || (e.target as HTMLElement).closest('button, input, a')) return
        if (chrome.hidden || !playing) chrome.poke()
        else chrome.hide()
      }}
      onKeyDown={chrome.poke}
    >
      {track && (
        <>
          <div className="np-backdrop" aria-hidden="true">
            {style === 'canvas' ? (
              <CanvasMedia track={track} active={shown && playing} />
            ) : style === 'color' ? (
              <Wash blobKey={`cover:${track.id}`} v={track.cover} seed={track.title + track.artist} active={shown} playing={playing} />
            ) : (
              <div className="np-room" />
            )}
            <div className="np-shade" />
            <div className="np-dim" />
            <div className="np-grain" />
          </div>
          <div className="np-sheet">
            <ThemeDecor place="now-playing" />
            <div className="np-top">
              <button type="button" className="np-grabber" aria-label="Close" onClick={() => setOpen(false)}>
                <span />
              </button>
              <IconButton icon="chevron-down" label="Close" className="np-close" onClick={() => setOpen(false)} size={26} />
            </div>
            <div className="np-stage">
              {style === 'vinyl' ? <Deck track={track} open={shown} playing={playing} /> : style === 'color' ? <Cover track={track} look={look} /> : null}
            </div>
            <div className="np-controls">
              <div className="np-meta">
                <div className="np-text" key={track.id}>
                  <h2 className="np-title ellipsis">{track.title}</h2>
                  <p className="np-artist ellipsis">{track.artist}</p>
                </div>
                <IconButton icon="more" label="More" className="np-more" onClick={(e) => openTrackMenu(e.currentTarget, track.id)} />
              </div>
              <Scrubber className="np-scrub" active={shown} />
              <Transport size="full" />
              <Volume className="np-volume" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
