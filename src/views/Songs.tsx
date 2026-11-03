import { importFiles } from '../lib/files.ts'
import { useLibrary } from '../lib/library.ts'
import { playTracks, shufflePlay } from '../lib/player.ts'
import { navigate } from '../lib/router.ts'
import { Icon } from '../ui/Icon.tsx'
import { IconButton, pickFiles } from '../ui/kit.tsx'
import { TrackList } from '../ui/TrackList.tsx'
import '../styles/library.css'

export function PlayPills({ ids }: { ids: string[] }) {
  const empty = ids.length === 0
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
    </div>
  )
}

export function Songs() {
  const order = useLibrary((s) => s.order)
  const add = () => void pickFiles('audio/*', true).then(importFiles)

  return (
    <section>
      <header className="view-head">
        <h1>Songs</h1>
        <IconButton icon="plus" label="Import Songs" onClick={add} />
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
