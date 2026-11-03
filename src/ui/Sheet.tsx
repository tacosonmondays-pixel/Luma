// A sheet: a bottom sheet on phones, a small centered card on desktop (account.css), over a scrim. On body, beside
// Now Playing and the menu: Y2K's desktop window would otherwise trap it under the player bar. Escape, a press on
// the scrim and Close all close it.
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './kit.tsx'
import '../styles/account.css'

interface SheetProps {
  title: string
  onClose: () => void
  /** A form, for a sheet that submits (Enter in its fields). */
  as?: 'div' | 'form'
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void
  className?: string
  children: ReactNode
}

export function Sheet({ title, onClose, as = 'div', onSubmit, className = '', children }: SheetProps) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const props = { className: `sheet ${className}`, role: 'dialog', 'aria-modal': true, 'aria-label': title } as const
  const content = (
    <>
      <div className="sheet-head">
        <h2>{title}</h2>
        <IconButton icon="close" label="Close" size={20} onClick={onClose} />
      </div>
      {children}
    </>
  )
  return createPortal(
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {as === 'form' ? (
        <form {...props} onSubmit={onSubmit}>
          {content}
        </form>
      ) : (
        <div {...props}>{content}</div>
      )}
    </div>,
    document.body,
  )
}
