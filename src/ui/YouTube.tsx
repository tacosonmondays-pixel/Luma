// Connect YouTube: the row in You's settings group, and the sheet that lists the owner's playlists (Liked videos
// first) to import as linked playlists. Hidden until google-config.ts has a client ID.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { gradientFor } from '../lib/format.ts'
import { disconnect, ensureToken, googleEnabled, preload, useGoogle } from '../lib/google.ts'
import { useLibrary } from '../lib/library.ts'
import { navigate } from '../lib/router.ts'
import { saveTarget } from '../lib/save.ts'
import { myPlaylists, type MyPlaylist } from '../lib/youtube.ts'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import '../styles/account.css'
import '../styles/youtube.css'

type Load = 'loading' | 'failed' | MyPlaylist[]

export function YouTubeSheet({ onClose }: { onClose: () => void }) {
  const token = useGoogle((s) => s.token)
  const [load, setLoad] = useState<Load>('loading')
  const [busy, setBusy] = useState<Record<string, 'busy' | 'failed'>>({})
  const [attempt, setAttempt] = useState(0)
  const linked = useLibrary((s) => new Map(s.playlists.flatMap((p) => (p.youtubeId ? [[p.youtubeId, p.id] as const] : []))))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!token) return
    const abort = new AbortController()
    setLoad('loading')
    myPlaylists(token, abort.signal).then(setLoad, () => !abort.signal.aborted && setLoad('failed'))
    return () => abort.abort()
  }, [token, attempt])

  const add = (p: MyPlaylist) => {
    setBusy((b) => ({ ...b, [p.id]: 'busy' }))
    saveTarget({ list: p.id }, p.title, true).then(
      () => setBusy(({ [p.id]: _, ...rest }) => rest),
      () => setBusy((b) => ({ ...b, [p.id]: 'failed' })),
    )
  }

  const open = (id: string) => {
    onClose()
    navigate(`/playlist/${id}`)
  }

  return createPortal(
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet yt-sheet" role="dialog" aria-modal="true" aria-label="YouTube">
        <div className="sheet-head">
          <h2>YouTube</h2>
          <IconButton icon="close" label="Close" size={20} onClick={onClose} />
        </div>
        {load === 'loading' ? (
          <div className="yt-state">
            <span className="spinner" aria-label="Loading" />
          </div>
        ) : load === 'failed' ? (
          <div className="yt-state">
            <button type="button" className="pill" onClick={() => void ensureToken().then(() => setAttempt((n) => n + 1), () => {})}>
              <Icon name="refresh" size={18} />
              Try Again
            </button>
          </div>
        ) : (
          <ul className="yt-lists">
            {load.map((p) => {
              const local = linked.get(p.id)
              const state = busy[p.id]
              return (
                <li key={p.id} className="yt-list">
                  <span className="yt-thumb" style={p.thumbnail ? undefined : { background: gradientFor(p.id) }}>
                    {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" draggable={false} /> : <Icon name="music" size={18} />}
                  </span>
                  <span className="yt-title ellipsis">{p.title}</span>
                  {state === 'busy' ? (
                    <span className="icon-btn yt-busy" aria-label="Importing">
                      <span className="spinner" />
                    </span>
                  ) : local ? (
                    <IconButton icon="check" label={`Open ${p.title}`} className="yt-linked" onClick={() => open(local)} />
                  ) : (
                    <IconButton
                      icon={state === 'failed' ? 'alert' : 'plus'}
                      label={`Import ${p.title}`}
                      className={state === 'failed' ? 'error' : ''}
                      onClick={() => add(p)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <button
          type="button"
          className="yt-disconnect"
          onClick={() => {
            disconnect()
            onClose()
          }}
        >
          Disconnect
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** The YouTube row: signs in with Google within the tap, then lists the playlists. */
export function YouTubeRow() {
  const [open, setOpen] = useState(false)
  const connected = useGoogle((s) => s.connected)
  useEffect(() => {
    if (googleEnabled()) void preload().catch(() => {})
  }, [])
  if (!googleEnabled()) return null
  return (
    <>
      <button
        type="button"
        className="group-row"
        onClick={() => {
          // Google's popup opens within this tap; the sheet waits for its token.
          ensureToken().then(
            () => setOpen(true),
            () => {},
          )
        }}
      >
        <span>YouTube</span>
        <span className="group-value">
          {connected && <Icon name="tick" size={18} />}
          <Icon name="chevron-right" size={18} />
        </span>
      </button>
      {open && <YouTubeSheet onClose={() => setOpen(false)} />}
    </>
  )
}
