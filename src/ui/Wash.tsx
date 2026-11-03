import { useEffect, useRef, useState } from 'react'
import { gradientFor } from '../lib/format.ts'
import { useCoverLook, type CoverLook } from '../lib/palette.ts'
import type { Version } from '../types.ts'
import '../styles/wash.css'

interface WashProps {
  blobKey: string
  v: Version
  seed: string // picks the gradient when there is no cover
  className?: string
  still?: boolean // one still copy (playlist headers)
  active?: boolean // moving: runs only while true (Now Playing is open)
  playing?: boolean // moving: drifts at full speed while playing, slowly while paused
}

interface Scene {
  id: number
  look?: CoverLook
  fill?: string
}

const reduce = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-reduced-motion: reduce)')

/** The moving copies: one fills the screen and turns slowly, three float over it at their own pace. Sizes in
 * vmax, positions in % of the screen. Only their transforms change, so nothing repaints per frame. */
const LAYERS = [
  { size: 170, x: 50, y: 50, period: 150, dir: 1, orbit: 0, opacity: 1 },
  { size: 118, x: 18, y: 22, period: 64, dir: -1, orbit: 9, opacity: 0.95 },
  { size: 124, x: 84, y: 78, period: 82, dir: 1, orbit: 11, opacity: 0.95 },
  { size: 92, x: 62, y: 40, period: 48, dir: -1, orbit: 13, opacity: 0.8 },
]

function keyframes(orbit: number, dir: number): Keyframe[] {
  return Array.from({ length: 25 }, (_, k) => {
    const t = k / 24
    const a = t * Math.PI * 2
    const x = (Math.cos(a) * orbit).toFixed(2)
    const y = (Math.sin(a * dir) * orbit).toFixed(2)
    return { transform: `translate(${x}vmax, ${y}vmax) rotate(${(t * 360 * dir).toFixed(1)}deg)` }
  })
}

const SLOW = 0.18 // drift speed while paused

function MovingScene({ scene, active, playing, onShown }: { scene: Scene; active: boolean; playing: boolean; onShown: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const anims = useRef<Animation[]>([])
  const rate = useRef(playing ? 1 : SLOW)

  useEffect(() => {
    const imgs = [...(host.current?.querySelectorAll('img') ?? [])]
    if (reduce?.matches) {
      imgs.forEach((img, i) => (img.style.transform = `rotate(${(i * 97) % 360}deg)`))
      return
    }
    anims.current = imgs.map((img, i) => {
      const L = LAYERS[i]
      const a = img.animate(keyframes(L.orbit, L.dir), { duration: L.period * 1000, iterations: Infinity })
      a.currentTime = ((i * 0.37 + 0.11) % 1) * L.period * 1000
      a.playbackRate = rate.current
      a.pause()
      return a
    })
    return () => anims.current.forEach((a) => a.cancel())
  }, [])

  useEffect(() => {
    const list = anims.current
    if (!active) {
      list.forEach((a) => a.pause())
      return
    }
    list.forEach((a) => a.play())
    // Ease the drift speed instead of jumping, like a record slowing down.
    const from = rate.current
    const to = playing ? 1 : SLOW
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1400)
      rate.current = from + (to - from) * (1 - (1 - k) ** 3)
      list.forEach((a) => (a.playbackRate = rate.current))
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [active, playing])

  const urls = scene.look ? [scene.look.wash, ...scene.look.spots] : []
  return (
    <div ref={host} className="wash-scene" onAnimationEnd={(e) => e.target === e.currentTarget && onShown()}>
      {scene.fill ? (
        <div className="wash-fill" style={{ background: scene.fill }} />
      ) : (
        urls.map((url, i) => {
          const L = LAYERS[i]
          const style = { left: `${L.x}%`, top: `${L.y}%`, width: `${L.size}vmax`, height: `${L.size}vmax`, margin: `${-L.size / 2}vmax 0 0 ${-L.size / 2}vmax`, opacity: L.opacity }
          return <img key={i} src={url} alt="" draggable={false} style={style} />
        })
      )}
    </div>
  )
}

function StillScene({ scene, onShown }: { scene: Scene; onShown: () => void }) {
  return (
    <div className="wash-scene" onAnimationEnd={(e) => e.target === e.currentTarget && onShown()}>
      {scene.fill ? <div className="wash-fill" style={{ background: scene.fill }} /> : <img src={scene.look!.wash} alt="" draggable={false} />}
    </div>
  )
}

let ids = 0

/** The softened cover behind Now Playing (moving) and playlist headers (still). A new cover fades in over the
 * old one, which is dropped once the fade ends. */
export function Wash({ blobKey, v, seed, className = '', still, active = true, playing = true }: WashProps) {
  const look = useCoverLook(blobKey, v)
  const [scenes, setScenes] = useState<Scene[]>([])
  const fill = v === undefined ? gradientFor(seed) : undefined

  useEffect(() => {
    if (!fill && !look) return // still loading: keep showing the old one
    setScenes((list) => {
      const top = list[list.length - 1]
      if (top && top.look === look && top.fill === fill) return list
      return [...list.slice(-1), { id: ++ids, look, fill }]
    })
  }, [look, fill])

  const shown = (id: number) => setScenes((list) => list.filter((s) => s.id >= id))

  return (
    <div className={`wash${still ? ' still' : ''} ${className}`} aria-hidden="true">
      {scenes.map((s) =>
        still ? (
          <StillScene key={s.id} scene={s} onShown={() => shown(s.id)} />
        ) : (
          <MovingScene key={s.id} scene={s} active={active} playing={playing} onShown={() => shown(s.id)} />
        ),
      )}
    </div>
  )
}
