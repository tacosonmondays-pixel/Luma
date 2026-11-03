import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { fitCrop, GIF_MAX_SECONDS, moveCrop, openVideo, scaleCrop, seekTo, videoToGif, type Crop } from '../lib/gif.ts'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import '../styles/gif.css'

interface GifMakerProps {
  file: File
  /** Width / height of the GIF: 1 for an avatar, 3 for a 3:1 banner. */
  aspect: 1 | 3
  onDone: (gif: Blob) => void
  onCancel: () => void
}

type Phase = 'edit' | 'making' | 'done'
type Box = { width: number; height: number }

const OUTPUT = { 1: { width: 320, fps: 12 }, 3: { width: 480, fps: 12 } } as const
const DEFAULT_SECONDS = 4
const MIN_SECONDS = 0.5

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Fits a box of the given aspect inside `space`. */
function fit(aspect: number, space: Box): Box {
  const width = Math.min(space.width, space.height * aspect)
  return { width, height: width / aspect }
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Box>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

function RetakeIcon() {
  return (
    <svg className="icon" width={22} height={22} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3M3 3v5.3h5.3" />
    </svg>
  )
}

function Ring({ progress }: { progress: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <div className="gif-ring" role="progressbar" aria-label="Making GIF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="gif-ring-track" />
        <circle cx="28" cy="28" r={r} className="gif-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
    </div>
  )
}

/** Thumbnails along the trim bar, drawn into one canvas as a hidden video seeks through the clip. */
function Filmstrip({ url, duration, aspect, size }: { url: string; duration: number; aspect: number; size: Box }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !size.width || !size.height || !duration || !aspect) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const context = canvas.getContext('2d')
    if (!context) return
    const thumbW = size.height * aspect * dpr
    const count = Math.max(1, Math.ceil(canvas.width / thumbW))
    const slot = canvas.width / count
    const controller = new AbortController()
    let video: HTMLVideoElement | undefined
    ;(async () => {
      video = await openVideo(url, controller.signal)
      for (let i = 0; i < count; i++) {
        await seekTo(video, ((i + 0.5) / count) * duration, controller.signal)
        // Cover-fit each frame into its slot.
        const sw = Math.min(video.videoWidth, (video.videoHeight * slot) / canvas.height)
        const sh = (sw * canvas.height) / slot
        context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, Math.round(i * slot), 0, Math.ceil(slot), canvas.height)
      }
    })()
      .catch(() => {})
      .finally(() => video?.remove())
    return () => controller.abort()
  }, [url, duration, aspect, size.width, size.height])
  return <canvas ref={ref} className="gif-film" aria-hidden="true" />
}

