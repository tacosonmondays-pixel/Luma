// Video → animated GIF, on the device. Frames are decoded here from a hidden <video> and drawn to a canvas, then
// streamed one at a time to gif.worker.ts, which quantizes and encodes them with gifenc.
//
// The worker is inlined into the bundle: the service worker only precaches what index.html loads, so a separate
// worker file might be missing offline.

import GifWorker from './gif.worker.ts?worker&inline'

export const GIF_MAX_SECONDS = 10
export const GIF_MAX_WIDTH = 480
export const GIF_MAX_FPS = 15

export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export interface GifOptions {
  start: number
  end: number
  /** In source video pixels. */
  crop: Crop
  /** Output width in pixels; the height follows the crop's aspect. */
  width: number
  fps: number
  signal?: AbortSignal
  onProgress?: (p: number) => void
}

export interface GifPlan {
  start: number
  end: number
  crop: Crop
  width: number
  height: number
  fps: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback)

/** Clamps the options to the video and the caps: at most 10 s, 480 px wide and 15 fps. */
export function clampOptions(
  options: Pick<GifOptions, 'start' | 'end' | 'crop' | 'width' | 'fps'>,
  video: { duration: number; width: number; height: number },
): GifPlan {
  const duration = Math.max(0, finite(video.duration, 0))
  const start = clamp(finite(options.start, 0), 0, duration)
  const end = clamp(finite(options.end, duration), start, Math.min(duration, start + GIF_MAX_SECONDS))

  const x = Math.round(clamp(finite(options.crop.x, 0), 0, video.width - 1))
  const y = Math.round(clamp(finite(options.crop.y, 0), 0, video.height - 1))
  const crop = {
    x,
    y,
    w: Math.round(clamp(finite(options.crop.w, video.width), 1, video.width - x)),
    h: Math.round(clamp(finite(options.crop.h, video.height), 1, video.height - y)),
  }

  // Never upscale: a 200 px crop makes a 200 px GIF at most.
  const width = Math.round(clamp(finite(options.width, GIF_MAX_WIDTH), 1, Math.min(GIF_MAX_WIDTH, crop.w)))
  const height = Math.max(1, Math.round((width * crop.h) / crop.w))
  const fps = clamp(finite(options.fps, GIF_MAX_FPS), 1, GIF_MAX_FPS)
  return { start, end, crop, width, height, fps }
}

/** When each frame is sampled: every 1/fps from start, before end. Always at least one frame. */
export function frameTimes(start: number, end: number, fps: number): number[] {
  const count = Math.max(1, Math.ceil((end - start) * fps - 1e-6))
  return Array.from({ length: count }, (_, i) => start + i / fps)
}

/**
 * Per-frame delays in milliseconds. GIF delays are whole hundredths of a second, so 15 fps alternates 70 and 60 ms
 * instead of drifting to 14.3 fps with a flat 70.
 */
export function frameDelays(count: number, fps: number): number[] {
  const cs = (i: number) => Math.round((i * 100) / fps)
  return Array.from({ length: count }, (_, i) => (cs(i + 1) - cs(i)) * 10)
}

/** Up to `count` of `times`, spread evenly from first to last: the frames the global palette is built from. */
export function sampleTimes(times: number[], count: number): number[] {
  if (times.length <= count) return times.slice()
  return Array.from({ length: count }, (_, i) => times[Math.round((i * (times.length - 1)) / (count - 1))])
}

// ── Crop math (source video pixels) ─────────────────────────────────────

/** The largest crop of the given aspect (width / height) centred in the video. */
export function fitCrop(videoW: number, videoH: number, aspect: number): Crop {
  const w = Math.min(videoW, videoH * aspect)
  const h = w / aspect
  return { x: (videoW - w) / 2, y: (videoH - h) / 2, w, h }
}

/** Moves the crop by (dx, dy), keeping it inside the video. */
export function moveCrop(crop: Crop, dx: number, dy: number, videoW: number, videoH: number): Crop {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, Math.max(0, videoW - crop.w)),
    y: clamp(crop.y + dy, 0, Math.max(0, videoH - crop.h)),
  }
}

/**
 * Scales the crop by `factor` around the point (cx, cy), keeping its aspect, keeping it inside the video, and no
 * narrower than `minW`.
 */
export function scaleCrop(crop: Crop, factor: number, cx: number, cy: number, videoW: number, videoH: number, minW: number): Crop {
  const aspect = crop.w / crop.h
  const maxW = Math.min(videoW, videoH * aspect)
  const w = clamp(crop.w / factor, Math.min(minW, maxW), maxW)
  const h = w / aspect
  const k = w / crop.w
  const moved = { x: cx - (cx - crop.x) * k, y: cy - (cy - crop.y) * k, w, h }
  return moveCrop(moved, 0, 0, videoW, videoH)
}

