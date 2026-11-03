import type { MouseEvent } from 'react'
import { next, setOpen, toggle, usePlayer, useCurrentTrack, useTime } from '../lib/player.ts'
import { TrackArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { Scrubber, Transport, Volume } from './Transport.tsx'
import '../styles/player.css'

const open = () => setOpen(true)
const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation()
  fn()
}

function MiniProgress() {
  const { time, duration } = useTime()
  return <span className="mini-progress" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, time / duration) : 0})` }} />
}

/** Mini player on phones, full-width bar on desktop. CSS shows the one that fits. */
export function PlayerBar() {
  const track = useCurrentTrack()
  const playing = usePlayer((s) => s.playing)
  if (!track) return null
  return (
    <>
      <div className="mini" onClick={open}>
        <button type="button" className="mini-info" aria-label="Open Now Playing">
          <TrackArt track={track} size={40} />
          <span className="mini-text">
            <span className="mini-title ellipsis">{track.title}</span>
            <span className="mini-artist ellipsis">{track.artist}</span>
          </span>
        </button>
        <button type="button" className={`mini-btn play-swap${playing ? ' playing' : ''}`} aria-label={playing ? 'Pause' : 'Play'} onClick={stop(toggle)}>
          <span className="swap play">
            <Icon name="play" size={24} />
          </span>
          <span className="swap pause">
            <Icon name="pause" size={24} />
          </span>
        </button>
        <button type="button" className="mini-btn" aria-label="Next" onClick={stop(next)}>
          <Icon name="next" size={26} />
        </button>
        <MiniProgress />
      </div>

      <footer className="bar">
        <button type="button" className="bar-info" aria-label="Open Now Playing" onClick={open}>
          <TrackArt track={track} size={56} />
          <span className="bar-text">
            <span className="bar-title ellipsis">{track.title}</span>
            <span className="bar-artist ellipsis">{track.artist}</span>
          </span>
        </button>
        <div className="bar-center">
          <Transport size="compact" />
          <Scrubber className="bar-scrub" />
        </div>
        <div className="bar-right">
          <Volume className="bar-volume" icons="low" />
          <IconButton icon="expand" label="Open Now Playing" onClick={open} size={18} />
        </div>
      </footer>
    </>
  )
}
