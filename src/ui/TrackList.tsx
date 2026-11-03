import { useLibrary } from '../lib/library.ts'
import { searchFor } from '../lib/search-link.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { TrackArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { openTrackMenu } from './Menu.tsx'
import '../styles/library.css'

/** Song rows. Tapping one plays the list from there. */
export function TrackList({ ids, playlistId }: { ids: string[]; playlistId?: string }) {
  const tracks = useLibrary((s) => s.tracks)
  const currentId = usePlayer((s) => s.queue.ids[s.queue.index])
  const playing = usePlayer((s) => s.playing)
  const shown = ids.filter((id) => tracks[id])
  const playable = shown.filter((id) => !tracks[id].missing)

  return (
    <ul className="tracks">
      {shown.map((id) => {
        const track = tracks[id]
        const current = id === currentId
        return (
          <li
            key={id}
            className={`track${current ? ' current' : ''}${track.missing ? ' missing' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault()
              openTrackMenu({ x: e.clientX, y: e.clientY }, id, playlistId)
            }}
          >
            <button
              type="button"
              className="track-main"
              // Synced from another device without audio: find it to download again.
              onClick={() => (track.missing ? searchFor([track.title, track.artist].filter(Boolean).join(' ')) : playTracks(playable, playable.indexOf(id)))}
            >
              <TrackArt track={track} size={44} playing={current ? playing : undefined} />
              <span className="track-text">
                <span className="track-title ellipsis">{track.title}</span>
                {track.artist && <span className="track-artist ellipsis">{track.artist}</span>}
              </span>
              {track.missing && (
                <span className="track-missing" role="img" aria-label="Not Downloaded">
                  <Icon name="download" size={18} />
                </span>
              )}
            </button>
            <IconButton icon="more" label="More" size={20} onClick={(e) => openTrackMenu(e.currentTarget, id, playlistId)} />
          </li>
        )
      })}
    </ul>
  )
}