// ── Video decoding ─────────────────────────────────────────────────────

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

function once(target: EventTarget, type: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(type, done)
      target.removeEventListener('error', fail)
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const fail = () => {
      target.removeEventListener(type, done)
      target.removeEventListener('error', fail)
      signal?.removeEventListener('abort', abort)
      reject(new Error('This video can’t be read'))
    }
    const abort = () => {
      target.removeEventListener(type, done)
      target.removeEventListener('error', fail)
      reject(abortError())
    }
    target.addEventListener(type, done)
    target.addEventListener('error', fail)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * A muted, inline, hidden <video> for `src`, with its first frame loaded. It sits off screen in the document:
 * iOS Safari is more reliable decoding frames for a video that's attached. Call `video.remove()` when done.
 */
export async function openVideo(src: string, signal?: AbortSignal): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('aria-hidden', 'true')
  video.preload = 'auto'
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
  document.body.append(video)
  try {
    const loaded = once(video, 'loadeddata', signal)
    video.src = src
    video.load()
    await loaded
    if (!Number.isFinite(video.duration)) {
      // Some recordings (MediaRecorder WebM) only learn their duration after a seek to the end.
      const seeked = once(video, 'seeked', signal)
      video.currentTime = 1e9
      await seeked
    }
    return video
  } catch (error) {
    video.remove()
    throw error
  }
}

/**
 * Seeks to `time` and resolves once that frame can be drawn. Uses requestVideoFrameCallback when the browser has
 * it, and the `seeked` event otherwise (the dependable path on iOS Safari).
 */
export async function seekTo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  const v = video as FrameVideo
  const target = clamp(time, 0, Math.max(0, finite(video.duration, 0) - 0.001))
  if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return

  let frame: Promise<void> | undefined
  let handle = 0
  if (v.requestVideoFrameCallback) {
    frame = new Promise((resolve) => (handle = v.requestVideoFrameCallback!(() => resolve())))
  }
  const seeked = once(video, 'seeked', signal)
  video.currentTime = target
  await seeked
  if (frame) {
    // The frame callback usually lands within a frame of `seeked`. Don't wait forever if it never comes
    // (a hidden or throttled video may not present frames).
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120))
    await Promise.race([frame, timeout])
    v.cancelVideoFrameCallback?.(handle)
  }
  if (signal?.aborted) throw abortError()
}

// ── Conversion ─────────────────────────────────────────────────────────

type WorkerOut = { type: 'ack' } | { type: 'done'; bytes: ArrayBuffer } | { type: 'error'; message: string }

/** Frames decoded ahead of the encoder. Bounds memory to a few RGBA frames whatever the clip length. */
const IN_FLIGHT = 3
/** Frames sampled for the global palette, drawn at half size. */
const PALETTE_SAMPLES = 8

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void

/**
 * Plays the video at double speed from where it is and calls `take` for each of `times[from…]` with the presented
 * frame that covers it (the one a seek there would show), pausing whenever `ready()` says the encoder is behind (`onResume` registers the
 * callback that picks up again). Resolves with the index of the first time it didn't take: `times.length` when it
 * got them all, less if the browser refused to play or stopped presenting frames.
 */
function playFrames(
  video: HTMLVideoElement,
  times: number[],
  from: number,
  ready: () => boolean,
  take: () => void,
  onResume: (resume: () => void) => void,
): Promise<number> {
  const v = video as FrameVideo & { requestVideoFrameCallback: (callback: FrameCallback) => number }
  return new Promise((resolve) => {
    let next = from
    let mediaTime = video.currentTime
    // How long a source frame lasts: the smallest step seen between presented frames (frames may be dropped).
    let step = Infinity
    let handle = 0
    let stall = 0
    let held = false
    let done = false

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(stall)
      v.cancelVideoFrameCallback?.(handle)
      video.removeEventListener('ended', finish)
      video.pause()
      video.playbackRate = 1
      resolve(next)
    }
    const watch = () => {
      clearTimeout(stall)
      stall = window.setTimeout(finish, 1500)
    }
    // Take every time the current frame covers, as far as the encoder allows. Until the step is known, only
    // times the frame has reached.
    const pump = () => {
      const until = mediaTime + (Number.isFinite(step) ? step : 0) - 0.001
      while (next < times.length && times[next] <= until && ready()) {
        take()
        next++
      }
      if (next >= times.length) finish()
    }
    const onFrame: FrameCallback = (_, metadata) => {
      if (done) return
      const delta = metadata.mediaTime - mediaTime
      if (delta > 0.001) step = Math.min(step, delta)
      mediaTime = metadata.mediaTime
      pump()
      if (done) return
      handle = v.requestVideoFrameCallback(onFrame)
      if (!ready()) {
        held = true
        clearTimeout(stall)
        video.pause()
      } else watch()
    }
    onResume(() => {
      if (!held || done) return
      pump()
      if (done || !ready()) return
      held = false
      watch()
      video.play().catch(finish)
    })

    video.addEventListener('ended', finish)
    video.playbackRate = 2
    handle = v.requestVideoFrameCallback(onFrame)
    watch()
    video.play().catch(finish)
  })
}

