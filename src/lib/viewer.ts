// The Viewer: one post, full screen, with no route (like Now Playing). Its videos play muted and never touch the music
// or the Media Session. Unmuting pauses the music first, and closing the Viewer resumes it, inside that same tap,
// so iOS lets it play again.

import { create } from 'zustand'
import { audio, pause, play } from './player.ts'
import type { Post } from './social.ts'

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
