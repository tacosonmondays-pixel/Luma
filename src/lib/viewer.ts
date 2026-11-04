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

/** Show a post. Opening another over it (from Reports) keeps what the music needs on close. */
export function openPost(post: Post): void {
  useViewer.setState({ post })
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
  useViewer.setState({ post: undefined, paused: false })
  if (paused) play()
}
