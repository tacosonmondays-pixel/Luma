// The crop sheet: the media fills the sheet, a frame in the slot's shape shows what the card will show, and the
// rest is dimmed. Drag to move, pinch / wheel / the slider to zoom (1× to 4×), double-tap to reset.
// While a gesture runs, only the media's transform changes (written straight to the element, once a frame).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { CENTER, clampCrop, coverSize, MAX_ZOOM, MIN_ZOOM, panBy, storedCrop, zoomAt } from '../../lib/crop.ts'
import type { ProfileSlot } from '../../lib/library.ts'
import type { Crop } from '../../types.ts'
import { useReducedMotion } from './ProfileCard.tsx'
import type { ShownMedia } from './ProfileMedia.tsx'
import '../../styles/profile.css'

interface Props {
  slot: ProfileSlot
  media: ShownMedia
  crop?: Crop
  /** The frame's width / height: 1 for the avatar, 3 for the banner, the card's own shape for the Background. */
  aspect: number
  onDone: (crop: Crop | undefined) => void
  onCancel: () => void
}

interface Layout {
  fw: number // frame size, px
  fh: number
  fx: number // frame's top-left in the stage, px
  fy: number
}

const TAP_MS = 300
const TAP_SLOP = 10

export function ImageCrop({ slot, media, crop, aspect, onDone, onCancel }: Props) {
  const reduced = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLImageElement & HTMLVideoElement>(null)
  const zoomRef = useRef<HTMLInputElement>(null)
  const [layout, setLayout] = useState<Layout>()
  const [ratio, setRatio] = useState<number>() // the media's width / height, once loaded
  const [closing, setClosing] = useState(false)
  const state = useRef<Crop>(crop ?? CENTER)
  const frame = useRef(0)

  // The frame: as large as the stage allows with a margin, capped so a desktop banner stays a sensible size.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect()
      const margin = width >= 700 ? 56 : 20
      const fw = Math.min(width - margin * 2, (height - margin * 2) * aspect, 960)
      const fh = fw / aspect
      setLayout({ fw, fh, fx: (width - fw) / 2, fy: (height - fh) / 2 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [aspect])

  // Writes the current crop to the media's transform and the slider.
  const paint = () => {
    frame.current = 0
    const el = mediaRef.current
    if (!el || !layout || !ratio) return
    const c = state.current
    const base = coverSize(ratio, layout.fw, layout.fh, 1)
    const left = layout.fw / 2 - c.x * base.w * c.zoom
    const top = layout.fh / 2 - c.y * base.h * c.zoom
    el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${c.zoom})`
    const zoom = zoomRef.current
    if (zoom) {
      zoom.value = String(c.zoom)
      zoom.style.setProperty('--p', `${((c.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`)
    }
  }
  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const set = (next: Crop) => {
    state.current = next
    schedule()
  }

  // Clamp once the sizes are known (a stored crop can come from a different card shape).
  useLayoutEffect(() => {
    if (!layout || !ratio) return
    state.current = clampCrop(state.current, ratio, layout.fw, layout.fh)
    paint()
  })

  // ── Gestures ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const tap = useRef<{ at: number; x: number; y: number; moved: boolean; last: number; lx: number; ly: number }>({ at: 0, x: 0, y: 0, moved: false, last: 0, lx: 0, ly: 0 })
  const [easing, setEasing] = useState(false)

  /** A point relative to the frame's center, in px. */
  const fromCenter = (x: number, y: number) => {
    const rect = stageRef.current!.getBoundingClientRect()
    return { px: x - rect.left - layout!.fx - layout!.fw / 2, py: y - rect.top - layout!.fy - layout!.fh / 2 }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!layout || !ratio) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) Object.assign(tap.current, { at: e.timeStamp, x: e.clientX, y: e.clientY, moved: false })
    else tap.current.moved = true
    setEasing(false)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current
    const before = map.get(e.pointerId)
    if (!before || !layout || !ratio) return
    const now = { x: e.clientX, y: e.clientY }
    if (Math.hypot(now.x - tap.current.x, now.y - tap.current.y) > TAP_SLOP) tap.current.moved = true
    const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1]
    map.set(e.pointerId, now)
    const { fw, fh } = layout
    let c = state.current
    if (!other) {
      c = panBy(c, ratio, fw, fh, now.x - before.x, now.y - before.y)
    } else {
      // Pinch: zoom about the old midpoint, then follow the midpoint.
      const d0 = Math.hypot(before.x - other.x, before.y - other.y)
      const d1 = Math.hypot(now.x - other.x, now.y - other.y)
      const m0 = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 }
      const m1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 }
      const { px, py } = fromCenter(m0.x, m0.y)
      if (d0 > 0) c = zoomAt(c, ratio, fw, fh, c.zoom * (d1 / d0), px, py)
      c = panBy(c, ratio, fw, fh, m1.x - m0.x, m1.y - m0.y)
    }
    set(c)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    if (pointers.current.size || e.type === 'pointercancel') return
    const t = tap.current
    if (t.moved || e.timeStamp - t.at > TAP_MS) return
    // A tap: a second one soon after, close by, resets.
    if (e.timeStamp - t.last < TAP_MS && Math.hypot(e.clientX - t.lx, e.clientY - t.ly) < 30) {
      t.last = 0
      setEasing(!reduced)
      set({ ...CENTER })
    } else Object.assign(t, { last: e.timeStamp, lx: e.clientX, ly: e.clientY })
  }

  // Wheel and trackpad: React's wheel listener is passive, so this one is added by hand to stop the page zooming.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !layout || !ratio) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const step = e.ctrlKey ? 0.01 : 0.0025 // a trackpad pinch arrives as a ctrl+wheel with small deltas
      const { px, py } = fromCenter(e.clientX, e.clientY)
      const c = state.current
      setEasing(false)
      set(zoomAt(c, ratio, layout.fw, layout.fh, c.zoom * Math.exp(-e.deltaY * lines * step), px, py))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  })

  const close = (then: () => void) => {
    if (closing) return
    setClosing(true)
    setTimeout(then, reduced ? 0 : 180)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close(onCancel)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const measure = (el: HTMLImageElement | HTMLVideoElement) => {
    const [w, h] = el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight]
    if (w && h) setRatio(w / h)
  }

  const base = layout && ratio ? coverSize(ratio, layout.fw, layout.fh, 1) : undefined
  const mediaStyle: CSSProperties | undefined = layout && base ? { left: layout.fx, top: layout.fy, width: base.w, height: base.h } : undefined
  const frameStyle: CSSProperties | undefined = layout ? { left: layout.fx, top: layout.fy, width: layout.fw, height: layout.fh } : undefined
  const mediaClass = `ic-media${base ? '' : ' measuring'}${easing ? ' easing' : ''}`
  const src = media.url

  return (
    <div className={`ic${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label="Adjust">
      <header className="ic-head">
        <button type="button" className="ic-cancel" onClick={() => close(onCancel)}>
          Cancel
        </button>
        <button type="button" className="ic-done" disabled={!base} onClick={() => close(() => onDone(storedCrop(state.current)))}>
          Done
        </button>
      </header>
      <div
        className="ic-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {media.kind === 'video' ? (
          <video
            ref={mediaRef}
            className={mediaClass}
            style={mediaStyle}
            src={src}
            poster={media.still}
            muted
            playsInline
            loop
            autoPlay={!reduced}
            disablePictureInPicture
            disableRemotePlayback
            onLoadedMetadata={(e) => measure(e.currentTarget)}
          />
        ) : (
          <img ref={mediaRef} className={mediaClass} style={mediaStyle} src={reduced ? (media.still ?? src) : src} alt="" draggable={false} onLoad={(e) => measure(e.currentTarget)} />
        )}
        <div className={`ic-frame ic-frame-${slot}`} style={frameStyle} aria-hidden="true" />
      </div>
      <div className="ic-foot">
        <input
          ref={zoomRef}
          className="range ic-zoom"
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          defaultValue={state.current.zoom}
          disabled={!base}
          onInput={(e) => {
            if (!layout || !ratio) return
            setEasing(false)
            set(zoomAt(state.current, ratio, layout.fw, layout.fh, Number(e.currentTarget.value)))
          }}
        />
      </div>
    </div>
  )
}
