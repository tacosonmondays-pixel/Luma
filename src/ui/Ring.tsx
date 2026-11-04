import '../styles/library.css'

const R = 9.5
const C = 2 * Math.PI * R

/** Download progress: a ring that fills, or spins while the size is unknown (null). */
export function Ring({ progress, size }: { progress: number | null; size: number }) {
  const indeterminate = progress === null
  return (
    <svg
      className={`ring${indeterminate ? ' spin' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(progress * 100)}
    >
      <circle className="ring-track" cx="12" cy="12" r={R} />
      <circle
        className="ring-fill"
        cx="12"
        cy="12"
        r={R}
        strokeDasharray={C}
        strokeDashoffset={indeterminate ? C * 0.72 : C * (1 - progress)}
      />
    </svg>
  )
}
