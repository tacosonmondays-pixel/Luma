import { useEffect, useRef, useState } from 'react'
import { deletePlaylist, renamePlaylist, setPlaylistCover, useLibrary } from '../lib/library.ts'
import { navigate } from '../lib/router.ts'
import { PlaylistArt } from '../ui/Art.tsx'
import { IconButton, pickFiles } from '../ui/kit.tsx'
import { openMenu } from '../ui/Menu.tsx'
import { TrackList } from '../ui/TrackList.tsx'
import { PlayPills } from './Songs.tsx'
import '../styles/library.css'

let focusNext: string | undefined

/** Focus the name field the next time this playlist opens (right after creating it). */
export function focusNameOf(id: string): void {
  focusNext = id
}

export function Playlist({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  const [name, setName] = useState(playlist?.name ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!playlist) navigate('/playlists', true)
  }, [playlist])

  useEffect(() => {
    if (focusNext !== id) return
    focusNext = undefined
    input.current?.focus()
    input.current?.select()
  }, [id])

  if (!playlist) return null

  const more = (anchor: HTMLElement) =>
    openMenu(anchor, [
      {
        label: 'Change Cover',
        icon: 'image',
        onSelect: () => void pickFiles('image/*').then(([file]) => file && setPlaylistCover(id, file)),
      },
      {
        label: 'Delete Playlist',
        icon: 'trash',
        danger: true,
        onSelect: () => {
          navigate('/playlists')
          void deletePlaylist(id)
        },
      },
    ])

  return (
    <section>
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
              renamePlaylist(id, e.target.value)
            }}
            onBlur={() => {
              if (name.trim()) return
              setName('New Playlist')
              renamePlaylist(id, 'New Playlist')
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="playlist-actions">
            <PlayPills ids={playlist.trackIds} />
            <IconButton icon="more" label="More" onClick={(e) => more(e.currentTarget)} />
          </div>
        </div>
      </header>
      <TrackList ids={playlist.trackIds} playlistId={id} />
    </section>
  )
}
