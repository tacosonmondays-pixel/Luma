// The one popover menu. openMenu() shows it anchored to an element or a point; MenuHost renders it.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { addToPlaylist, createPlaylist, deleteTrack, removeFromPlaylist, setTrackCover, useLibrary } from '../lib/library.ts'
import { playNext } from '../lib/player.ts'
import { navigate } from '../lib/router.ts'
import { Icon, type IconName } from './Icon.tsx'
import { pickFiles } from './kit.tsx'
import '../styles/library.css'

export interface MenuItem {
  label: string
  icon?: IconName
  danger?: boolean
  onSelect?: () => void
  items?: MenuItem[] // opens a submenu instead of selecting
}

/** A screen point, e.g. where a right-click happened. */
export interface MenuPoint {
  x: number
  y: number
}

interface Rect {
  top: number
  right: number
  bottom: number
  left: number
}

interface MenuState {
  at: Rect
  items: MenuItem[]
  key: number // changes on open and on each submenu, to replay the entrance
}

const useMenu = create<{ menu?: MenuState }>(() => ({}))
let count = 0

const closeMenu = () => useMenu.setState({ menu: undefined })

/** Show a menu anchored to an element (e.g. the button that was clicked) or a point. */
export function openMenu(anchor: HTMLElement | MenuPoint, items: MenuItem[]): void {
  const at: Rect =
    anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { top: anchor.y, bottom: anchor.y, left: anchor.x, right: anchor.x }
  useMenu.setState({ menu: { at: { top: at.top, right: at.right, bottom: at.bottom, left: at.left }, items, key: ++count } })
}

/** The song menu used everywhere: Play Next, Add to Playlist, Change Cover, Remove from Playlist, Delete. */
export function openTrackMenu(anchor: HTMLElement | MenuPoint, trackId: string, playlistId?: string): void {
  const { playlists } = useLibrary.getState()
  const items: MenuItem[] = [
    { label: 'Play Next', icon: 'play-next', onSelect: () => playNext(trackId) },
    {
      label: 'Add to Playlist',
      icon: 'add-to-playlist',
      items: [
        {
          label: 'New Playlist',
          icon: 'plus',
          onSelect: () => {
            const id = createPlaylist([trackId])
            navigate(`/playlist/${id}`)
          },
        },
        ...playlists.filter((p) => p.id !== playlistId).map((p) => ({ label: p.name, onSelect: () => addToPlaylist(p.id, [trackId]) })),
      ],
    },
    {
      label: 'Change Cover',
      icon: 'image',
      onSelect: () => void pickFiles('image/*').then(([file]) => file && setTrackCover(trackId, file)),
    },
  ]
  if (playlistId) items.push({ label: 'Remove from Playlist', icon: 'remove', onSelect: () => removeFromPlaylist(playlistId, trackId) })
  items.push({ label: 'Delete', icon: 'trash', danger: true, onSelect: () => void deleteTrack(trackId) })
  openMenu(anchor, items)
}

const WIDTH = 240
const GAP = 6
const MARGIN = 8

/** Rendered once by App. */
export function MenuHost() {
  const menu = useMenu((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean }>()

  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return setPlace(undefined)
    const { at } = menu
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const h = el.offsetHeight
    const point = at.left === at.right
    const left = Math.min(Math.max(point ? at.left : at.right - WIDTH, MARGIN), vw - WIDTH - MARGIN)
    let top = at.bottom + GAP
    let above = false
    if (top + h > vh - MARGIN && at.top - GAP - h >= MARGIN) {
      top = at.top - GAP - h
      above = true
    }
    top = Math.min(Math.max(top, MARGIN), vh - h - MARGIN)
    setPlace({ left, top, above })
    el.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const inside = (e: Event) => e.target instanceof Node && !!ref.current?.contains(e.target)
    const onDown = (e: Event) => !inside(e) && closeMenu()
    const onScroll = (e: Event) => !inside(e) && closeMenu()
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && closeMenu()
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!menu) return null

  const choose = (item: MenuItem) => {
    if (item.items) return useMenu.setState({ menu: { ...menu, items: item.items, key: ++count } })
    closeMenu()
    item.onSelect?.()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [...e.currentTarget.querySelectorAll<HTMLElement>('.menu-item')]
    const i = buttons.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    buttons[(i + step + buttons.length) % buttons.length]?.focus()
  }

  return (
    <div
      ref={ref}
      key={menu.key}
      className={`menu${place ? ' shown' : ''}${place?.above ? ' above' : ''}`}
      role="menu"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, width: WIDTH }}
      onKeyDown={onKeyDown}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => choose(item)}
        >
          <span className="ellipsis">{item.label}</span>
          {item.icon && <Icon name={item.icon} size={19} />}
        </button>
      ))}
    </div>
  )
}
