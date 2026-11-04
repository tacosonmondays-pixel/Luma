// The one popover menu. openMenu() shows it anchored to an element or a point; MenuHost renders it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import {
  addToPlaylist,
  createPlaylist,
  deleteTrack,
  focusNameOf,
  pinSong,
  removeFromPlaylist,
  setTrackCanvas,
  setTrackCover,
  unpinSong,
  useLibrary,
} from '../lib/library.ts'
import { processMedia } from '../lib/media.ts'
import { playNext, setOpen } from '../lib/player.ts'
import { navigate } from '../lib/router.ts'
import { downloadable, downloadSaved } from '../lib/source.ts'
import { Icon, type IconName } from './Icon.tsx'
import { pickFiles } from './kit.tsx'
import { openRename } from './Rename.tsx'
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
  above?: boolean // a submenu stays on the side its parent opened on
}

const useMenu = create<{ menu?: MenuState }>(() => ({}))
let count = 0
let opener: HTMLElement | null = null // gets focus back when the menu closes

function closeMenu() {
  const active = document.activeElement
  const hadFocus = !active || active === document.body || !!document.querySelector('.menu')?.contains(active)
  useMenu.setState({ menu: undefined })
  if (hadFocus && opener?.isConnected) opener.focus({ preventScroll: true })
  opener = null
}

/** Show a menu anchored to an element (e.g. the button that was clicked) or a point. */
export function openMenu(anchor: HTMLElement | MenuPoint, items: MenuItem[]): void {
  const at: Rect =
    anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { top: anchor.y, bottom: anchor.y, left: anchor.x, right: anchor.x }
  const active = document.activeElement
  opener = anchor instanceof HTMLElement ? anchor : active instanceof HTMLElement && active !== document.body ? active : null
  useMenu.setState({ menu: { at: { top: at.top, right: at.right, bottom: at.bottom, left: at.left }, items, key: ++count } })
}

/** A Canvas that can't be used (too large, too long, unsupported) is skipped; there is nowhere to say so in a menu. */
const pickCanvas = (trackId: string) =>
  void pickFiles('image/*,video/mp4,video/quicktime,video/webm').then(async ([file]) => {
    if (!file) return
    await setTrackCanvas(trackId, await processMedia(file, 'canvas')).catch(() => {})
  }).catch(() => {})

/** The song menu used everywhere: Play Next (or Download, for a saved song), Add to Playlist, Pin, Rename,
 *  Change Cover, Canvas, Remove from Playlist, Delete. */
export function openTrackMenu(anchor: HTMLElement | MenuPoint, trackId: string, playlistId?: string): void {
  const { playlists, profile, tracks } = useLibrary.getState()
  const pinned = !!profile.pinnedSongs?.includes(trackId)
  const hasCanvas = !!tracks[trackId]?.canvas
  // A saved song can't play yet: it offers Download (when a downloader can fetch it) instead of Play Next.
  const first: MenuItem[] = !tracks[trackId]?.missing
    ? [{ label: 'Play Next', icon: 'play-next', onSelect: () => playNext(trackId) }]
    : downloadable([trackId]).length
      ? [{ label: 'Download', icon: 'download', onSelect: () => void downloadSaved(trackId) }]
      : []
  const items: MenuItem[] = [
    ...first,
    {
      label: 'Add to Playlist',
      icon: 'add-to-playlist',
      items: [
        {
          label: 'New Playlist',
          icon: 'plus',
          onSelect: () => {
            const id = createPlaylist([trackId])
            setOpen(false) // from Now Playing: show the new playlist, not the sheet over it
            focusNameOf(id)
            navigate(`/playlist/${id}`)
          },
        },
        ...playlists.filter((p) => p.id !== playlistId).map((p) => ({ label: p.name, onSelect: () => addToPlaylist(p.id, [trackId]) })),
      ],
    },
    pinned
      ? { label: 'Unpin from Profile', icon: 'unpin', onSelect: () => unpinSong(trackId) }
      : { label: 'Pin to Profile', icon: 'pin', onSelect: () => pinSong(trackId) },
    { label: 'Rename', icon: 'pencil', onSelect: () => openRename(trackId) },
    {
      label: 'Change Cover',
      icon: 'image',
      onSelect: () => void pickFiles('image/*').then(([file]) => file && setTrackCover(trackId, file)),
    },
    { label: 'Set Canvas', icon: 'film', onSelect: () => pickCanvas(trackId) },
  ]
  if (hasCanvas) items.push({ label: 'Remove Canvas', icon: 'remove', onSelect: () => void setTrackCanvas(trackId, null) })
  if (playlistId) items.push({ label: 'Remove from Playlist', icon: 'remove', onSelect: () => removeFromPlaylist(playlistId, trackId) })
  // Deleting can't be undone (an imported file is gone for good), so it asks once more.
  items.push({
    label: 'Delete',
    icon: 'trash',
    danger: true,
    items: [{ label: 'Delete Song', icon: 'trash', danger: true, onSelect: () => void deleteTrack(trackId) }],
  })
  openMenu(anchor, items)
}

