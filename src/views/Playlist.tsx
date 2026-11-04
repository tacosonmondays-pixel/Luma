import { useEffect, useRef, useState } from 'react'
import { deletePlaylist, pinPlaylist, renamePlaylist, setPlaylistCover, takeNameFocus, unpinPlaylist, useLibrary } from '../lib/library.ts'
import { useDownloads } from '../lib/helper.ts'
import { navigate } from '../lib/router.ts'
import { refreshPlaylist } from '../lib/save.ts'
import { downloadable, downloadMissing } from '../lib/source.ts'
import { PlaylistArt } from '../ui/Art.tsx'
import { Icon } from '../ui/Icon.tsx'
import { IconButton, pickFiles } from '../ui/kit.tsx'
import { openMenu } from '../ui/Menu.tsx'
import { TrackList } from '../ui/TrackList.tsx'
import { Wash } from '../ui/Wash.tsx'
import { PlayPills } from './Songs.tsx'
import type { Playlist as PlaylistData } from '../types.ts'
import '../styles/library.css'

/** The playlist's cover, else its first song's cover, softened behind the header. None over a wallpaper. */
function HeaderWash({ playlist }: { playlist: PlaylistData }) {
  const first = useLibrary((s) => s.tracks[playlist.trackIds[0] ?? ''])
  const wallpaper = useLibrary((s) => !!s.background)
  if (wallpaper) return null
  if (playlist.cover) return <Wash className="playlist-wash" still blobKey={`playlist-cover:${playlist.id}`} v={playlist.cover} seed={playlist.id} />
  if (first?.cover) return <Wash className="playlist-wash" still blobKey={`cover:${first.id}`} v={first.cover} seed={first.id} />
  return null
}

/** Download Missing: shown while the playlist has saved songs a downloader can fetch, quiet while they download. */
function DownloadMissing({ playlist }: { playlist: PlaylistData }) {
  const missing = useLibrary(() => downloadable(playlist.trackIds).join())
  const busy = useDownloads((s) => !!missing && missing.split(',').every((id) => s[id] !== undefined && s[id] !== 'error'))
  if (!missing) return null
  return (
    <button type="button" className="pill download-missing" disabled={busy} onClick={() => downloadMissing(playlist.trackIds, playlist.youtubeId)}>
      <Icon name="download" size={18} />
      Download Missing
    </button>
  )
}

export function Playlist({ id }: { id: string }) {
  const [refresh, setRefresh] = useState<'busy' | 'failed'>()
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  const pinned = useLibrary((s) => !!s.profile.pinnedPlaylists?.includes(id))
  const [name, setName] = useState(playlist?.name ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!playlist) navigate('/playlists', true)
  }, [playlist])

  useEffect(() => {
    if (!takeNameFocus(id)) return
    input.current?.focus()
    input.current?.select()
  }, [id])

  if (!playlist) return null
  const empty = playlist.trackIds.length === 0

  const refreshFromYouTube = () => {
    setRefresh('busy')
    refreshPlaylist(id).then(
      () => setRefresh(undefined),
      () => setRefresh('failed'),
    )
  }

  const more = (anchor: HTMLElement) =>
    openMenu(anchor, [
      ...(playlist.youtubeId ? [{ label: 'Refresh from YouTube', icon: 'refresh' as const, onSelect: refreshFromYouTube }] : []),
      {
        label: 'Change Cover',
        icon: 'image',
        onSelect: () => void pickFiles('image/*').then(([file]) => file && setPlaylistCover(id, file)),
      },
      pinned
        ? { label: 'Unpin from Profile', icon: 'unpin', onSelect: () => unpinPlaylist(id) }
        : { label: 'Pin to Profile', icon: 'pin', onSelect: () => pinPlaylist(id) },
      {
        label: 'Delete Playlist',
        icon: 'trash',
        danger: true,
        items: [
          {
            label: 'Delete Playlist',
            icon: 'trash',
            danger: true,
            onSelect: () => {
              navigate('/playlists')
              void deletePlaylist(id)
            },
          },
        ],
      },
    ])

  return (
    <section className="playlist">
      <HeaderWash playlist={playlist} />
      <header className="playlist-head">
        <PlaylistArt playlist={playlist} className="playlist-cover" />
        <div className="playlist-info">
          <input
            ref={input}
            className="playlist-name"
            aria-label="Playlist name"
            value={name}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value)
              renamePlaylist(id, e.target.value) // saves "New Playlist" while the field is empty
            }}
            onBlur={() => !name.trim() && setName('New Playlist')}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="playlist-actions">
            {!empty && (
              <PlayPills ids={playlist.trackIds}>
                <DownloadMissing playlist={playlist} />
              </PlayPills>
            )}
            {refresh === 'busy' ? (
              <span className="icon-btn playlist-refreshing" aria-label="Refreshing">
                <span className="spinner" />
              </span>
            ) : (
              <IconButton
                icon={refresh === 'failed' ? 'alert' : 'more'}
                label={refresh === 'failed' ? 'More (refresh failed)' : 'More'}
                className={refresh === 'failed' ? 'error' : ''}
                onClick={(e) => {
                  setRefresh(undefined)
                  more(e.currentTarget)
                }}
              />
            )}
          </div>
        </div>
      </header>
      {empty ? (
        // Songs are added from their own menu (… → Add to Playlist), so lead there.
        <div className="empty playlist-empty">
          <Icon name="music" size={44} />
          <button type="button" className="pill" onClick={() => navigate('/songs')}>
            <Icon name="plus" size={18} />
            Add Songs
          </button>
        </div>
      ) : (
        <TrackList ids={playlist.trackIds} playlistId={id} />
      )}
    </section>
  )
}
