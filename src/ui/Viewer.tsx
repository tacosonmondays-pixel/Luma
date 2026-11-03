// The Viewer: one post over everything, with no route (like Now Playing). Full screen on phones, a centered panel on
// desktop. A video plays muted and loops (not at all under reduced motion); unmuting pauses the music first, and
// closing resumes it in the same tap (lib/viewer.ts). Keys are the Viewer's alone while it shows.
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react'
import { ban, removeContent } from '../lib/moderation.ts'
import { deletePost } from '../lib/posting.ts'
import { href, navigate, usePath } from '../lib/router.ts'
import { currentMe, keyOf, loadPeople, report, useSocial, type Person, type Post } from '../lib/social.ts'
import { closePost, pauseForSound, useViewer } from '../lib/viewer.ts'
import { PersonAvatar } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { Boundary, IconButton } from './kit.tsx'
import { openMenu, type MenuItem } from './Menu.tsx'
import { displayName, reasonItems } from './People.tsx'
import { useReducedMotion } from './profile/ProfileCard.tsx'
import { SongRow } from './ResultTile.tsx'
import '../styles/social.css'

/** Rendered once by App, after Now Playing. */
export function ViewerHost() {
  const post = useViewer((s) => s.post)
  if (!post) return null
  return (
    <Boundary key={keyOf(post)}>
      <Viewer post={post} />
    </Boundary>
  )
}

/** A post's More menu: Delete for its author; Report for other members; Remove and Ban for admins. */
export function postMenuItems(post: Post, author?: Person): MenuItem[] {
  const me = currentMe()
  if (!me) return []
  if (post.userId === me.id)
    return [
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        items: [{ label: 'Delete Post', icon: 'trash', danger: true, onSelect: () => (closePost(), void deletePost(post)) }],
      },
    ]
  if (!me.admin) {
    if (useSocial.getState().hidden.has(keyOf(post))) return []
    return [{ label: 'Report', icon: 'flag', items: reasonItems((reason) => (closePost(), void report(post.kind, post.id, reason))) }]
  }
  const items: MenuItem[] = [
    {
      label: 'Remove',
      icon: 'trash',
      danger: true,
      items: [{ label: 'Remove Post', icon: 'trash', danger: true, onSelect: () => (closePost(), void removeContent(post)) }],
    },
  ]
  if (author && !author.admin && !author.banned)
    items.push({
      label: 'Ban',
      icon: 'none',
      danger: true,
      items: [{ label: `Ban @${author.handle}`, icon: 'none', danger: true, onSelect: () => (closePost(), void ban(post.userId)) }],
    })
  return items
}

