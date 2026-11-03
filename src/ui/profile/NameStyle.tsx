// The display name in its style. Each style plays briefly when it appears, then rests on its still look;
// `rest` skips straight to that (editor chips, the sidebar nameplate).
import type { CSSProperties } from 'react'
import { NAME_STYLE_IDS, type NameStyleId } from '../../types.ts'

export const NAME_STYLES: NameStyleId[] = [...NAME_STYLE_IDS]

/** Letters (grapheme clusters where the browser can split them), for the wave. */
function letters(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) return [...new Intl.Segmenter().segment(text)].map((s) => s.segment)
  return Array.from(text)
}

const SPARKS = [
  { left: '6%', top: '18%', delay: 0 },
  { left: '38%', top: '-4%', delay: 0.35 },
  { left: '66%', top: '46%', delay: 0.7 },
  { left: '94%', top: '6%', delay: 1.05 },
]

export function NameStyle({ name, style, rest, className = '' }: { name: string; style?: NameStyleId; rest?: boolean; className?: string }) {
  const cls = `ns${style ? ` ns-${style}` : ''}${rest ? ' ns-rest' : ''} ${className}`
  if (style === 'wave') {
    const parts = letters(name)
    return (
      <span className={cls} aria-label={name}>
        {parts.slice(0, 48).map((ch, i) => (
          <span key={i} aria-hidden="true" style={{ '--i': i } as CSSProperties}>
            {ch}
          </span>
        ))}
        {parts.length > 48 && <span aria-hidden="true">{parts.slice(48).join('')}</span>}
      </span>
    )
  }
  if (style === 'sparkle')
    return (
      <span className={cls}>
        <span className="ns-text">
          {name}
          {SPARKS.map((s, i) => (
            <i key={i} className="ns-spark" aria-hidden="true" style={{ left: s.left, top: s.top, animationDelay: `${s.delay}s` }} />
          ))}
        </span>
      </span>
    )
  return (
    <span className={cls} data-text={name}>
      {name}
    </span>
  )
}
