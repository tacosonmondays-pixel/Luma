// The Y2K theme's green LCD: a marquee title, a time readout and decorative equalizer bars.
// Nothing here listens to the audio: Luma never routes playback through Web Audio (it stops on the iPhone
// lock screen), so the bars are a CSS loop that runs while a song plays and the display is on screen.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useAppearance } from '../../lib/appearance.ts'
import { formatTime } from '../../lib/format.ts'
import { useTime } from '../../lib/player.ts'

export const useY2K = () => useAppearance((s) => s.theme === 'y2k')

/** The title on one line. Short titles sit still; long ones scroll in a loop while `run` is on. */
export function Marquee({ text, run, className = '' }: { text: string; run: boolean; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const t = el.querySelector('.y2k-t') as HTMLElement | null
      if (t) setFits(t.offsetWidth <= el.clientWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    void document.fonts?.ready.then(measure) // VT323 is narrower than the fallback
    return () => observer.disconnect()
  }, [text])
  const style = { '--dur': `${Math.max(9, text.length * 0.42)}s` } as CSSProperties
  return (
    <span ref={box} className={`y2k-marquee ${className}${fits ? ' fits' : ''}${run ? ' run' : ''}`} aria-hidden="true">
      <span className="y2k-mq" style={style}>
        <span className="y2k-copy">
          <span className="y2k-t">{text}</span>
        </span>
        {!fits && (
          <span className="y2k-copy">
            <span className="y2k-t">{text}</span>
          </span>
        )}
      </span>
    </span>
  )
}

/** Segmented LED columns. Each column is a fixed lit gradient with a dark cover sliding over it (transform only). */
export function Equalizer({ bars, run, className = '' }: { bars: number; run: boolean; className?: string }) {
  return (
    <span className={`y2k-eq ${className}${run ? ' run' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <i key={i}>
          <b />
        </i>
      ))}
    </span>
  )
}

let showRemaining = false // shared by every readout, kept while the app runs

/** Elapsed time; a tap switches to the time left. Redraws only while `active` (the display is on screen). */
export function LcdTime({ active }: { active: boolean }) {
  const { time, duration } = useTime(active)
  const [remaining, setRemaining] = useState(showRemaining)
  const left = Math.max(0, duration - time)
  return (
    <button
      type="button"
      className="y2k-time"
      aria-label={remaining ? 'Show elapsed time' : 'Show remaining time'}
      onClick={() => setRemaining((showRemaining = !remaining))}
    >
      {remaining ? `-${formatTime(left)}` : formatTime(Math.min(time, duration || time))}
    </button>
  )
}
