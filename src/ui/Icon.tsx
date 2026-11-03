import type { ReactNode } from 'react'

// 24×24 icons. Filled glyphs for transport controls, 2px strokes for everything else.
// pin, unpin (pin-off), crop, film, sparkles, none (ban), tick (check) and share are Lucide paths (ISC, licenses/lucide.txt).
const filled = {
  play: <path d="M7.5 5.1v13.8a1 1 0 0 0 1.53.85l10.9-6.9a1 1 0 0 0 0-1.7L9.03 4.25A1 1 0 0 0 7.5 5.1Z" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4.2" height="15" rx="1.3" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3" />
    </>
  ),
  next: <path d="M2.5 6.6v10.8a1 1 0 0 0 1.55.83L11.5 13.4v4a1 1 0 0 0 1.55.83l8.04-5.4a1 1 0 0 0 0-1.66l-8.04-5.4A1 1 0 0 0 11.5 6.6v4L4.05 5.77A1 1 0 0 0 2.5 6.6Z" />,
  previous: <path d="M21.5 6.6v10.8a1 1 0 0 1-1.55.83L12.5 13.4v4a1 1 0 0 1-1.55.83l-8.04-5.4a1 1 0 0 1 0-1.66l8.04-5.4a1 1 0 0 1 1.55.83v4l7.45-4.83a1 1 0 0 1 1.55.83Z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </>
  ),
} satisfies Record<string, ReactNode>

const stroked = {
  shuffle: (
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4" />
  ),
  repeat: <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />,
  'repeat-one': <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1.2v4.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="m20.5 20.5-4.2-4.2" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  playlists: <path d="M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4.5" />
      <path d="M3.5 21a8.5 8.5 0 0 1 17 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  share: <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  download: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v8.5M8.25 12.5 12 16.25l3.75-3.75" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 12.25 2.5 2.5 4.75-5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5M12 16.5h.01" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    </>
  ),
  offline: <path d="m2 2 20 20M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2M21.5 16.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10 5.1" />,
  'volume-low': <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5ZM16 9a5 5 0 0 1 0 6" />,
  'volume-high': <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5ZM16 9a5 5 0 0 1 0 6M19.4 18.4a9 9 0 0 0 0-12.8" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  'play-next': <path d="M16 12H3M16 18H3M10 6H3M21 18V8a2 2 0 0 0-2-2h-5M16 8l-2-2 2-2" />,
  'add-to-playlist': <path d="M11 12H3M16 6H3M16 18H3M18 9v6M21 12h-6" />,
  remove: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8 12h8" />
    </>
  ),
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  pin: (
    <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  ),
  unpin: (
    <path d="M12 17v5M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89M2 2l20 20M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
  ),
  film: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </>
  ),
  none: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.929 4.929 19.07 19.071" />
    </>
  ),
  tick: <path d="M20 6 9 17l-5-5" />,
  crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof filled | keyof typeof stroked

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const isFilled = name in filled
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isFilled ? filled[name as keyof typeof filled] : stroked[name as keyof typeof stroked]}
    </svg>
  )
}
