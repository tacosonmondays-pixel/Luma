import type { ReactNode } from 'react'
import { importFiles, useImport } from '../lib/files.ts'
import { useLibrary } from '../lib/library.ts'
import { playTracks, shufflePlay } from '../lib/player.ts'
import { navigate } from '../lib/router.ts'
import { Icon } from '../ui/Icon.tsx'
import { IconButton, pickFiles } from '../ui/kit.tsx'
import { TrackList } from '../ui/TrackList.tsx'
import '../styles/library.css'

/** Play and Shuffle, for the songs that are downloaded. `children`: more pills after them (Download Missing). */
export function PlayPills({ ids, children }: { ids: string[]; children?: ReactNode }) {
  const empty = useLibrary((s) => !ids.some((id) => s.tracks[id] && !s.tracks[id].missing))
  return (
    <div className="play-pills">
      <button type="button" className="pill" disabled={empty} onClick={() => playTracks(ids)}>
        <Icon name="play" size={18} />
        Play
      </button>
      <button type="button" className="pill" disabled={empty} onClick={() => shufflePlay(ids)}>
        <Icon name="shuffle" size={18} />
        Shuffle
      </button>
      {children}
    </div>
  )
}

export function Songs() {
  const order = useLibrary((s) => s.order)
  const failed = useImport((s) => s.failed) // the last import ran out of storage
  const add = () => void pickFiles('audio/*', true).then(importFiles)

  return (
    <section>
      <header className="view-head">
        <h1>Songs</h1>
        <IconButton
          icon={failed ? 'alert' : 'plus'}
          label={failed ? 'Import Songs (last import failed)' : 'Import Songs'}
          className={failed ? 'error' : ''}
          onClick={add}
        />
      </header>
      {order.length ? (
        <>
          <PlayPills ids={order} />
          <TrackList ids={order} />
        </>
      ) : (
        <div className="empty">
          <Icon name="music" size={44} />
          <h2>No songs</h2>
          <button type="button" className="pill" onClick={() => navigate('/search')}>
            <Icon name="search" size={18} />
            Search
          </button>
        </div>
      )}
    </section>
  )
}
