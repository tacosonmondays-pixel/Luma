// The avatar frame: a box 1.2× the avatar over it, ignoring taps. Motion is whole elements turning or fading;
// the SVG frames with moving parts (equalizer, sparkles) run only while `live`.
import { useId, type ReactNode } from 'react'
import { usePlayer } from '../../lib/player.ts'
import type { FrameId } from '../../types.ts'
import { BLOSSOM_BRANCHES, BLOSSOMS, EQ_BARS, LAUREL, LEAF, PETALS, SPARKLES, STAR } from './frames.ts'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="fr-svg" viewBox="0 0 120 120" aria-hidden="true">
      {children}
    </svg>
  )
}

function Equalizer() {
  const id = useId()
  return (
    <Svg>
      <defs>
        <linearGradient id={`${id}eq`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pc-accent-2)" />
          <stop offset="1" stopColor="var(--pc-accent)" />
        </linearGradient>
      </defs>
      {EQ_BARS.map((bar) => (
        <g key={bar.deg} transform={`rotate(${bar.deg} 60 60)`}>
          <rect className="eq-bar" x="59.1" y="1.5" width="1.8" height="7" rx="0.9" fill={bar.alt ? `url(#${id}eq)` : 'var(--pc-accent)'} style={{ animationDelay: `${bar.delay}s` }} />
        </g>
      ))}
    </Svg>
  )
}

function Laurel() {
  const id = useId()
  return (
    <Svg>
      <defs>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.45" stopColor="#e9b949" />
          <stop offset="1" stopColor="#a8741a" />
        </linearGradient>
      </defs>
      {LAUREL.stems.map((d) => (
        <path key={d} d={d} fill="none" stroke="#c9952c" strokeWidth="1" strokeLinecap="round" />
      ))}
      {LAUREL.leaves.map((leaf, i) => (
        <path key={i} d={LEAF} fill={`url(#${id}gold)`} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotate})`} />
      ))}
    </Svg>
  )
}

function Blossoms() {
  return (
    <div className="fr-sway">
      <Svg>
        {BLOSSOM_BRANCHES.map((d) => (
          <path key={d} d={d} fill="none" stroke="#6b4a3a" strokeWidth="1.4" strokeLinecap="round" />
        ))}
        {BLOSSOMS.map((b, i) => (
          <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.rotate}) scale(${b.size})`}>
            {PETALS.map((deg) => (
              <ellipse key={deg} cx="0" cy="-2.3" rx="1.9" ry="2.5" fill="#ffc9dc" stroke="#ff9fc2" strokeWidth="0.35" transform={`rotate(${deg})`} />
            ))}
            <circle r="1.1" fill="#ffd36e" />
          </g>
        ))}
      </Svg>
    </div>
  )
}

function Sparkles() {
  return (
    <Svg>
      <circle cx="60" cy="60" r="55" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.6" />
      {SPARKLES.map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y}) scale(${s.size})`}>
          <path className="sp-star" d={STAR} fill={i % 3 ? '#fff' : 'var(--pc-accent)'} style={{ animationDelay: `${s.delay}s` }} />
        </g>
      ))}
    </Svg>
  )
}

function Parts({ id }: { id: FrameId }) {
  switch (id) {
    case 'halo':
      return <i className="fr-ring fr-halo" />
    case 'aurora':
      return (
        <>
          <i className="fr-aurora-glow" />
          <i className="fr-ring fr-aurora" />
        </>
      )
    case 'vinyl':
      return <i className="fr-ring fr-vinyl" />
    case 'orbit':
      return (
        <>
          <i className="fr-ring fr-track" />
          <i className="fr-orbit">
            <i className="fr-ring fr-tail" />
            <i className="fr-dot" />
          </i>
        </>
      )
    case 'equalizer':
      return <Equalizer />
    case 'laurel':
      return <Laurel />
    case 'blossoms':
      return <Blossoms />
    case 'sparkles':
      return <Sparkles />
  }
}

export function Frame({ id, live }: { id?: FrameId; live: boolean }) {
  const playing = usePlayer((s) => s.playing)
  if (!id) return null
  return (
    <span className={`frame fr-${id}-box`} data-playing={playing || undefined} data-still={live ? undefined : ''} aria-hidden="true">
      <Parts id={id} />
    </span>
  )
}
