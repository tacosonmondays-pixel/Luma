import { useEffect } from 'react'
import { navigate } from '../lib/router.ts'
import { saveLink, saveParam } from '../lib/save.ts'
import { searchFor } from '../lib/search-link.ts'
import '../styles/library.css'

/** The /save query being handled (React's dev mode mounts the view twice; the link is saved once). */
let handling: string | null = null

/**
 * /save?u=<YouTube link>: save the songs, then show where they went: the playlist, or Songs with the song on top.
 * When they can't be listed (offline, no YouTube key), Search opens with the link and shows why.
 */
export function Save() {
  useEffect(() => {
    const query = location.search
    const url = saveParam(query)
    if (!url) return navigate('/', true)
    if (handling === query) return
    handling = query
    saveLink(url).then(
      ({ playlistId }) => navigate(playlistId ? `/playlist/${playlistId}` : '/songs', true),
      () => searchFor(url, true),
    ).finally(() => {
      handling = null
    })
  }, [])

  return (
    <div className="empty save-view">
      <span className="spinner" aria-label="Saving" />
    </div>
  )
}
