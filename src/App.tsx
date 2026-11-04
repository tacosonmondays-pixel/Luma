import { useEffect, useRef } from 'react'
import { useBlobUrl } from './lib/blobs.ts'
import { importFiles } from './lib/files.ts'
import { useLibrary, useReady } from './lib/library.ts'
import { audio, restore, seek, setOpen, toggle, useCurrentTrack, usePlayer } from './lib/player.ts'
import { parse, usePath, type Route } from './lib/router.ts'
import { useViewer } from './lib/viewer.ts'
import { Boundary } from './ui/kit.tsx'
import { MenuHost } from './ui/Menu.tsx'
import { Sidebar, TabBar } from './ui/Nav.tsx'
import { NowPlaying } from './ui/NowPlaying.tsx'
import { useCardVideo } from './ui/profile/ProfileMedia.tsx'
import { PlayerBar } from './ui/PlayerBar.tsx'
import { RenameHost } from './ui/Rename.tsx'
import { ViewerHost } from './ui/Viewer.tsx'
import { Home } from './views/Home.tsx'
import { Playlist } from './views/Playlist.tsx'
import { Playlists } from './views/Playlists.tsx'
import { Save } from './views/Save.tsx'
import { Search } from './views/Search.tsx'
import { Songs } from './views/Songs.tsx'
import { User } from './views/User.tsx'
import { You } from './views/You.tsx'

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />
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
    case 'user':
      return <User handle={route.handle} />
    case 'save':
      return <Save />
  }
}

/** The app's own background. Its video pauses while a profile card plays a Background video (one video at a
 * time) and while Now Playing covers it. */
function Wallpaper({ covered }: { covered: boolean }) {
  const background = useLibrary((s) => s.background)
  const url = useBlobUrl('background', background?.v)
  const yield_ = useCardVideo((s) => s.playing) || covered
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (yield_) video.current?.pause()
    else void video.current?.play().catch(() => {})
  }, [yield_, url])
  if (!background || !url) return null
  return (
    <div className="wallpaper">
      {background.kind === 'video' ? <video ref={video} src={url} autoPlay={!yield_} muted loop playsInline /> : <img src={url} alt="" />}
    </div>
  )
}

/** Space plays and pauses, arrows seek, Escape closes Now Playing (a sheet over it closes first). An open menu takes
 * the keys first (Menu.tsx). */
function useShortcuts() {
  useEffect(() => {
    // Space presses a button or link only when it was focused from the keyboard. Chrome also focuses what
    // a click lands on, and Space would then press that song row or Next again instead of pausing.
    let pointer = false
    let clickFocused = false
    const onPointer = () => (pointer = true)
    const onKeyboard = () => (pointer = false)
    const onFocus = () => (clickFocused = pointer)
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (!document.querySelector('.sheet-scrim')) setOpen(false)
        return
      }
      const target = e.target as HTMLElement
      if (target.closest('textarea, [contenteditable], input:not([type="range"])')) return // typing
      if (e.key === ' ') {
        if (target.closest('button, a') && !clickFocused) return
        e.preventDefault()
        toggle()
      } else if (target.matches('input')) return // a slider moves itself
      else if (e.key === 'ArrowLeft') seek(audio.currentTime - 5)
      else if (e.key === 'ArrowRight') seek(audio.currentTime + 5)
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKeyboard, true) // also for keys an open menu keeps to itself
    window.addEventListener('focusin', onFocus, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKeyboard, true)
      window.removeEventListener('focusin', onFocus, true)
      window.removeEventListener('keydown', onKey)
    }
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
  const nowPlaying = usePlayer((s) => s.open) && !!track
  const viewing = useViewer((s) => !!s.post)
  useShortcuts()
  useFileDrop()
  useEffect(() => {
    if (ready) restore()
  }, [ready])
  if (!ready) return null
  const route = parse(path)
  return (
    <>
      <Wallpaper covered={nowPlaying || viewing} />
      {/* Now Playing and the Viewer are modal: while one shows, keyboard focus can't wander into the page behind it. */}
      <div inert={nowPlaying || viewing}>
        <div className={`app${track ? ' has-track' : ''}`}>
          <Sidebar route={route} />
          <main className="main" key={path}>
            <Boundary>
              <View route={route} />
            </Boundary>
          </main>
        </div>
        <PlayerBar />
        <TabBar route={route} />
      </div>
      <NowPlaying />
      <ViewerHost />
      <RenameHost />
      <MenuHost />
    </>
  )
}
