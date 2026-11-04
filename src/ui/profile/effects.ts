// Profile effects: light particles drawn on one canvas over the card. Our own work.
// Glows come from pre-drawn sprites (no shadowBlur), motion follows elapsed time (so 30 fps on iOS Low Power Mode
// keeps the same speed), the scale is capped at 2×, and it pauses when off screen or hidden.
import { EFFECT_IDS, type EffectId } from '../../types.ts'

export const EFFECTS: EffectId[] = [...EFFECT_IDS]

export interface EffectOptions {
  accent: string // any CSS color
  fps?: number
  duration?: number // ms of play before it fades out over FADE ms; Infinity loops
  still?: boolean // draw one settled frame and stop
}

export interface EffectHandle {
  setPaused(paused: boolean): void
  destroy(): void
}

export const FADE = 1200

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vr: number
  phase: number
  speed: number
  age: number
  life: number
  tint: number
}

interface World {
  w: number
  h: number
  t: number
  rand: () => number
  sprite: (color: string) => HTMLCanvasElement
  accent: string
}

interface Kind {
  density: number // particles per 100×100 px
  min: number
  max: number
  spawn(p: Particle, world: World, initial: boolean): void
  step(p: Particle, dt: number, world: World): boolean // false: respawn it
  draw(ctx: CanvasRenderingContext2D, p: Particle, world: World): void
  extra?: (ctx: CanvasRenderingContext2D, world: World, dt: number) => void
}

const TAU = Math.PI * 2
const blank = (): Particle => ({ x: 0, y: 0, vx: 0, vy: 0, size: 1, rot: 0, vr: 0, phase: 0, speed: 1, age: 0, life: 1, tint: 0 })
const range = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo)

