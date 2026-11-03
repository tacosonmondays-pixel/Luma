// The effect canvas over the whole card, ignoring taps. One plays at a time.
import { useEffect, useRef } from 'react'
import type { EffectId } from '../../types.ts'
import { mountEffect, type EffectHandle } from './effects.ts'

const coarse = () => matchMedia('(pointer: coarse)').matches

/**
 * `duration` in ms (the You page plays it 8 s, then it fades); omit it to loop (the editor preview).
 * `still` draws one frame: thumbnails and reduced motion.
 */
export function Effect({ id, live, duration, still, className = '' }: { id?: EffectId; live: boolean; duration?: number; still?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const handle = useRef<EffectHandle>(undefined)
  const started = useRef(false)

  // Starts the first time it is live (so the page's 8 s begin when the card shows), and never restarts by itself.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !id || (!live && !still) || started.current) return
    started.current = true
    canvas.style.color = 'var(--pc-accent, var(--accent))'
    const accent = getComputedStyle(canvas).color || '#ffffff'
    handle.current = mountEffect(canvas, id, { accent, fps: coarse() ? 30 : 60, duration, still })
  }, [id, live, duration, still])

  useEffect(() => handle.current?.setPaused(!live && !still), [live, still])

  useEffect(
    () => () => {
      handle.current?.destroy()
      handle.current = undefined
      started.current = false
    },
    [id],
  )

  if (!id) return null
  return <canvas ref={ref} className={`effect ${className}`} aria-hidden="true" />
}
