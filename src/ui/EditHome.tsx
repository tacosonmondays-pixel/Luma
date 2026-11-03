// Edit Home: every shelf with a switch, a handle to drag it into place (touch, mouse or the arrow keys), and
// search shelves to add and delete. A bottom sheet on phones, a card on desktop (account.css).

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  addCustomShelf,
  BUILTIN_TITLES,
  deleteCustomShelf,
  isBuiltin,
  MAX_QUERY,
  moveShelf,
  setShelfVisible,
  useHome,
} from '../lib/home.ts'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { Segmented } from './Segmented.tsx'
import type { SearchSort } from '../types.ts'
import '../styles/appearance.css'
import '../styles/account.css'
import '../styles/home.css'

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Relevant' },
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' },
]

interface Drag {
  id: string
  from: number
  startY: number
  dy: number
  row: number // row height, px
}

export function EditHome({ mixTitle, hideMix, onClose }: { mixTitle: string; hideMix: boolean; onClose: () => void }) {
  const { order, hidden, custom } = useHome()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = (id: string) => (id === 'mix' ? mixTitle : isBuiltin(id) ? BUILTIN_TITLES[id] : (custom.find((c) => c.id === id)?.query ?? ''))
  const rows = hideMix ? order.filter((id) => id !== 'mix') : order
  const target = drag ? Math.max(0, Math.min(rows.length - 1, drag.from + Math.round(drag.dy / drag.row))) : -1

  // Indices in `rows` map back to the full order (Mix may be left out of the list).
  const move = (from: number, to: number) => moveShelf(order.indexOf(rows[from]), order.indexOf(rows[to]))

  const down = (e: PointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const row = e.currentTarget.closest('li')?.getBoundingClientRect().height ?? 52
    setDrag({ id, from: index, startY: e.clientY, dy: 0, row })
  }
  const moveTo = (e: PointerEvent) => drag && setDrag({ ...drag, dy: e.clientY - drag.startY })
  const up = () => {
    if (!drag) return
    if (target !== drag.from) move(drag.from, target)
    setDrag(null)
  }
  const key = (e: KeyboardEvent, index: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1
    if (to < 0 || to >= rows.length) return
    e.preventDefault()
    move(index, to)
  }

  const offset = (index: number) => {
    if (!drag) return 0
    if (index === drag.from) return drag.dy
    if (drag.from < target && index > drag.from && index <= target) return -drag.row
    if (target < drag.from && index >= target && index < drag.from) return drag.row
    return 0
  }

  return createPortal(
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet home-edit" role="dialog" aria-modal="true" aria-label="Edit Home">
        <div className="sheet-head">
          <h2>Edit Home</h2>
          <IconButton icon="close" label="Done" onClick={onClose} />
        </div>
        <ul className={`edit-list${drag ? ' dragging' : ''}`}>
          {rows.map((id, i) => {
            const name = title(id)
            const dy = offset(i)
            const lifted = drag?.id === id
            return (
              <li key={id} className={`edit-row${lifted ? ' lifted' : ''}`} style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
                <button
                  type="button"
                  className="edit-grip"
                  aria-label={`Move ${name}`}
                  onPointerDown={(e) => down(e, id, i)}
                  onPointerMove={moveTo}
                  onPointerUp={up}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => key(e, i)}
                >
                  <Icon name="grip" size={20} />
                </button>
                <span className="edit-name ellipsis">{name}</span>
                {!isBuiltin(id) && <IconButton icon="trash" label={`Delete ${name}`} size={18} className="edit-delete" onClick={() => deleteCustomShelf(id)} />}
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  aria-label={name}
                  checked={!hidden.includes(id)}
                  onChange={(e) => setShelfVisible(id, e.target.checked)}
                />
              </li>
            )
          })}
        </ul>
        {adding ? (
          <AddShelf onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="pill edit-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            Add Shelf
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

function AddShelf({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SearchSort>('relevance')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    addCustomShelf(query, sort)
    onDone()
  }
  return (
    <form className="edit-new" onSubmit={submit}>
      <label className="sheet-field">
        <Icon name="search" size={17} />
        <input
          ref={field}
          type="search"
          enterKeyHint="done"
          placeholder="Search"
          aria-label="Search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_QUERY}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <Segmented
        label="Sort"
        className="edit-sort"
        options={SORTS.map((s) => s.value)}
        value={sort}
        onChange={setSort}
        render={(by) => ({ content: SORTS.find((s) => s.value === by)!.label })}
      />
      <button type="submit" className="pill primary sheet-submit" disabled={!query.trim()}>
        Add Shelf
      </button>
    </form>
  )
}