/** A soft round glow, drawn once per color and reused. */
function makeSprite(color: string): HTMLCanvasElement {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, color)
  g.addColorStop(0.18, color)
  g.addColorStop(0.42, withAlpha(ctx, color, 0.35))
  g.addColorStop(1, withAlpha(ctx, color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return canvas
}

/** Any CSS color at an alpha, by letting the canvas parse it. */
function withAlpha(ctx: CanvasRenderingContext2D, color: string, alpha: number): string {
  ctx.fillStyle = '#000'
  ctx.fillStyle = color
  const parsed = ctx.fillStyle // '#rrggbb' or 'rgba(…)'
  if (parsed.startsWith('#')) {
    const n = parseInt(parsed.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`
  }
  return parsed.replace(/rgba?\(([^)]+)\)/, (_, inner: string) => `rgba(${inner.split(',').slice(0, 3).join(',')},${alpha})`)
}

function glow(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, r: number) {
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)
}

function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    ctx.lineTo(Math.cos(a + TAU / 8) * r * 0.22, Math.sin(a + TAU / 8) * r * 0.22)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Falling things wrap from below the bottom back to above the top. */
function fallSpawn(p: Particle, world: World, initial: boolean, margin: number) {
  p.x = world.rand() * world.w
  p.y = initial ? world.rand() * world.h : -margin - world.rand() * world.h * 0.3
}

const PETAL_COLORS = ['#ffc6da', '#ffb3cd', '#ffd9e6', '#ffa8c6']

const kinds: Record<EffectId, Kind> = {
  petals: {
    density: 0.55,
    min: 10,
    max: 26,
    spawn(p, world, initial) {
      const { rand } = world
      fallSpawn(p, world, initial, 20)
      p.vy = range(rand, 26, 48)
      p.vx = range(rand, 6, 18)
      p.size = range(rand, 5, 9)
      p.rot = rand() * TAU
      p.vr = range(rand, -1.4, 1.4)
      p.phase = rand() * TAU
      p.speed = range(rand, 0.8, 1.6)
      p.tint = Math.floor(rand() * PETAL_COLORS.length)
    },
    step(p, dt, world) {
      p.phase += dt * p.speed
      p.x += (p.vx + Math.sin(p.phase) * 22) * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      if (p.x > world.w + 20) p.x -= world.w + 40
      return p.y < world.h + 20
    },
    draw(ctx, p) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.phase * 1.3))) // the petal turning over
      ctx.fillStyle = PETAL_COLORS[p.tint]
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(0, -p.size)
      ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.6, p.size * 0.7, p.size * 0.7, 0, p.size)
      ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.7, -p.size * 0.9, -p.size * 0.6, 0, -p.size)
      ctx.fill()
      ctx.restore()
    },
  },

  snow: {
    density: 1.2,
    min: 24,
    max: 70,
    spawn(p, world, initial) {
      const { rand } = world
      fallSpawn(p, world, initial, 6)
      p.size = range(rand, 1, 2.8)
      p.vy = 14 + p.size * 12
      p.phase = rand() * TAU
      p.speed = range(rand, 0.4, 1.1)
      p.tint = range(rand, 0.45, 0.95)
    },
    step(p, dt, world) {
      p.phase += dt * p.speed
      p.x += Math.sin(p.phase) * 10 * dt
      p.y += p.vy * dt
      return p.y < world.h + 6
    },
    draw(ctx, p, world) {
      ctx.globalAlpha = p.tint
      glow(ctx, world.sprite('#ffffff'), p.x, p.y, p.size * 2.6)
    },
  },

  sparkles: {
    density: 0.4,
    min: 8,
    max: 20,
    spawn(p, world, initial) {
      const { rand } = world
      p.x = rand() * world.w
      p.y = rand() * world.h
      p.life = range(rand, 1.2, 2.2)
      p.age = initial ? rand() * p.life : -rand() * 0.8
      p.size = range(rand, 4, 9)
      p.rot = rand() * TAU
      p.vr = range(rand, -0.6, 0.6)
      p.tint = rand() < 0.5 ? 1 : 0
    },
    step(p, dt) {
      p.age += dt
      p.rot += p.vr * dt
      return p.age < p.life
    },
    draw(ctx, p, world) {
      if (p.age < 0) return
      const k = Math.sin((p.age / p.life) * Math.PI)
      const color = p.tint ? world.accent : '#ffffff'
      ctx.globalAlpha = k * 0.55
      glow(ctx, world.sprite(color), p.x, p.y, p.size * 1.6 * k)
      ctx.globalAlpha = k
      ctx.fillStyle = '#ffffff'
      star4(ctx, p.x, p.y, p.size * k, p.rot)
    },
  },

  stars: {
    density: 1,
    min: 24,
    max: 60,
    spawn(p, world) {
      const { rand } = world
      p.x = rand() * world.w
      p.y = rand() * world.h
      p.size = range(rand, 0.6, 1.6)
      p.phase = rand() * TAU
      p.speed = range(rand, 1, 2.6)
    },
    step(p, dt) {
      p.phase += dt * p.speed
      return true
    },
    draw(ctx, p, world) {
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase))
      glow(ctx, world.sprite('#ffffff'), p.x, p.y, p.size * 3)
    },
    // A shooting star every few seconds.
    extra: (() => {
      let next = 0.6
      let shot: { x: number; y: number; age: number } | undefined
      return (ctx, world, dt) => {
        next -= dt
        if (!shot && next <= 0) {
          shot = { x: world.rand() * world.w * 0.7, y: world.rand() * world.h * 0.4, age: 0 }
          next = range(world.rand, 2.2, 3.6)
        }
        if (!shot) return
        shot.age += dt
        const life = 0.9
        if (shot.age > life) return void (shot = undefined)
        const k = shot.age / life
        const len = Math.min(world.w, 360) * 0.45
        const x = shot.x + k * len * 1.4
        const y = shot.y + k * len * 0.7
        const g = ctx.createLinearGradient(x, y, x - len * 0.5, y - len * 0.25)
        g.addColorStop(0, 'rgba(255,255,255,0.95)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.globalAlpha = Math.sin(k * Math.PI)
        ctx.strokeStyle = g
        ctx.lineWidth = 1.4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - len * 0.5, y - len * 0.25)
        ctx.stroke()
        glow(ctx, world.sprite('#ffffff'), x, y, 5)
      }
    })(),
  },

  notes: {
    density: 0.22,
    min: 6,
    max: 14,
    spawn(p, world, initial) {
      const { rand } = world
      p.x = rand() * world.w
      p.y = initial ? rand() * world.h : world.h + 20 + rand() * world.h * 0.3
      p.vy = -range(rand, 22, 40)
      p.size = range(rand, 9, 15)
      p.phase = rand() * TAU
      p.speed = range(rand, 0.6, 1.2)
      p.rot = range(rand, -0.3, 0.3)
      p.tint = Math.floor(rand() * 3)
    },
    step(p, dt) {
      p.phase += dt * p.speed
      p.x += Math.sin(p.phase) * 14 * dt
      p.y += p.vy * dt
      return p.y > -24
    },
    draw(ctx, p, world) {
      const fade = Math.min(1, p.y / (world.h * 0.25), (world.h - p.y) / (world.h * 0.2) + 0.2)
      ctx.globalAlpha = Math.max(0, fade) * 0.9
      ctx.fillStyle = p.tint === 0 ? world.accent : '#ffffff'
      ctx.strokeStyle = ctx.fillStyle
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot + Math.sin(p.phase) * 0.12)
      const s = p.size / 12
      ctx.scale(s, s)
      ctx.lineWidth = 1.8
      ctx.lineCap = 'round'
      const head = (x: number, y: number) => {
        ctx.beginPath()
        ctx.ellipse(x, y, 3.6, 2.6, -0.45, 0, TAU)
        ctx.fill()
      }
      if (p.tint === 2) {
        // two beamed notes
        head(-5, 6)
        head(5, 4)
        ctx.beginPath()
        ctx.moveTo(-1.8, 5.4)
        ctx.lineTo(-1.8, -8)
        ctx.lineTo(8.2, -10)
        ctx.lineTo(8.2, 3.4)
        ctx.stroke()
      } else {
        head(0, 6)
        ctx.beginPath()
        ctx.moveTo(3.2, 5.2)
        ctx.lineTo(3.2, -9)
        ctx.quadraticCurveTo(4, -4, 9, -2)
        ctx.stroke()
      }
      ctx.restore()
    },
  },

  fireflies: {
    density: 0.35,
    min: 8,
    max: 22,
    spawn(p, world) {
      const { rand } = world
      p.x = rand() * world.w
      p.y = rand() * world.h
      p.rot = rand() * TAU // heading
      p.speed = range(rand, 10, 22)
      p.phase = rand() * TAU
      p.size = range(rand, 1.6, 2.8)
      p.tint = rand() < 0.35 ? 1 : 0
    },
    step(p, dt, world) {
      p.phase += dt * 1.6
      p.rot += Math.sin(p.phase * 0.7 + p.size) * dt * 1.4
      p.x += Math.cos(p.rot) * p.speed * dt
      p.y += Math.sin(p.rot) * p.speed * dt
      if (p.x < -10) p.x = world.w + 10
      if (p.x > world.w + 10) p.x = -10
      if (p.y < -10) p.y = world.h + 10
      if (p.y > world.h + 10) p.y = -10
      return true
    },
    draw(ctx, p, world) {
      const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(p.phase))
      ctx.globalAlpha = pulse
      glow(ctx, world.sprite(p.tint ? world.accent : '#ffe680'), p.x, p.y, p.size * 5)
      ctx.globalAlpha = Math.min(1, pulse * 1.3)
      glow(ctx, world.sprite('#fffbe0'), p.x, p.y, p.size * 1.4)
    },
  },
}

/** Starts an effect on a canvas that fills its parent. */
export function mountEffect(canvas: HTMLCanvasElement, id: EffectId, options: EffectOptions): EffectHandle {
  const kind = Object.hasOwn(kinds, id) ? kinds[id] : undefined
  if (!kind) return { setPaused() {}, destroy() {} } // an id this version doesn't know draws nothing
  const ctx = canvas.getContext('2d')
  const fps = options.fps ?? 60
  const duration = options.duration ?? Infinity
  let seed = 1234567
  const sprites = new Map<string, HTMLCanvasElement>()
  const world: World = {
    w: 0,
    h: 0,
    t: 0,
    accent: options.accent,
    rand: () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    },
    sprite: (color) => {
      let sprite = sprites.get(color)
      if (!sprite) sprites.set(color, (sprite = makeSprite(color)))
      return sprite
    },
  }
  let particles: Particle[] = []
  let frame = 0
  let last = 0
  let played = 0 // ms of play so far
  let paused = false
  let hidden = document.visibilityState === 'hidden'
  let offscreen = false
  let done = false

  const populate = () => {
    const n = Math.round(Math.min(kind.max, Math.max(kind.min, ((world.w * world.h) / 10000) * kind.density)))
    particles = Array.from({ length: n }, () => {
      const p = blank()
      kind.spawn(p, world, true)
      return p
    })
  }

  const resize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h || (w === world.w && h === world.h)) return
    const scale = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    ctx?.setTransform(scale, 0, 0, scale, 0, 0)
    const first = !world.w
    world.w = w
    world.h = h
    if (first || particles.length === 0) populate()
    if (options.still) settle()
  }

  const step = (dt: number) => {
    world.t += dt
    for (const p of particles) {
      if (kind.step(p, dt, world)) continue
      Object.assign(p, blank())
      kind.spawn(p, world, false)
    }
  }

  const draw = (alpha: number, dt: number) => {
    if (!ctx) return
    ctx.clearRect(0, 0, world.w, world.h)
    for (const p of particles) {
      kind.draw(ctx, p, world)
      ctx.globalAlpha = 1
    }
    kind.extra?.(ctx, world, dt)
    if (alpha < 1) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.globalAlpha = alpha
      ctx.fillRect(0, 0, world.w, world.h)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = 1
  }

  /** One frame that looks like the effect in full flow. */
  function settle() {
    for (let i = 0; i < 90; i++) step(1 / 30)
    draw(1, 0)
  }

  const running = () => !done && !paused && !hidden && !offscreen && !options.still

  const tick = (now: number) => {
    frame = 0
    if (!running()) return
    frame = requestAnimationFrame(tick)
    const elapsed = last ? now - last : 0
    if (elapsed && elapsed < 1000 / fps - 2) return // hold to the frame rate
    last = now
    const dt = Math.min(elapsed, 100) / 1000
    played += elapsed
    step(dt)
    const left = duration + FADE - played
    if (left <= 0) {
      done = true
      ctx?.clearRect(0, 0, world.w, world.h)
      cancelAnimationFrame(frame)
      frame = 0
      return
    }
    draw(Math.min(1, left / FADE), dt)
  }

  const update = () => {
    if (running() && !frame) {
      last = 0
      frame = requestAnimationFrame(tick)
    } else if (!running() && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }

  const sizes = new ResizeObserver(resize)
  sizes.observe(canvas)
  const seen = new IntersectionObserver(([entry]) => {
    offscreen = !entry.isIntersecting
    update()
  })
  seen.observe(canvas)
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden'
    update()
  }
  document.addEventListener('visibilitychange', onVisibility)
  resize()
  update()

  return {
    setPaused(next) {
      paused = next
      update()
    },
    destroy() {
      done = true
      if (frame) cancelAnimationFrame(frame)
      sizes.disconnect()
      seen.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
