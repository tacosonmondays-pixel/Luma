import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { markShown, useBadges } from '../lib/stats.ts'
import { badgeGlyphs } from './badgeGlyphs.ts'
import type { Badge, BadgeId } from '../types.ts'
import '../styles/badges.css'

const SHINE_MS = 1000 // the shine is 900 ms; store the tier once it has played
const TIP_MS = 1600

/** The earned badges as medallions. Tapping one shows its name. */
export function BadgeRow({ size, badges: given }: { size: 'card' | 'small'; badges?: Badge[] }) {
  const own = useBadges()
  const badges = given ?? own
  const [open, setOpen] = useState<BadgeId>()

  // New tiers shine once, then are stored so they stay (and don't shine again).
  const fresh = given ? [] : badges.filter((b) => b.fresh)
  const freshKey = fresh.map((b) => `${b.id}:${b.tier}`).join()
  useEffect(() => {
    if (!fresh.length) return
    const timer = setTimeout(() => void markShown(fresh), SHINE_MS)
    return () => clearTimeout(timer)
  }, [freshKey])

  // The name hides after a moment, or on any tap elsewhere.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(undefined), TIP_MS)
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(`[data-badge="${open}"]`))) setOpen(undefined)
    }
    document.addEventListener('pointerdown', away, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', away, true)
    }
  }, [open])

  if (!badges.length) return null
  return (
    <div className={`badges badges-${size}`}>
      {badges.map((b) => (
        <Medallion key={b.id} badge={b} open={open === b.id} onTap={() => setOpen(open === b.id ? undefined : b.id)} />
      ))}
    </div>
  )
}

const tierClass = ['', 'bronze', 'silver', 'gold', 'holo']

function Medallion({ badge, open, onTap }: { badge: Badge; open: boolean; onTap: () => void }) {
  return (
    <span className="badge-slot" data-badge={badge.id}>
      <button
        type="button"
        className={`badge ${tierClass[badge.tier]}${badge.fresh ? ' fresh' : ''}`}
        aria-label={badge.name}
        aria-expanded={open}
        onClick={onTap}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={badgeGlyphs[badge.id]} />
        </svg>
      </button>
      {open && <Tip name={badge.name} />}
    </span>
  )
}

/** The name bubble above a badge, kept inside the card (or the window) it sits in. */
function Tip({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const tip = ref.current
    if (!tip) return
    const box = tip.getBoundingClientRect()
    const bounds = tip.closest('.pc')?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }
    const margin = 8
    const shift = Math.max(0, bounds.left + margin - box.left) - Math.max(0, box.right - (bounds.right - margin))
    tip.style.setProperty('--shift', `${shift}px`)
  }, [name])
  return (
    <span ref={ref} className="badge-tip" role="status">
      {name}
    </span>
  )
}
