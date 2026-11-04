// Badge glyphs: 24×24, 2px round strokes, the same grid as Icon.tsx. Each is one path `d`;
// upstream <circle>s are written as two arcs.
//
// Lucide 1.67.0 (lucide-static), ISC, Copyright (c) 2026 Lucide Icons and Contributors.
// `headphones` and `compass` are derived from Feather, MIT, Copyright (c) 2013-present Cole Bemis.
// Tabler Icons 3.50.0 (`vinyl`), MIT, Copyright (c) 2020-2026 Paweł Kuna.
// Full texts: licenses/lucide.txt, licenses/tabler-icons.txt.

import type { BadgeId } from '../types.ts'

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const badgeGlyphs: Record<BadgeId, string> = {
  // Lucide disc-3
  'first-spin': `${circle(12, 12, 10)}M6 12c0-1.7.7-3.2 1.8-4.2${circle(12, 12, 2)}M18 12c0 1.7-.7 3.2-1.8 4.2`,
  // Lucide headphones (Feather)
  hours: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  // Lucide flame
  streak: 'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
  // Lucide repeat-1
  'on-repeat': 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4',
  // Lucide moon-star
  'night-owl':
    'M18 5h4M20 3v4M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401',
  // Lucide sunrise
  'early-bird': 'M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0',
  // Lucide hourglass
  marathon:
    'M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
  // Lucide compass (Feather)
  explorer: `${circle(12, 12, 10)}M16.24 7.76l-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z`,
  // Tabler vinyl (outline)
  'crate-digger': 'M16 3.937a9 9 0 1 0 5 8.063M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M19 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M20 4l-3.5 10l-2.5 2',
  // Lucide list-music
  curator: `M16 5H3M11 12H3M11 19H3M21 16V5${circle(18, 16, 3)}`,
  // Lucide sparkles
  founder: `M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4${circle(4, 20, 2)}`,
}
