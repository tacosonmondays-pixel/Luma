import { createPlaylist, focusNameOf, useLibrary } from '../lib/library.ts'
import { navigate } from '../lib/router.ts'
import { PlaylistArt } from '../ui/Art.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Link } from '../ui/kit.tsx'
import '../styles/library.css'

export function Playlists() {
  const playlists = useLibrary((s) => s.playlists)
  const create = () => {
    const id = createPlaylist()
    focusNameOf(id)
    navigate(`/playlist/${id}`)
  }

  return (
    <section>
      <header className="view-head">
        <h1>Playlists</h1>
      </header>
      <div className="playlist-grid">
        <button type="button" className="playlist-tile" onClick={create}>
          <div className="art playlist-tile-new">
            <Icon name="plus" size={40} />
          </div>
          <span className="playlist-tile-name ellipsis">New Playlist</span>
        </button>
        {playlists.map((p) => (
          <Link key={p.id} to={`/playlist/${p.id}`} className="playlist-tile">
            <PlaylistArt playlist={p} />
            <span className="playlist-tile-name ellipsis">{p.name}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