const WIDTH = 240
const GAP = 6
const MARGIN = 8

/** The safe-area insets (notch, Dynamic Island, home indicator, rounded corners) in px. */
function safeArea(): Rect {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const px = (value: string) => parseFloat(value) || 0
  const insets = { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) }
  probe.remove()
  return insets
}

/** Swallow the click that follows a tap outside the menu: dismissing it shouldn't also start a song or switch tabs. */
function swallowClick() {
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    done()
  }
  // No click came (the tap became a scroll): the next press is a new one.
  const done = () => {
    document.removeEventListener('click', stop, true)
    document.removeEventListener('pointerdown', done, true)
    document.removeEventListener('keydown', done, true)
  }
  document.addEventListener('click', stop, true)
  document.addEventListener('pointerdown', done, true)
  document.addEventListener('keydown', done, true)
}

/** Rendered once by App. */
export function MenuHost() {
  const menu = useMenu((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean }>()
  const shown = !!place

  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return setPlace(undefined)
    const { at } = menu
    const safe = safeArea()
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const h = el.offsetHeight
    const minTop = safe.top + MARGIN
    const maxBottom = vh - safe.bottom - MARGIN
    const point = at.left === at.right
    const left = Math.min(Math.max(point ? at.left : at.right - WIDTH, safe.left + MARGIN), vw - safe.right - MARGIN - WIDTH)
    const above = menu.above ?? (at.bottom + GAP + h > maxBottom && at.top - GAP - h >= minTop)
    const top = Math.min(Math.max(above ? at.top - GAP - h : at.bottom + GAP, minTop), maxBottom - h)
    setPlace({ left, top, above })
  }, [menu])

  // Focus the first item once the menu is visible: a hidden element can't take focus.
  useEffect(() => {
    if (shown) ref.current?.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true })
  }, [menu?.key, shown])

  useEffect(() => {
    if (!menu) return
    const inside = (e: Event) => e.target instanceof Node && !!ref.current?.contains(e.target)
    const onDown = (e: Event) => {
      if (inside(e)) return
      closeMenu()
      swallowClick()
    }
    const onScroll = (e: Event) => !inside(e) && closeMenu()
    // Capture phase, ahead of the app's shortcuts: while the menu is open, keys are the menu's alone,
    // so Escape closes just the menu (not Now Playing under it) and arrows move between items, not through the song.
    const onKey = (e: globalThis.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') closeMenu() // focus goes back to the button, then on from there
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        const n = items.length
        let to = e.key === 'ArrowDown' ? (i + 1) % n : i < 0 ? n - 1 : (i - 1 + n) % n
        if (e.key === 'Home') to = 0
        if (e.key === 'End') to = n - 1
        items[to]?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  if (!menu) return null

  const choose = (item: MenuItem) => {
    if (item.items) return useMenu.setState({ menu: { ...menu, items: item.items, key: ++count, above: place?.above } })
    closeMenu()
    item.onSelect?.()
  }

  return (
    <div
      ref={ref}
      key={menu.key}
      className={`menu${place ? ' shown' : ''}${place?.above ? ' above' : ''}`}
      role="menu"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, width: WIDTH }}
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
