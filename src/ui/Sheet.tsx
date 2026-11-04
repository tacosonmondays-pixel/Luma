// A sheet: a bottom sheet on phones, a small centered card on desktop (account.css), over a scrim. On body, beside
// Now Playing and the menu: Y2K's desktop window would otherwise trap it under the player bar. Escape, a press on
// the scrim and Close all close it. Focus moves in when it opens (unless a field in it took it), Tab stays in it,
// and focus goes back to whatever opened it when it closes.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton, wrapTab } from './kit.tsx'
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
  const root = useRef<HTMLDivElement & HTMLFormElement>(null)
  // What had focus as it opened: read while rendering, before a child's effect (the composer's field) moves it.
  const [opener] = useState(() => {
    const el = document.activeElement
    return el instanceof HTMLElement && el !== document.body ? el : null
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
      // From anywhere (focus lost to the page too), unless a menu or the Viewer over it has the keys.
      else if (e.key === 'Tab' && root.current && !document.querySelector('.menu, .viewer')) wrapTab(e, root.current)
    }
    window.addEventListener('keydown', onKey)
    const el = root.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      const now = document.activeElement
      if (opener?.isConnected && (!now || now === document.body || !!el?.contains(now))) opener.focus({ preventScroll: true })
    }
  }, [opener])

  const props = { ref: root, className: `sheet ${className}`, role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1 } as const
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
