// Rename: a song's title and artist, in a sheet opened from the song menu (openRename). RenameHost renders it, once,
// in App, so it opens from any list and over Now Playing.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { MAX_NAME, renameTrack, useLibrary } from '../lib/library.ts'
import { Sheet } from './Sheet.tsx'

const useRename = create<{ id?: string }>(() => ({}))

export const openRename = (id: string) => useRename.setState({ id })
const close = () => useRename.setState({ id: undefined })

export function RenameHost() {
  const id = useRename((s) => s.id)
  const track = useLibrary((s) => (id === undefined ? undefined : s.tracks[id]))
  // Deleted meanwhile (another tab, a sync): the sheet closes, and stays closed if the song comes back.
  const gone = id !== undefined && !track
  useEffect(() => void (gone && close()), [gone])
  if (id === undefined || !track) return null
  return <RenameSheet key={id} id={id} title={track.title} artist={track.artist} />
}

function RenameSheet({ id, ...name }: { id: string; title: string; artist: string }) {
  const [title, setTitle] = useState(name.title)
  const [artist, setArtist] = useState(name.artist)
  const field = useRef<HTMLInputElement>(null)

  // The title, selected for typing over.
  useEffect(() => {
    const el = field.current
    el?.focus({ preventScroll: true })
    el?.setSelectionRange(0, el.value.length)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    renameTrack(id, title, artist)
    close()
  }

  return (
    <Sheet title="Rename" as="form" className="rename" onClose={close} onSubmit={submit}>
      <div className="rename-fields">
        <label className="sheet-field">
          <input
            ref={field}
            name="title"
            aria-label="Title"
            placeholder="Title"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_NAME}
            enterKeyHint="done"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="sheet-field">
          <input
            name="artist"
            aria-label="Artist"
            placeholder="Artist"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_NAME}
            enterKeyHint="done"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="pill primary sheet-submit">
        Save
      </button>
    </Sheet>
  )
}
