import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatTime } from '../lib/format.ts'
import {
  cycleRepeat,
  next,
  previous,
  scan,
  seek,
  setVolume,
  toggle,
  toggleShuffle,
  usePlayer,
  useTime,
  volumeLocked,
} from '../lib/player.ts'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import '../styles/player.css'

type Size = 'compact' | 'full'

const pct = (value: number, max: number): CSSProperties => ({ '--p': `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }) as CSSProperties

/** Play and pause stacked in one button; they swap with a small scale and fade. */
export function PlayButton({ size = 'compact' }: { size?: Size }) {
  const playing = usePlayer((s) => s.playing)
  const icon = size === 'full' ? 46 : 18
  return (
    <button type="button" className={`play-btn ${size}${playing ? ' playing' : ''}`} aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
      <span className="swap play">
        <Icon name="play" size={icon} />
      </span>
      <span className="swap pause">
        <Icon name="pause" size={icon} />
      </span>
    </button>
  )
}

/** Previous / next. A tap skips; holding scans through the song until release. */
export function SkipButton({ dir, size = 22 }: { dir: 1 | -1; size?: number }) {
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; stop?: () => void; held: boolean }>({ held: false })
  const end = () => {
    clearTimeout(hold.current.timer)
    hold.current.stop?.()
    hold.current.stop = undefined
  }
  useEffect(() => end, [])
  return (
    <button
      type="button"
      className="skip-btn"
      aria-label={dir > 0 ? 'Next' : 'Previous'}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        end()
        hold.current.held = false
        hold.current.timer = setTimeout(() => {
          hold.current.held = true
          hold.current.stop = scan(dir)
        }, 380)
      }}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (hold.current.held) return void (hold.current.held = false)
        if (dir > 0) next()
        else previous()
      }}
    >
      <Icon name={dir > 0 ? 'next' : 'previous'} size={size} />
    </button>
  )
}

/** Shuffle, previous, play/pause, next, repeat. */
export function Transport({ size = 'compact' }: { size?: Size }) {
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const full = size === 'full'
  return (
    <div className={`transport ${size}`}>
      <IconButton icon="shuffle" label="Shuffle" active={shuffle} onClick={toggleShuffle} size={full ? 22 : 18} className="mode" />
      <SkipButton dir={-1} size={full ? 36 : 20} />
      <PlayButton size={size} />
      <SkipButton dir={1} size={full ? 36 : 20} />
      <IconButton
        icon={repeat === 'one' ? 'repeat-one' : 'repeat'}
        label="Repeat"
        active={repeat !== 'off'}
        onClick={cycleRepeat}
        size={full ? 22 : 18}
        className="mode"
      />
    </div>
  )
}

/** Thin seek bar with elapsed and remaining time. Seeks on release; the keyboard seeks straight away. */
export function Scrubber({ className = '' }: { className?: string }) {
  const { time, duration } = useTime()
  const [drag, setDragState] = useState<number | null>(null)
  const pointer = useRef<number | null>(null) // the drag value while a pointer holds the bar
  const setDrag = (v: number | null) => {
    pointer.current = v
    setDragState(v)
  }
  const value = drag ?? Math.min(time, duration)
  const commit = () => {
    if (pointer.current === null) return
    seek(pointer.current)
    setDrag(null)
  }
  return (
    <div className={`scrubber ${className}${drag !== null ? ' dragging' : ''}`}>
      <span className="time">{formatTime(value)}</span>
      <input
        type="range"
        className="range"
        aria-label="Position"
        min={0}
        max={duration || 1}
        step="any"
        value={value}
        disabled={!duration}
        style={pct(value, duration)}
        onPointerDown={() => setDrag(value)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onLostPointerCapture={commit}
        onBlur={commit}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (pointer.current !== null) setDrag(v)
          else seek(v)
        }}
      />
      <span className="time">-{formatTime(duration - value)}</span>
    </div>
  )
}

/** Volume slider with speaker icons. Nothing on iOS, where volume is hardware-only. */
export function Volume({ className = '', icons = 'both' }: { className?: string; icons?: 'both' | 'low' }) {
  const volume = usePlayer((s) => s.volume)
  if (volumeLocked) return null
  return (
    <div className={`volume ${className}`}>
      <button type="button" className="vol-icon" aria-label={volume > 0 ? 'Mute' : 'Full volume'} onClick={() => setVolume(volume > 0 ? 0 : 1)}>
        <Icon name="volume-low" size={18} />
      </button>
      <input
        type="range"
        className="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        style={pct(volume, 1)}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
      {icons === 'both' && (
        <button type="button" className="vol-icon" aria-label="Full volume" onClick={() => setVolume(1)}>
          <Icon name="volume-high" size={18} />
        </button>
      )}
    </div>
  )
}