function Viewer({ post }: { post: Post }) {
  const author = useSocial((s) => s.people[post.userId])
  const reduced = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<VideoControls | null>(null)
  const step = useRef<((by: number) => void) | null>(null)
  const path = usePath()
  const opened = useRef(path)

  useEffect(() => {
    if (!author) void loadPeople([post.userId])
  }, [author, post.userId])

  // Back (or anything else that changes the route) closes it.
  useEffect(() => {
    if (path !== opened.current) closePost()
  }, [path])

  // Focus starts on Close and goes back to the opener afterwards.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    root.current?.querySelector<HTMLElement>('.viewer-close')?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  // Capture phase, ahead of the app's shortcuts and the sheet under it: keys are the Viewer's while it shows. An open
  // menu (its More) takes them first.
  useEffect(() => {
    let tabbed = false
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.menu')) return
      e.stopPropagation()
      if (e.key === 'Tab') tabbed = true
      if (e.key === 'Escape') {
        e.preventDefault()
        closePost()
      } else if (e.key === ' ' && video.current) {
        // Space presses a focused button only when it was reached with Tab.
        if (tabbed && (e.target as HTMLElement).closest?.('button, a')) return
        e.preventDefault()
        video.current.toggle()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && step.current) {
        e.preventDefault()
        step.current(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const items = postMenuItems(post, author)
  const toAuthor = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!author || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    closePost()
    navigate(`/u/${author.handle}`)
  }

  return (
    <div className="viewer" onPointerDown={(e) => e.target === e.currentTarget && closePost()}>
      <div ref={root} className="viewer-panel" role="dialog" aria-modal="true" aria-label={author ? displayName(author) : 'Post'}>
        <div className="viewer-head">
          {author ? (
            <a href={href(`/u/${author.handle}`)} className="viewer-author" onClick={toAuthor}>
              <PersonAvatar person={author} size={32} />
              <span className="ellipsis">{displayName(author)}</span>
            </a>
          ) : (
            <span className="viewer-author" />
          )}
          {items.length > 0 && <IconButton icon="more" label="More" onClick={(e) => openMenu(e.currentTarget, postMenuItems(post, author))} />}
          <IconButton icon="close" label="Close" className="viewer-close" onClick={closePost} />
        </div>
        <div className="viewer-body">
          {post.video ? (
            <VideoView video={post.video} reduced={reduced} controls={video} />
          ) : post.images.length ? (
            <Images urls={post.images} reduced={reduced} step={step} />
          ) : null}
          {post.text.trim() && <p className={`viewer-text${post.video || post.images.length ? '' : ' alone'}`}>{post.text}</p>}
          {post.song && (
            <div className="viewer-song">
              <SongRow song={post.song} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Video ────────────────────────────────────────────────────────────────

interface VideoControls {
  toggle: () => void
}

function VideoView({ video, reduced, controls }: { video: NonNullable<Post['video']>; reduced: boolean; controls: { current: VideoControls | null } }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [failed, setFailed] = useState(false)
  // A tap is needed (reduced motion, or the browser refused to start it): the poster and a Play button.
  const [waiting, setWaiting] = useState(reduced)

  const start = () => {
    const el = ref.current
    if (!el) return
    setWaiting(false)
    el.play().catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') setWaiting(true)
      else if (e.name !== 'AbortError') setFailed(true)
    })
  }
  const toggle = () => {
    const el = ref.current
    if (!el || failed) return
    if (el.paused) start()
    else el.pause()
  }
  controls.current = { toggle }
  useEffect(() => {
    if (!reduced) start()
    return () => {
      controls.current = null
    }
  }, [])

  const sound = () => {
    const el = ref.current
    if (!el) return
    if (el.muted) {
      pauseForSound()
      el.muted = false
      setMuted(false)
      if (el.paused) start()
    } else {
      el.muted = true
      setMuted(true)
    }
  }
  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (e.currentTarget.error) setFailed(true)
  }

  return (
    <div className="viewer-video">
      <video
        ref={ref}
        poster={video.still}
        src={video.url}
        playsInline
        muted
        loop
        preload="metadata"
        disablePictureInPicture
        disableRemotePlayback
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={onError}
      />
      {failed ? (
        <span className="viewer-center viewer-failed" role="img" aria-label="Can't Play">
          <Icon name="alert" size={36} />
        </span>
      ) : (
        <>
          {waiting && !playing && (
            <button type="button" className="viewer-center viewer-play" aria-label="Play" onClick={start}>
              <Icon name="play" size={30} />
            </button>
          )}
          <IconButton icon={muted ? 'volume-off' : 'volume-high'} label={muted ? 'Unmute' : 'Mute'} size={20} className="viewer-sound" onClick={sound} />
        </>
      )}
    </div>
  )
}

// ── Images ───────────────────────────────────────────────────────────────

/** One image per view, swiped (scroll snap); dots below, and Previous and Next where there is a pointer. */
function Images({ urls, reduced, step }: { urls: string[]; reduced: boolean; step: { current: ((by: number) => void) | null } }) {
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [ratio, setRatio] = useState<number>()
  const go = (i: number) => {
    const el = strip.current
    if (!el) return
    const to = Math.max(0, Math.min(urls.length - 1, i))
    el.scrollTo({ left: to * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
  }
  step.current = urls.length > 1 ? (by) => go(index + by) : null
  useEffect(
    () => () => {
      step.current = null
    },
    [],
  )
  const onScroll = () => {
    const el = strip.current
    if (el?.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  // The strip takes the first image's shape (between 3:4 and 16:9); others fit inside it.
  const first = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w && h) setRatio(Math.min(16 / 9, Math.max(3 / 4, w / h)))
  }
  return (
    <div className="viewer-images">
      <div ref={strip} className="viewer-strip" style={ratio ? { aspectRatio: String(ratio) } : undefined} onScroll={onScroll}>
        {urls.map((url, i) => (
          <div key={i} className="viewer-slide">
            <img src={url} alt="" draggable={false} decoding="async" onLoad={i === 0 ? first : undefined} onError={(e) => (e.currentTarget.style.opacity = '0')} />
          </div>
        ))}
      </div>
      {urls.length > 1 && (
        <>
          {index > 0 && <IconButton icon="chevron-right" label="Previous Image" size={20} className="viewer-step viewer-prev" onClick={() => go(index - 1)} />}
          {index < urls.length - 1 && <IconButton icon="chevron-right" label="Next Image" size={20} className="viewer-step viewer-next" onClick={() => go(index + 1)} />}
          <div className="viewer-dots" aria-hidden="true">
            {urls.map((_, i) => (
              <i key={i} className={i === index ? 'on' : undefined} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
