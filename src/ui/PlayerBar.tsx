import { useSyncExternalStore, type MouseEvent } from 'react'
import { next, setOpen, toggle, usePlayer, useCurrentTrack, useTime } from '../lib/player.ts'
import { TrackArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { Scrubber, Transport, Volume } from './Transport.tsx'
import { Marquee, useY2K } from './y2k/Lcd.tsx'
import { ThemeDecor } from './y2k/ThemeDecor.tsx'
import '../styles/player.css'

const open = () => setOpen(true)
const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation()
  fn()
}

// Same breakpoint as player.css.
const desktop = matchMedia('(min-width: 900px)')
const onResize = (change: () => void) => {
  desktop.addEventListener('change', change)
  return () => desktop.removeEventListener('change', change)
}
const useDesktop = () => useSyncExternalStore(onResize, () => desktop.matches)

function MiniProgress({ active }: { active: boolean }) {
  const { time, duration } = useTime(active)
  return <span className="mini-progress" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, time / duration) : 0})` }} />
}

/** Mini player on phones, full-width bar on desktop. Only the one that fits is rendered, and its progress
 * stops redrawing every frame while Now Playing covers it. */
export function PlayerBar() {
  const track = useCurrentTrack()
  const playing = usePlayer((s) => s.playing)
  const covered = usePlayer((s) => s.open)
  const wide = useDesktop()
  const y2k = useY2K() // the Y2K theme swaps the title and artist for its green LCD
  if (!track) return null

  if (wide)
    return (
      <footer className="bar">
        <button type="button" className="bar-info" aria-label="Open Now Playing" onClick={open}>
          <TrackArt track={track} size={56} />
          {y2k ? (
            <ThemeDecor place="bar" />
          ) : (
            <span className="bar-text">
              <span className="bar-title ellipsis">{track.title}</span>
              <span className="bar-artist ellipsis">{track.artist}</span>
            </span>
          )}
        </button>
        <div className="bar-center">
          <Transport size="compact" />
          <Scrubber className="bar-scrub" active={!covered} />
        </div>
        <div className="bar-right">
          <Volume className="bar-volume" icons="low" />
          <IconButton icon="expand" label="Open Now Playing" onClick={open} size={18} />
        </div>
      </footer>
    )

  return (
    <div className="mini" onClick={open}>
      <button type="button" className="mini-info" aria-label="Open Now Playing">
        <TrackArt track={track} size={40} />
        {y2k ? (
          <span className={`y2k-lcd y2k-mini-lcd${playing ? '' : ' paused'}`}>
            <Marquee text={track.title} run={playing && !covered} className="y2k-title" />
            <span className="y2k-artist ellipsis">{track.artist}</span>
            <MiniProgress active={!covered} />
          </span>
        ) : (
          <span className="mini-text">
            <span className="mini-title ellipsis">{track.title}</span>
            <span className="mini-artist ellipsis">{track.artist}</span>
          </span>
        )}
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
      {!y2k && <MiniProgress active={!covered} />}
    </div>
  )
}
