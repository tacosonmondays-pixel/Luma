import { useLibrary } from '../lib/library.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { TrackArt } from './Art.tsx'
import { IconButton } from './kit.tsx'
import { openTrackMenu } from './Menu.tsx'
import '../styles/library.css'

/** Song rows. Tapping one plays the list from there. */
export function TrackList({ ids, playlistId }: { ids: string[]; playlistId?: string }) {
  const tracks = useLibrary((s) => s.tracks)
  const currentId = usePlayer((s) => s.queue.ids[s.queue.index])
  const playing = usePlayer((s) => s.playing)
  const shown = ids.filter((id) => tracks[id])

  return (
    <ul className="tracks">
      {shown.map((id, index) => {
        const track = tracks[id]
        const current = id === currentId
        return (
          <li
            key={id}
            className={`track${current ? ' current' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault()
              openTrackMenu({ x: e.clientX, y: e.clientY }, id, playlistId)
            }}
          >
            <button type="button" className="track-main" onClick={() => playTracks(shown, index)}>
              <TrackArt track={track} size={44} playing={current ? playing : undefined} />
              <span className="track-text">
                <span className="track-title ellipsis">{track.title}</span>
                {track.artist && <span className="track-artist ellipsis">{track.artist}</span>}
              </span>
            </button>
            <IconButton icon="more" label="More" size={20} onClick={(e) => openTrackMenu(e.currentTarget, id, playlistId)} />
          </li>
        )
      })}
    </ul>
  )
}
