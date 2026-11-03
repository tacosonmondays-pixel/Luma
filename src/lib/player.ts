// Playback. One <audio> element for the whole app, driven by a small zustand store.
//
// iPhone notes (see AGENTS.md):
// - Audio plays straight from the element. Routing it through Web Audio stops playback on the lock screen.
// - `loop` stays on and a wrap to 0:00 counts as "track ended". iOS ends the audio session when a track
//   finishes in the background; swapping the source while the element is still playing keeps it alive.
// - Volume is read-only on iOS (`volumeLocked`); the hardware buttons control it.

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { blobUrl, getBlob } from './blobs.ts'
import { updateTrack, useLibrary } from './library.ts'
import * as Q from './queue.ts'
import type { Track } from '../types.ts'

export const audio = new Audio()
audio.preload = 'auto'
audio.loop = true

export const volumeLocked = (() => {
  const probe = new Audio()
  probe.volume = 0.5
  return probe.volume !== 0.5
})()

interface PlayerState {
  queue: Q.Queue
  shuffle: boolean
  repeat: Q.Repeat
  volume: number
  position: number // resume point, saved every few seconds
  playing: boolean
  open: boolean // Now Playing is showing
}

export const usePlayer = create<PlayerState>()(
  persist(
    (): PlayerState => ({ queue: Q.emptyQueue, shuffle: false, repeat: 'off', volume: 1, position: 0, playing: false, open: false }),
    {
      name: 'luma-player',
      partialize: ({ queue, shuffle, repeat, volume, position }) => ({ queue, shuffle, repeat, volume, position }),
    },
  ),
)

const { getState, setState } = usePlayer
const currentId = () => getState().queue.ids[getState().queue.index]

export function useCurrentTrack(): Track | undefined {
  const id = usePlayer((s) => s.queue.ids[s.queue.index])
  return useLibrary((s) => (id === undefined ? undefined : s.tracks[id]))
}

// ── Loading ──────────────────────────────────────────────────────────────

let loaded: string | undefined
let token = 0
let lastTime = 0 // last natural timeupdate; seek() moves it so our own seeks never look like a wrap

async function load(id: string | undefined, play: boolean, at = 0): Promise<void> {
  const mine = ++token
  if (!play || id === undefined) audio.pause()
  if (id === undefined) {
    loaded = undefined
    audio.removeAttribute('src')
    audio.load() // resets `paused` without a 'pause' event
    setState({ playing: false })
    syncMediaSession()
    return
  }
  const blob = await getBlob(`audio:${id}`)
  if (mine !== token) return
  if (!blob) return void Promise.resolve().then(() => skipMissing(id))
  const previous = audio.src
  loaded = id
  lastTime = at
  audio.src = URL.createObjectURL(blob)
  if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
  // The resume point applies to this load only; a newer load (another song) starts from 0.
  if (at > 0)
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (mine === token) audio.currentTime = at
      },
      { once: true },
    )
  syncMediaSession()
  if (play) audio.play().catch(() => {})
}

/** Drop a song that can't play (its audio is gone, or this browser can't decode it) and go on with the queue. */
function skipMissing(id: string, play = getState().playing) {
  setState((s) => ({ queue: Q.remove(s.queue, id) }))
  void load(currentId(), play)
}

function trackEnded() {
  const { queue, repeat } = getState()
  if (repeat === 'one') return // the loop already restarted it
  const step = Q.next(queue, repeat, true)
  setState({ queue: { ...queue, index: step.index } })
  void load(currentId(), step.play)
}

audio.volume = getState().volume
audio.addEventListener('error', () => {
  if (loaded !== undefined && audio.error) skipMissing(loaded, !audio.paused || getState().playing)
})
audio.addEventListener('play', () => setState({ playing: true }))
audio.addEventListener('pause', () => setState({ playing: false, position: audio.currentTime }))
audio.addEventListener('timeupdate', () => {
  lastTime = audio.currentTime
  if (Math.abs(audio.currentTime - getState().position) > 5) setState({ position: audio.currentTime })
})
audio.addEventListener('seeking', () => {
  if (audio.duration - lastTime < 1.5 && audio.currentTime < 1) trackEnded()
})
audio.addEventListener('loadedmetadata', () => {
  const track = loaded ? useLibrary.getState().tracks[loaded] : undefined
  if (track && !track.duration && Number.isFinite(audio.duration)) updateTrack(track.id, { duration: audio.duration })
  syncPosition()
})
for (const event of ['play', 'pause', 'seeked', 'ratechange']) audio.addEventListener(event, syncPosition)

// Follow library changes, whichever way they were made (here or in another tab): new artwork or names
// go to the lock screen, and deleted songs leave the queue.
let libraryLoaded = useLibrary.persist.hasHydrated()
useLibrary.persist.onFinishHydration(() => (libraryLoaded = true))
useLibrary.subscribe((lib, prev) => {
  if (lib.tracks === prev.tracks || !libraryLoaded) return
  if (loaded && lib.tracks[loaded] && lib.tracks[loaded] !== prev.tracks[loaded]) syncMediaSession()
  const before = currentId()
  let queue = getState().queue
  for (const id of queue.ids) if (!lib.tracks[id]) queue = Q.remove(queue, id)
  if (queue === getState().queue) return
  setState({ queue })
  if (before !== currentId()) void load(currentId(), !audio.paused)
})

// ── Commands ─────────────────────────────────────────────────────────────

