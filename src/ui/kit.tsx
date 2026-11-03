import type { MouseEvent, ReactNode } from 'react'
import { href, navigate } from '../lib/router.ts'
import { Icon, type IconName } from './Icon.tsx'

interface IconButtonProps {
  icon: IconName
  label: string // accessible name; never shown
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  disabled?: boolean
  size?: number
  className?: string
}

export function IconButton({ icon, label, onClick, active, disabled, size = 22, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''} ${className}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

/** An in-app link: a real <a> so it works with the keyboard and middle-click. */
export function Link({ to, className, label, children }: { to: string; className?: string; label?: string; children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={href(to)} className={className} aria-label={label} onClick={onClick}>
      {children}
    </a>
  )
}

/** Opens the system file picker. Call it straight from a click handler (iOS needs the user gesture). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}