export function GifMaker({ file, aspect, onDone, onCancel }: GifMakerProps) {
  const url = useObjectUrl(file)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stageRef, stage] = useSize<HTMLDivElement>()
  const [stripRef, strip] = useSize<HTMLDivElement>()

  const [phase, setPhase] = useState<Phase>('edit')
  const [failed, setFailed] = useState(false)
  const [meta, setMeta] = useState({ width: 0, height: 0, duration: 0 })
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 0, h: 0 })
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [gif, setGif] = useState<Blob>()
  const gifUrl = useObjectUrl(gif)
  const making = useRef<AbortController | null>(null)

  // Latest values for gesture handlers, which outlive a render.
  const live = useRef({ crop, range, meta })
  live.current = { crop, range, meta }

  const ready = meta.width > 0 && meta.duration > 0
  const media = ready ? fit(meta.width / meta.height, stage) : { width: 0, height: 0 }

  useEffect(() => () => making.current?.abort(), [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const onLoaded = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !Number.isFinite(video.duration)) return
    const duration = video.duration
    setMeta({ width: video.videoWidth, height: video.videoHeight, duration })
    setCrop(fitCrop(video.videoWidth, video.videoHeight, aspect))
    setRange({ start: 0, end: Math.min(duration, DEFAULT_SECONDS) })
  }

  // ── Preview playback of the trimmed range ──────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing) return
    const { start, end } = live.current.range
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start
    video.play().catch(() => setPlaying(false))
    let frame = 0
    const tick = () => {
      const { start, end } = live.current.range
      if (video.currentTime >= end || video.currentTime < start - 0.25) video.currentTime = start
      setTime(video.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      video.pause()
    }
  }, [playing])

  const show = (t: number) => {
    const video = videoRef.current
    if (video) video.currentTime = t
    setTime(t)
  }

  // ── Crop: drag to move, pinch or scroll to scale ─────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const toVideo = () => meta.width / (media.width || 1)
  const minCropW = () => fitCrop(meta.width, meta.height, aspect).w / 6

  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'edit' || !ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current
    const before = map.get(e.pointerId)
    if (!before) return
    const others = [...map.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p)
    const now = { x: e.clientX, y: e.clientY }
    map.set(e.pointerId, now)
    const k = toVideo()
    const { width, height } = live.current.meta
    let next = live.current.crop
    if (others.length === 0) {
      next = moveCrop(next, (now.x - before.x) * k, (now.y - before.y) * k, width, height)
    } else {
      const other = others[0]
      const d0 = Math.hypot(before.x - other.x, before.y - other.y)
      const d1 = Math.hypot(now.x - other.x, now.y - other.y)
      const mid0 = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 }
      const mid1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 }
      const rect = e.currentTarget.querySelector('.gif-media')!.getBoundingClientRect()
      next = moveCrop(next, (mid1.x - mid0.x) * k, (mid1.y - mid0.y) * k, width, height)
      if (d0 > 0 && d1 > 0) {
        next = scaleCrop(next, d0 / d1, (mid1.x - rect.left) * k, (mid1.y - rect.top) * k, width, height, minCropW())
      }
    }
    live.current.crop = next
    setCrop(next)
  }
  const onStageUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (phase !== 'edit' || !ready) return
    const { x, y, w, h } = crop
    setCrop(scaleCrop(crop, Math.exp(e.deltaY * 0.0025 * -1), x + w / 2, y + h / 2, meta.width, meta.height, minCropW()))
  }
  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phase !== 'edit' || !ready) return
    const step = crop.w * 0.05
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const { x, y, w, h } = crop
    if (moves[e.key]) setCrop(moveCrop(crop, ...moves[e.key], meta.width, meta.height))
    else if (e.key === '+' || e.key === '=') setCrop(scaleCrop(crop, 1.1, x + w / 2, y + h / 2, meta.width, meta.height, minCropW()))
    else if (e.key === '-') setCrop(scaleCrop(crop, 1 / 1.1, x + w / 2, y + h / 2, meta.width, meta.height, minCropW()))
    else return
    e.preventDefault()
  }

  // ── Trim: drag a handle, or the range between them ─────────────────
  const trim = useRef<{ grip: 'start' | 'end' | 'range'; x: number; start: number; end: number } | null>(null)
  const maxLength = Math.min(GIF_MAX_SECONDS, meta.duration)
  const minLength = Math.min(MIN_SECONDS, meta.duration)

  const onTrimDown = (e: PointerEvent<HTMLDivElement>) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.dataset.grip as 'start' | 'end' | 'range' | undefined
    if (!grip || !ready) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setPlaying(false)
    trim.current = { grip, x: e.clientX, ...range }
  }
  const onTrimMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = trim.current
    if (!t) return
    const dt = ((e.clientX - t.x) / (strip.width || 1)) * meta.duration
    let { start, end } = t
    if (t.grip === 'start') start = clamp(t.start + dt, Math.max(0, end - maxLength), end - minLength)
    else if (t.grip === 'end') end = clamp(t.end + dt, start + minLength, Math.min(meta.duration, start + maxLength))
    else {
      const shift = clamp(dt, -t.start, meta.duration - t.end)
      start = t.start + shift
      end = t.end + shift
    }
    setRange({ start, end })
    show(t.grip === 'end' ? end : start)
  }
  const onTrimUp = () => {
    if (!trim.current) return
    trim.current = null
    show(range.start)
  }
  const nudge = (grip: 'start' | 'end', delta: number) => {
    let { start, end } = range
    if (grip === 'start') start = clamp(start + delta, Math.max(0, end - maxLength), end - minLength)
    else end = clamp(end + delta, start + minLength, Math.min(meta.duration, start + maxLength))
    setRange({ start, end })
    show(grip === 'start' ? start : end)
  }
  const onGripKey = (grip: 'start' | 'end') => (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowLeft' ? -0.1 : e.key === 'ArrowRight' ? 0.1 : 0
    if (!delta) return
    e.preventDefault()
    nudge(grip, e.shiftKey ? delta * 10 : delta)
  }

  // ── Make ───────────────────────────────────────────────────────────
  const make = async () => {
    if (!ready) return
    setPlaying(false)
    setFailed(false)
    setProgress(0)
    setPhase('making')
    const controller = new AbortController()
    making.current = controller
    try {
      const out = await videoToGif(file, { ...range, crop, ...OUTPUT[aspect], signal: controller.signal, onProgress: setProgress })
      setGif(out)
      setPhase('done')
    } catch (error) {
      if (controller.signal.aborted) return
      console.error(error)
      setFailed(true)
      setPhase('edit')
    } finally {
      if (making.current === controller) making.current = null
    }
  }
  const retake = () => {
    setGif(undefined)
    setPhase('edit')
    show(range.start)
  }
  const cancel = () => {
    making.current?.abort()
    onCancel()
  }

  const pct = (n: number, of: number) => `${(n / (of || 1)) * 100}%`
  const result = fit(aspect, { width: stage.width, height: stage.height })

  return (
    <div className="gif-sheet" role="dialog" aria-modal="true" aria-label="Make GIF">
      <div className={`gif-panel ${phase}`}>
        <header className="gif-head">
          <IconButton icon="close" label="Cancel" onClick={cancel} />
        </header>

        <div
          ref={stageRef}
          className="gif-stage"
          tabIndex={phase === 'edit' ? 0 : -1}
          aria-label="Crop"
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
          onWheel={onWheel}
          onKeyDown={onStageKey}
        >
          <div className="gif-media" style={{ width: media.width, height: media.height }}>
            {url && (
              <video
                ref={videoRef}
                src={url}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={onLoaded}
                onError={() => setFailed(true)}
                onEnded={() => setPlaying(false)}
              />
            )}
            {ready && (
              <div
                className={`gif-crop${aspect === 1 ? ' round' : ''}`}
                style={{ left: pct(crop.x, meta.width), top: pct(crop.y, meta.height), width: pct(crop.w, meta.width), height: pct(crop.h, meta.height) }}
              />
            )}
          </div>
          {phase === 'making' && <Ring progress={progress} />}
          {phase === 'done' && gifUrl && (
            <img className={`gif-result${aspect === 1 ? ' round' : ''}`} src={gifUrl} alt="GIF" style={{ width: result.width, height: result.height }} />
          )}
          {failed && phase === 'edit' && (
            <div className="gif-alert" role="alert" aria-label="Couldn’t make a GIF from this video">
              <Icon name="alert" size={28} />
            </div>
          )}
        </div>

        <div className="gif-trim" aria-hidden={phase !== 'edit'}>
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} disabled={!ready || phase !== 'edit'} />
          <div ref={stripRef} className="gif-strip" onPointerDown={onTrimDown} onPointerMove={onTrimMove} onPointerUp={onTrimUp} onPointerCancel={onTrimUp}>
            {url && ready && <Filmstrip url={url} duration={meta.duration} aspect={meta.width / meta.height} size={strip} />}
            {ready && (
              <>
                <div className="gif-shade" style={{ left: 0, width: pct(range.start, meta.duration) }} />
                <div className="gif-shade" style={{ right: 0, width: pct(meta.duration - range.end, meta.duration) }} />
                <div className="gif-range" data-grip="range" style={{ left: pct(range.start, meta.duration), width: pct(range.end - range.start, meta.duration) }}>
                  <div
                    className="gif-grip start"
                    data-grip="start"
                    role="slider"
                    tabIndex={0}
                    aria-label="Start"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(meta.duration * 10) / 10}
                    aria-valuenow={Math.round(range.start * 10) / 10}
                    onKeyDown={onGripKey('start')}
                  />
                  <div
                    className="gif-grip end"
                    data-grip="end"
                    role="slider"
                    tabIndex={0}
                    aria-label="End"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(meta.duration * 10) / 10}
                    aria-valuenow={Math.round(range.end * 10) / 10}
                    onKeyDown={onGripKey('end')}
                  />
                </div>
                {playing && <div className="gif-playhead" style={{ left: pct(time, meta.duration) }} />}
              </>
            )}
          </div>
        </div>

        <footer className="gif-foot">
          {phase === 'done' ? (
            <>
              <button type="button" className="icon-btn gif-retake" aria-label="Retake" onClick={retake}>
                <RetakeIcon />
              </button>
              <button type="button" className="pill primary" onClick={() => gif && onDone(gif)}>
                Use
              </button>
            </>
          ) : (
            <button type="button" className="pill primary" onClick={make} disabled={!ready || phase === 'making'}>
              Make GIF
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