/** Load the saved queue position after the library is ready (does not start playback). */
export function restore(): void {
  const id = currentId()
  if (id !== undefined && loaded === undefined) void load(id, false, getState().position)
}

/** Play `ids` from `index`. Songs that aren't downloaded are left out (and `index` follows the song it named). */
export function playTracks(ids: string[], index = 0): void {
  const tracks = useLibrary.getState().tracks
  const list = Q.playable(ids, tracks)
  const at = ids[index] !== undefined && list.includes(ids[index]) ? list.indexOf(ids[index]) : 0
  const queue = Q.start(list, at, getState().shuffle)
  setState({ queue })
  void load(currentId(), true)
}

export function shufflePlay(ids: string[]): void {
  setState({ shuffle: true, queue: Q.start(Q.playable(ids, useLibrary.getState().tracks), -1, true) })
  void load(currentId(), true)
}

export function playNext(id: string): void {
  if (!Q.playable([id], useLibrary.getState().tracks).length) return
  const empty = currentId() === undefined
  setState((s) => ({ queue: Q.insertNext(s.queue, id) }))
  if (empty) void load(currentId(), true)
}

/** Start playback; never pauses. */
export function play(): void {
  if (loaded === undefined) return void load(currentId(), true, getState().position)
  audio.play().catch(() => {})
}

export function toggle(): void {
  if (loaded === undefined || audio.paused) play()
  else audio.pause()
}

export function next(): void {
  const { queue, repeat } = getState()
  if (currentId() === undefined) return
  const step = Q.next(queue, repeat, false)
  setState({ queue: { ...queue, index: step.index } })
  void load(currentId(), step.play)
}

export function previous(): void {
  const { queue, repeat } = getState()
  if (currentId() === undefined) return
  const step = Q.previous(queue, repeat, audio.currentTime)
  if (step.restart) return seek(0)
  setState({ queue: { ...queue, index: step.index } })
  void load(currentId(), true)
}

export function seek(time: number): void {
  const end = Number.isFinite(audio.duration) ? audio.duration - 0.25 : time
  const t = Math.max(0, Math.min(time, end))
  lastTime = t
  audio.currentTime = t
}

/** Hold-to-scan for the previous/next buttons. Returns a function that stops scanning. */
export function scan(direction: 1 | -1): () => void {
  const timer = setInterval(() => {
    const to = audio.currentTime + direction * 2
    // At either end, stop instead of seeking to the same spot again and again: going forward moves on to
    // the next song, going back plays from the start.
    if (direction > 0 && to >= audio.duration - 0.25) {
      clearInterval(timer)
      next()
    } else if (direction < 0 && to <= 0) {
      clearInterval(timer)
      seek(0)
    } else seek(to)
  }, 120)
  return () => clearInterval(timer)
}

let unmuted = 1 // the volume to go back to after muting

export function setVolume(volume: number): void {
  audio.volume = volume
  setState({ volume })
}

export function toggleMute(): void {
  const { volume } = getState()
  if (volume > 0) unmuted = volume
  setVolume(volume > 0 ? 0 : unmuted)
}

export function toggleShuffle(): void {
  setState((s) => ({ shuffle: !s.shuffle, queue: Q.setShuffle(s.queue, !s.shuffle) }))
}

export function cycleRepeat(): void {
  setState((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }))
}

export const setOpen = (open: boolean) => setState({ open })

// ── Time for the UI ──────────────────────────────────────────────────────

/** Current time and duration, updated every frame while playing and `active` (pass false while hidden). */
export function useTime(active = true): { time: number; duration: number } {
  const playing = usePlayer((s) => s.playing)
  const track = useCurrentTrack()
  const read = () => ({
    time: audio.currentTime,
    duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track?.duration ?? 0),
  })
  const [value, setValue] = useState(read)
  useEffect(() => {
    let frame = 0
    const update = () => setValue(read())
    const tick = () => {
      update()
      frame = requestAnimationFrame(tick)
    }
    update()
    if (playing && active) frame = requestAnimationFrame(tick)
    const events = ['timeupdate', 'seeked', 'durationchange', 'emptied']
    events.forEach((e) => audio.addEventListener(e, update))
    return () => {
      cancelAnimationFrame(frame)
      events.forEach((e) => audio.removeEventListener(e, update))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, active, track?.id, track?.duration])
  return value
}

// ── Lock screen / media keys ─────────────────────────────────────────────

function syncMediaSession() {
  if (!('mediaSession' in navigator)) return
  const track = loaded ? useLibrary.getState().tracks[loaded] : undefined
  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }
  const meta = { title: track.title, artist: track.artist }
  navigator.mediaSession.metadata = new MediaMetadata(meta)
  if (track.cover)
    void blobUrl(`cover:${track.id}`, track.cover).then((src) => {
      if (src && loaded === track.id) navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [{ src }] })
    })
}

function syncPosition() {
  if (!('mediaSession' in navigator) || !Number.isFinite(audio.duration)) return
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: Math.min(audio.currentTime, audio.duration),
      playbackRate: audio.playbackRate,
    })
  } catch {
    // Some browsers reject position state while metadata is loading.
  }
}

if ('mediaSession' in navigator) {
  // No seekbackward/seekforward: on iOS they replace the previous/next buttons on the lock screen.
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => play()],
    ['pause', () => audio.pause()],
    ['previoustrack', () => previous()],
    ['nexttrack', () => next()],
    ['seekto', (details) => details.seekTime !== undefined && seek(details.seekTime)],
  ]
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Action not supported here.
    }
  }
}
