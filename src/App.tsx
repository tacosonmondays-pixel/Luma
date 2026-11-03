import { useEffect } from 'react'
import { useBlobUrl } from './lib/blobs.ts'
import { importFiles } from './lib/files.ts'
import { useLibrary, useReady } from './lib/library.ts'
import { audio, restore, seek, setOpen, toggle, useCurrentTrack } from './lib/player.ts'
import { parse, usePath, type Route } from './lib/router.ts'
import { MenuHost } from './ui/Menu.tsx'
import { Sidebar, TabBar } from './ui/Nav.tsx'
import { NowPlaying } from './ui/NowPlaying.tsx'
import { PlayerBar } from './ui/PlayerBar.tsx'
import { Playlist } from './views/Playlist.tsx'
import { Playlists } from './views/Playlists.tsx'
import { Search } from './views/Search.tsx'
import { Songs } from './views/Songs.tsx'
import { You } from './views/You.tsx'

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'songs':
      return <Songs />
    case 'playlists':
      return <Playlists />
    case 'playlist':
      return <Playlist id={route.id} />
    case 'search':
      return <Search />
    case 'you':
      return <You />
  }
}

function Wallpaper() {
  const background = useLibrary((s) => s.background)
  const url = useBlobUrl('background', background?.v)
  if (!background || !url) return null
  return (
    <div className="wallpaper">
      {background.kind === 'video' ? <video src={url} autoPlay muted loop playsInline /> : <img src={url} alt="" />}
    </div>
  )
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ' && !target.closest('button, a')) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') seek(audio.currentTime - 5)
      else if (e.key === 'ArrowRight') seek(audio.currentTime + 5)
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      void importFiles([...e.dataTransfer.files])
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

export function App() {
  const ready = useReady()
  const path = usePath()
  const track = useCurrentTrack()
  useShortcuts()
  useFileDrop()
  useEffect(() => {
    if (ready) restore()
  }, [ready])
  if (!ready) return null
  const route = parse(path)
  return (
    <>
      <Wallpaper />
      <div className={`app${track ? ' has-track' : ''}`}>
        <Sidebar route={route} />
        <main className="main" key={path}>
          <View route={route} />
        </main>
      </div>
      <PlayerBar />
      <TabBar route={route} />
      <NowPlaying />
      <MenuHost />
    </>
  )
}
