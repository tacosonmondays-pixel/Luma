// The Viewer: one post, full screen, with no route (like Now Playing). Its videos play muted and never touch the music
// or the Media Session. Unmuting pauses the music first, and closing the Viewer resumes it, inside that same tap,
// so iOS lets it play again.

import { create } from 'zustand'
import { LIMITS } from './media.ts'
import { audio, pause, play } from './player.ts'
import type { Post } from './social.ts'

/** The longest video the Viewer plays: the uploader's cap (media.ts). */
export const MAX_SECONDS = LIMITS.video.video!.seconds + 0.25

/** Whether the Viewer plays a video, from its metadata, or from how far it has played (a header can understate
 * its length). A file put up around the app, with no picture (a song) or longer than the cap, never plays: no song
 * audio comes from the server. */
export function playable(video: { videoWidth: number; videoHeight: number; duration: number; currentTime?: number }): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0 && video.duration <= MAX_SECONDS && !((video.currentTime ?? 0) > MAX_SECONDS)
}

interface Viewer {
  post?: Post
  /** The Viewer paused the music: closing it plays again. */
  paused?: boolean
}

export const useViewer = create<Viewer>()(() => ({}))

/** What had focus when the Viewer opened. It is read here, in the tap, because the page behind turns inert as soon as
 * the Viewer shows, and that drops the focus before the Viewer mounts. */
let opener: HTMLElement | null = null

/** Show a post. Opening another over it (from Reports) keeps what the music needs on close, and the first opener. */
export function openPost(post: Post): void {
  if (!useViewer.getState().post) {
    const active = typeof HTMLElement === 'undefined' ? null : document.activeElement
    opener = active && active instanceof HTMLElement && active !== document.body ? active : null
  }
  useViewer.setState({ post })
}

/** The element to focus again once the Viewer closes. It stays set until the Viewer closes, since a Viewer can mount
 * more than once while it shows (React's development checks, or another post opened over it). */
export function viewerOpener(): HTMLElement | null {
  return opener
}

/** A video is about to play with sound: pause the music, if it plays, and resume it on close. */
export function pauseForSound(): void {
  if (audio.paused) return
  pause()
  useViewer.setState({ paused: true })
}

/** Close the Viewer. Call it from the tap itself: resuming the music needs one on iOS. */
export function closePost(): void {
  const { paused } = useViewer.getState()
  opener = null
  useViewer.setState({ post: undefined, paused: false })
  if (paused) play()
}
