// New Post: text, then up to 4 images or one video, then the song that's playing (off until tapped). Each pick is
// processed at once (lib/posting.ts prepareMedia); the Post button shows the upload's progress, and a failure's one
// word for a moment. Closing while it posts stops the upload and removes what went up.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorLabel, type Media } from '../lib/media.ts'
import { useCurrentTrack } from '../lib/player.ts'
import { choosePicks, postErrorLabel, prepareMedia, publish, sweepOrphans } from '../lib/posting.ts'
import { uid } from '../lib/format.ts'
import { TrackArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton, pickFiles } from './kit.tsx'
import { Ring } from './Ring.tsx'
import { Sheet } from './Sheet.tsx'
import '../styles/social.css'

interface Pick {
  id: string
  video: boolean
  /** What the thumbnail shows (an object URL): the picked image at once, then the processed one; a video's still. */
  preview?: string
  media?: Media
  error?: string
}

const ANY = 'image/*,video/mp4,video/quicktime,video/webm'
const ERROR_MS = 2500

export function Composer({ onClose }: { onClose: () => void }) {
  const track = useCurrentTrack()
  const [text, setText] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [withSong, setWithSong] = useState(false)
  const [progress, setProgress] = useState<number | null>(null) // posting: sent / total
  const [failure, setFailure] = useState<string>()
  const field = useRef<HTMLTextAreaElement>(null)
  const abort = useRef<AbortController | null>(null)
  const urls = useRef(new Set<string>())

  useEffect(() => {
    void sweepOrphans()
    field.current?.focus({ preventScroll: true })
    const made = urls.current
    return () => {
      abort.current?.abort()
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    if (!failure) return
    const timer = setTimeout(() => setFailure(undefined), ERROR_MS)
    return () => clearTimeout(timer)
  }, [failure])

  const urlOf = (blob: Blob) => {
    const url = URL.createObjectURL(blob)
    urls.current.add(url)
    return url
  }
  const update = (id: string, change: Partial<Pick>) => setPicks((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)))

  const video = picks.find((p) => p.video)
  const images = picks.length - (video ? 1 : 0)
  const busy = picks.some((p) => !p.media && !p.error)
  const failed = picks.some((p) => p.error)
  const tooLong = text.length > (video ? 300 : 1000)
  const posting = progress !== null
  const ready = (!!text.trim() || picks.some((p) => p.media)) && !busy && !failed && !tooLong

  const add = async () => {
    const files = await pickFiles(picks.length ? 'image/*' : ANY, true)
    const chosen = choosePicks(files, { images, video: !!video })
    if (!chosen.length) return
    const added = chosen.map((file): Pick & { file: File } => {
      const isVideo = file.type.startsWith('video/')
      return { id: uid(), video: isVideo, preview: isVideo ? undefined : urlOf(file), file }
    })
    setPicks((all) => [...all, ...added.map(({ file: _, ...p }) => p)])
    for (const { id, file } of added)
      void prepareMedia(file).then(
        (media) => update(id, { media, preview: urlOf(media.kind === 'video' && media.still ? media.still : media.blob) }),
        (error) => update(id, { error: errorLabel(error) }),
      )
  }

  const remove = (id: string) => setPicks((all) => all.filter((p) => p.id !== id))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || posting) return
    const controller = new AbortController()
    abort.current = controller
    setFailure(undefined)
    setProgress(0)
    try {
      await publish(
        { text, media: picks.flatMap((p) => (p.media ? [p.media] : [])), track: withSong && track ? track : undefined },
        { signal: controller.signal, onProgress: (sent, total) => setProgress(total ? sent / total : 0) },
      )
      if (!controller.signal.aborted) onClose()
    } catch (error) {
      if (controller.signal.aborted) return
      setProgress(null)
      setFailure(postErrorLabel(error))
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <Sheet title="New Post" as="form" className="composer" onClose={onClose} onSubmit={submit}>
      <label className={`sheet-field compose-text${tooLong ? ' wrong' : ''}`}>
        <textarea
          ref={field}
          aria-label="Text"
          aria-invalid={tooLong || undefined}
          maxLength={video ? 300 : 1000}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            grow(e.target)
          }}
        />
      </label>
      {(picks.length > 0 || !posting) && (
        <div className="compose-media">
          {picks.map((p) => (
            <div key={p.id} className={`compose-thumb${p.error ? ' failed' : ''}`}>
              {p.preview && !p.error && <img src={p.preview} alt="" draggable={false} />}
              {p.video && !p.error && (
                <span className="post-badge post-badge-top" aria-hidden="true">
                  <Icon name="film" size={14} />
                </span>
              )}
              {!p.media && !p.error && <span className="spinner compose-busy" aria-label="Processing" />}
              {p.error && <span className="compose-error">{p.error}</span>}
              {!posting && <IconButton icon="close" label="Remove" size={14} className="compose-remove" onClick={() => remove(p.id)} />}
            </div>
          ))}
          {!video && images < 4 && !posting && <IconButton icon="plus" label="Add Photo or Video" size={24} className="compose-add" onClick={() => void add()} />}
        </div>
      )}
      {track && (
        <button type="button" className="compose-song" aria-pressed={withSong} disabled={posting} onClick={() => setWithSong((on) => !on)}>
          <TrackArt track={track} size={32} />
          <span className="ellipsis">{track.title}</span>
        </button>
      )}
      <button
        type="submit"
        className={`pill primary sheet-submit${failure ? ' failed' : ''}`}
        disabled={!ready && !posting && !failure}
        aria-label={posting ? 'Posting' : undefined}
        aria-busy={posting || undefined}
      >
        {posting ? <Ring progress={progress} size={20} /> : (failure ?? 'Post')}
      </button>
    </Sheet>
  )
}
