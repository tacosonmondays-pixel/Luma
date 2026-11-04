import { useDownloads } from '../lib/helper.ts'
import { useLibrary } from '../lib/library.ts'
import { searchFor } from '../lib/search-link.ts'
import { playTracks, usePlayer } from '../lib/player.ts'
import { playable } from '../lib/queue.ts'
import { downloadSaved } from '../lib/source.ts'
import { TrackArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { openTrackMenu } from './Menu.tsx'
import { Ring } from './Ring.tsx'
import '../styles/library.css'

/** The song last tapped while it was still downloading; it plays when it arrives. */
let wantsPlay: string | null = null

/**
 * Tapping a saved song (in the library without its audio) downloads it, then plays the list from there. An
 * imported file synced from another device can't be downloaded: it opens Search for it instead.
 */
function openSaved(ids: string[], id: string) {
  const track = useLibrary.getState().tracks[id]
  if (!track) return
  if (track.source !== 'youtube') return searchFor([track.title, track.artist].filter(Boolean).join(' '))
  wantsPlay = id
  void downloadSaved(id).then((done) => {
    if (!done || wantsPlay !== id) return
    wantsPlay = null
    playTracks(ids, ids.indexOf(id))
  })
}

/** The glyph on a saved song: download, then its progress, or an alert when it failed. */
function SavedGlyph({ id }: { id: string }) {
  const state = useDownloads((s) => s[id])
  if (state === 'error')
    return (
      <span className="track-missing error" role="img" aria-label="Download Failed">
        <Icon name="alert" size={18} />
      </span>
    )
  if (state !== undefined)
    return (
      <span className="track-missing" aria-label="Downloading">
        <Ring progress={state} size={18} />
      </span>
    )
  return (
    <span className="track-missing" role="img" aria-label="Not Downloaded">
      <Icon name="download" size={18} />
    </span>
  )
}

/** Song rows. Tapping one plays the list from there (skipping songs that aren't downloaded). */
export function TrackList({ ids, playlistId }: { ids: string[]; playlistId?: string }) {
  const tracks = useLibrary((s) => s.tracks)
  const currentId = usePlayer((s) => s.queue.ids[s.queue.index])
  const playing = usePlayer((s) => s.playing)
  const shown = ids.filter((id) => tracks[id])
  const ready = playable(shown, tracks)

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
              onClick={() => (track.missing ? openSaved(shown, id) : playTracks(ready, ready.indexOf(id)))}
            >
              <TrackArt track={track} size={44} playing={current ? playing : undefined} />
              <span className="track-text">
                <span className="track-title ellipsis">{track.title}</span>
                {track.artist && <span className="track-artist ellipsis">{track.artist}</span>}
              </span>
              {track.missing && <SavedGlyph id={id} />}
            </button>
            <IconButton icon="more" label="More" size={20} onClick={(e) => openTrackMenu(e.currentTarget, id, playlistId)} />
          </li>
        )
      })}
    </ul>
  )
}
