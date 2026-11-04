import type { CSSProperties, ReactNode } from 'react'
import '../styles/segmented.css'

/** A segmented control: one thumb that slides between equal segments. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
  className = '',
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  render: (option: T) => { content: ReactNode; label?: string }
  className?: string
}) {
  const index = Math.max(0, options.indexOf(value))
  const style = { '--n': options.length, '--i': index } as CSSProperties
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label} style={style}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => {
        const { content, label: name } = render(option)
        return (
          <button key={option} type="button" role="radio" aria-checked={option === value} aria-label={name} onClick={() => onChange(option)}>
            {content}
          </button>
        )
      })}
    </div>
  )
}