/** Turns a video clip into a looping animated GIF. Rejects with an AbortError if `signal` aborts. */
export async function videoToGif(file: Blob, options: GifOptions): Promise<Blob> {
  const { signal, onProgress } = options
  if (signal?.aborted) throw abortError()

  const url = URL.createObjectURL(file)
  const worker = new GifWorker()
  let video: HTMLVideoElement | undefined
  let fail: (error: unknown) => void = () => {}
  const failed = new Promise<never>((_, reject) => (fail = reject))
  failed.catch(() => {})
  const onAbort = () => fail(abortError())
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    video = await Promise.race([openVideo(url, signal), failed])
    const plan = clampOptions(options, { duration: video.duration, width: video.videoWidth, height: video.videoHeight })
    const times = frameTimes(plan.start, plan.end, plan.fps)
    const total = times.length
    const samples = sampleTimes(times, PALETTE_SAMPLES)
    const steps = samples.length + total + 1
    onProgress?.(0)

    // The worker acknowledges each frame once it's encoded; at most IN_FLIGHT frames wait in between.
    let acked = 0
    let posted = 0
    let wake = () => {}
    let onAck = () => {}
    let result: (bytes: ArrayBuffer) => void = () => {}
    const finished = new Promise<ArrayBuffer>((resolve) => (result = resolve))
    worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const message = event.data
      if (message.type === 'ack') {
        acked++
        onProgress?.((samples.length + acked) / steps)
        wake()
        onAck()
      } else if (message.type === 'done') result(message.bytes)
      else fail(new Error(message.message))
    }
    worker.onerror = (event) => fail(new Error(event.message || 'GIF encoder failed'))
    worker.postMessage({ type: 'start', width: plan.width, height: plan.height, delays: frameDelays(total, plan.fps) })

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true, alpha: false })
    if (!context) throw new Error('Canvas unavailable')
    const { x, y, w, h } = plan.crop
    const grab = (width: number, height: number) => {
      context.imageSmoothingQuality = 'high'
      context.drawImage(video!, x, y, w, h, 0, 0, width, height)
      return context.getImageData(0, 0, width, height).data
    }

    // Pass 1: a few frames across the clip for one palette, so colours don't shift from frame to frame.
    const sw = Math.max(1, Math.round(plan.width / 2))
    const sh = Math.max(1, Math.round(plan.height / 2))
    canvas.width = sw
    canvas.height = sh
    const pool = new Uint8Array(samples.length * sw * sh * 4)
    for (const [i, time] of samples.entries()) {
      await Promise.race([seekTo(video, time, signal), failed])
      pool.set(grab(sw, sh), i * sw * sh * 4)
      onProgress?.((i + 1) / steps)
    }
    worker.postMessage({ type: 'palette', samples: pool.buffer }, [pool.buffer])

    // Pass 2: every frame, streamed to the encoder.
    canvas.width = plan.width
    canvas.height = plan.height
    const send = () => {
      const data = grab(plan.width, plan.height)
      worker.postMessage({ type: 'frame', data: data.buffer }, [data.buffer])
      posted++
    }

    // Fast path: play through the range and take frames as they're presented. Whatever it doesn't get to (no frame
    // callbacks, play() refused, a stall) is filled in below by seeking, one frame at a time.
    await Promise.race([seekTo(video, times[0], signal), failed])
    send()
    let next = 1
    if (total > 1 && (video as FrameVideo).requestVideoFrameCallback) {
      next = await Promise.race([playFrames(video, times, 1, () => posted - acked < IN_FLIGHT, send, (resume) => (onAck = resume)), failed])
      onAck = () => {}
    }
    for (let i = next; i < total; i++) {
      while (posted - acked >= IN_FLIGHT) await Promise.race([new Promise<void>((resolve) => (wake = resolve)), failed])
      await Promise.race([seekTo(video, times[i], signal), failed])
      send()
    }
    worker.postMessage({ type: 'finish' })
    const bytes = await Promise.race([finished, failed])
    onProgress?.(1)
    return new Blob([bytes], { type: 'image/gif' })
  } finally {
    signal?.removeEventListener('abort', onAbort)
    worker.terminate()
    video?.removeAttribute('src')
    video?.load()
    video?.remove()
    URL.revokeObjectURL(url)
  }
}
