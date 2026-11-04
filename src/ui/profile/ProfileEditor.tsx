// The profile editor: one draft, a live preview, and seven sections. Phones show the sections as tabs over a
// tray under the preview; desktop stacks them beside it. Done saves the draft; Cancel throws it away.
// A Profile | Settings switch in the header shows the app's settings instead (Settings.tsx); they apply at once.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MAX_PINNED_PLAYLISTS, PROFILE_SLOTS, saveProfile, useLibrary, type ProfileSlot } from '../../lib/library.ts'
import { errorLabel, processMedia, type Media } from '../../lib/media.ts'
import type { Crop, EffectId, FrameId, NameStyleId, Profile } from '../../types.ts'
import { CropImg, PlaylistArt, TrackArt } from '../Art.tsx'
import { GifMaker } from '../GifMaker.tsx'
import { Icon } from '../Icon.tsx'
import { IconButton, pickFiles } from '../kit.tsx'
import { openMenu, type MenuItem } from '../Menu.tsx'
import { colorsOf, PRESETS, profileColors } from './colors.ts'
import { Effect } from './Effect.tsx'
import { EFFECTS } from './effects.ts'
import { Frame } from './Frame.tsx'
import { FRAMES } from './frames.ts'
import { ImageCrop } from './ImageCrop.tsx'
import { NAME_STYLES, NameStyle } from './NameStyle.tsx'
import { ProfileCard, useReducedMotion } from './ProfileCard.tsx'
import { Segmented } from '../Segmented.tsx'
import { Settings } from '../Settings.tsx'
import { useSavedMedia, type CardMedia, type ShownMedia } from './ProfileMedia.tsx'
import '../../styles/profile.css'

const TABS = ['Images', 'Colors', 'Frame', 'Effect', 'Name', 'Bio', 'Pinned'] as const
type Tab = (typeof TABS)[number]
/** Where the editor opens: the profile (on a section) or the settings. */
export type EditorStart = 'Profile' | 'Pinned' | 'Settings'
const PAGES = ['Profile', 'Settings'] as const

const SLOT_LABEL: Record<ProfileSlot, string> = { avatar: 'Avatar', banner: 'Banner', backdrop: 'Background' }
const PRESET_NAMES = ['Pink', 'Sky', 'Lime', 'Ember', 'Rose', 'Honey', 'Mint', 'Lavender', 'Silver', 'Midnight']
const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

type Pick = Media & { shown: ShownMedia }
type Picks = Partial<Record<ProfileSlot, Pick | null>>

const wide = () => matchMedia('(min-width: 900px)')

function useWide(): boolean {
  const [is, setIs] = useState(() => wide().matches)
  useEffect(() => {
    const query = wide()
    const on = () => setIs(query.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [])
  return is
}

function showMedia(media: Media): ShownMedia {
  return { url: URL.createObjectURL(media.blob), still: media.still && URL.createObjectURL(media.still), kind: media.kind }
}

function revoke(pick: Pick | null | undefined) {
  if (!pick) return
  URL.revokeObjectURL(pick.shown.url)
  if (pick.shown.still) URL.revokeObjectURL(pick.shown.still)
}

const stillOf = (m?: ShownMedia) => (m ? (m.kind === 'image' ? m.url : (m.still ?? m.url)) : undefined)

/** The avatar's still, or the initial, as the frame tiles show it. */
function Photo({ media, name, crop }: { media?: ShownMedia; name: string; crop?: Crop }) {
  const src = stillOf(media)
  const initial = name.trim().charAt(0).toUpperCase()
  return <span className="pe-photo crop-box">{src ? <CropImg src={src} crop={crop} /> : initial ? <b>{initial}</b> : <Icon name="user" size={28} />}</span>
}

// ── Sections ─────────────────────────────────────────────────────────────

interface SectionProps {
  draft: Profile
  change: (patch: Partial<Profile>) => void
  media: CardMedia
  live: boolean
}

interface ImagesProps {
  draft: Profile
  media: CardMedia
  errors: Partial<Record<ProfileSlot, string>>
  choose: (slot: ProfileSlot) => void
  adjust: (slot: ProfileSlot) => void
  remove: (slot: ProfileSlot) => void
}

function Images({ draft, media, errors, choose, adjust, remove }: ImagesProps) {
  const open = (slot: ProfileSlot, el: HTMLElement) => {
    const items: MenuItem[] = [{ label: 'Choose', icon: 'image', onSelect: () => choose(slot) }]
    if (media[slot]) {
      items.push({ label: 'Adjust', icon: 'crop', onSelect: () => adjust(slot) })
      items.push({ label: 'Remove', icon: 'trash', danger: true, onSelect: () => remove(slot) })
    }
    openMenu(el, items)
  }
  return (
    <div className="pe-tiles">
      {PROFILE_SLOTS.map((slot) => {
        const src = stillOf(media[slot])
        const error = errors[slot]
        return (
          <button key={slot} type="button" className={`pe-tile pe-tile-${slot}${error ? ' error' : ''}`} onClick={(e) => open(slot, e.currentTarget)}>
            <span className="pe-thumb crop-box">{src ? <CropImg src={src} crop={draft[`${slot}Crop`]} /> : <Icon name="plus" size={20} />}</span>
            <span className="pe-tile-label">{error ?? SLOT_LABEL[slot]}</span>
          </button>
        )
      })}
    </div>
  )
}

function Colors({ draft, change }: SectionProps) {
  const pair = colorsOf(draft)
  const auto = draft.autoColors
  const [top, bottom] = draft.colors ?? pair ?? ['#a596ff', '#1e1e22']
  const swatch = (a: string, b: string) => ({ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` })
  return (
    <div className="pe-colors">
      <div className="pe-scroller pe-swatches">
        <button
          type="button"
          className={`pe-swatch pe-auto${draft.colors ? '' : ' on'}`}
          aria-label="Auto"
          aria-pressed={!draft.colors}
          style={auto ? swatch(auto[0], auto[1]) : undefined}
          onClick={() => change({ colors: undefined })}
        >
          <Icon name="sparkles" size={18} />
        </button>
        {PRESETS.map(([a, b], i) => {
          const on = draft.colors?.[0] === a && draft.colors?.[1] === b
          return <button key={a} type="button" className={`pe-swatch${on ? ' on' : ''}`} aria-label={PRESET_NAMES[i]} aria-pressed={on} style={swatch(a, b)} onClick={() => change({ colors: [a, b] })} />
        })}
      </div>
      <div className="pe-wells">
        <label className="pe-well" style={{ background: top }}>
          <input type="color" aria-label="Top Color" value={top} onChange={(e) => change({ colors: [e.target.value, bottom] })} />
        </label>
        <label className="pe-well" style={{ background: bottom }}>
          <input type="color" aria-label="Bottom Color" value={bottom} onChange={(e) => change({ colors: [top, e.target.value] })} />
        </label>
      </div>
    </div>
  )
}

function Frames({ draft, change, media, live }: SectionProps) {
  const pickFrame = (frame?: FrameId) => change({ frame })
  return (
    <div className="pe-scroller pe-frames">
      <button type="button" className={`pe-frame${draft.frame ? '' : ' on'}`} aria-label="No Frame" aria-pressed={!draft.frame} onClick={() => pickFrame(undefined)}>
        <span className="pe-av">
          <Photo media={media.avatar} name={draft.name} crop={draft.avatarCrop} />
        </span>
      </button>
      {FRAMES.map((id) => (
        <button key={id} type="button" className={`pe-frame${draft.frame === id ? ' on' : ''}`} aria-label={title(id)} aria-pressed={draft.frame === id} onClick={() => pickFrame(id)}>
          <span className="pe-av">
            <Photo media={media.avatar} name={draft.name} crop={draft.avatarCrop} />
            <Frame id={id} live={live && draft.frame === id} />
          </span>
        </button>
      ))}
    </div>
  )
}

function Effects({ draft, change, restart }: SectionProps & { restart: () => void }) {
  const pickEffect = (effect?: EffectId) => {
    change({ effect })
    restart()
  }
  return (
    <div className="pe-scroller pe-effects">
      <button type="button" className={`pe-effect${draft.effect ? '' : ' on'}`} aria-label="No Effect" aria-pressed={!draft.effect} onClick={() => pickEffect(undefined)}>
        <Icon name="none" size={22} />
      </button>
      {EFFECTS.map((id) => (
        <button key={id} type="button" className={`pe-effect${draft.effect === id ? ' on' : ''}`} aria-label={title(id)} aria-pressed={draft.effect === id} onClick={() => pickEffect(id)}>
          <Effect id={id} live={false} still />
        </button>
      ))}
    </div>
  )
}

function Name({ draft, change }: SectionProps) {
  const shown = draft.name.trim() || 'You'
  const styles: (NameStyleId | undefined)[] = [undefined, ...NAME_STYLES]
  return (
    <div className="pe-name">
      <input
        className="pe-field"
        aria-label="Name"
        value={draft.name}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => change({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="pe-scroller pe-styles">
        {styles.map((style) => (
          <button
            key={style ?? 'default'}
            type="button"
            className={`pe-style${draft.nameStyle === style ? ' on' : ''}`}
            aria-label={style ? title(style) : 'Default'}
            aria-pressed={draft.nameStyle === style}
            onClick={() => change({ nameStyle: style })}
          >
            <NameStyle name={shown} style={style} rest />
          </button>
        ))}
      </div>
    </div>
  )
}

function Bio({ draft, change }: SectionProps) {
  return <textarea className="pe-field pe-bio" aria-label="Bio" rows={4} maxLength={190} value={draft.bio ?? ''} onChange={(e) => change({ bio: e.target.value })} />
}

function PinnedSection({ draft, change }: SectionProps) {
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const songs = (draft.pinnedSongs ?? []).filter((id) => tracks[id])
  const chosen = draft.pinnedPlaylists ?? []
  const full = chosen.length >= MAX_PINNED_PLAYLISTS
  const toggle = (id: string) =>
    change({ pinnedPlaylists: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(0, MAX_PINNED_PLAYLISTS) })
  return (
    <div className="pe-pinned">
      {songs.length > 0 && (
        <ul className="pe-list">
          {songs.map((id) => (
            <li key={id} className="pe-row">
              <TrackArt track={tracks[id]} size={36} />
              <span className="ellipsis">{tracks[id].title}</span>
              <IconButton icon="remove" label="Unpin" size={20} onClick={() => change({ pinnedSongs: songs.filter((x) => x !== id) })} />
            </li>
          ))}
        </ul>
      )}
      {playlists.length > 0 && (
        <ul className="pe-list">
          {playlists.map((p) => {
            const on = chosen.includes(p.id)
            return (
              <li key={p.id}>
                <button type="button" className={`pe-row pe-check${on ? ' on' : ''}`} disabled={full && !on} aria-pressed={on} onClick={() => toggle(p.id)}>
                  <PlaylistArt playlist={p} size={36} />
                  <span className="ellipsis">{p.name}</span>
                  <span className="pe-checkmark">{on && <Icon name="tick" size={18} />}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── The sheet ────────────────────────────────────────────────────────────

export function ProfileEditor({ onClose, start = 'Profile' }: { onClose: () => void; start?: EditorStart }) {
  const stored = useLibrary((s) => s.profile)
  const [draft, setDraft] = useState<Profile>(() => ({ ...stored }))
  const [picks, setPicks] = useState<Picks>({})
  const [errors, setErrors] = useState<Partial<Record<ProfileSlot, string>>>({})
  const [tab, setTab] = useState<Tab>(start === 'Pinned' ? 'Pinned' : 'Images')
  const [page, setPage] = useState<(typeof PAGES)[number]>(start === 'Settings' ? 'Settings' : 'Profile')
  const [gif, setGif] = useState<{ file: File; slot: 'avatar' | 'banner' }>()
  // The crop sheet: for a new pick (not yet in `picks`) or for the slot's current media.
  const [cropping, setCropping] = useState<{ slot: ProfileSlot; shown: ShownMedia; pick?: Media; aspect: number }>()
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [effectRun, setEffectRun] = useState(0)
  const isWide = useWide()
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  const previewRef = useRef<HTMLDivElement>(null)
  const picksRef = useRef(picks)
  picksRef.current = picks
  const timers = useRef(new Map<ProfileSlot, number>())

  const saved = useSavedMedia(stored)
  const media: CardMedia = { ...saved }
  for (const slot of PROFILE_SLOTS) {
    const pick = picks[slot]
    if (pick === null) delete media[slot]
    else if (pick) media[slot] = pick.shown
  }

  const live = visible && !reduced && !gif && !cropping && !closing

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Object URLs of picks that were never saved (or never left the crop sheet).
  const croppingRef = useRef(cropping)
  croppingRef.current = cropping
  useEffect(
    () => () => {
      PROFILE_SLOTS.forEach((slot) => revoke(picksRef.current[slot]))
      const pending = croppingRef.current
      if (pending?.pick) revoke({ ...pending.pick, shown: pending.shown })
    },
    [],
  )

  const change = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }))

  const close = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, reduced ? 120 : 260)
  }

  const fail = (slot: ProfileSlot, error: unknown) => {
    setErrors((e) => ({ ...e, [slot]: errorLabel(error) }))
    clearTimeout(timers.current.get(slot))
    timers.current.set(
      slot,
      window.setTimeout(() => setErrors((e) => ({ ...e, [slot]: undefined })), 3000),
    )
  }

  const use = (slot: ProfileSlot, media: Media, shown = showMedia(media)) =>
    setPicks((p) => {
      revoke(p[slot])
      return { ...p, [slot]: { ...media, shown } }
    })

  /** The frame's width / height in the crop sheet: the Background takes the preview card's shape. */
  const frameAspect = (slot: ProfileSlot) => {
    if (slot === 'avatar') return 1
    if (slot === 'banner') return 3
    const card = previewRef.current?.querySelector('.pc')?.getBoundingClientRect()
    return card && card.height ? card.width / card.height : 0.5
  }

  const adjust = (slot: ProfileSlot) => {
    const shown = media[slot]
    if (shown) setCropping({ slot, shown, aspect: frameAspect(slot) })
  }

  // A GIF from the GIF maker is already cropped to the slot's shape: it goes straight in, centered. Anything else
  // opens the crop sheet first.
  const take = (slot: ProfileSlot, file: Blob, made?: boolean) =>
    processMedia(file, slot, { made }).then(
      (m) => {
        if (made) {
          use(slot, m)
          change({ [`${slot}Crop`]: undefined })
        } else setCropping({ slot, shown: showMedia(m), pick: m, aspect: frameAspect(slot) })
      },
      (error) => fail(slot, error),
    )

  const cropDone = (crop: Crop | undefined) => {
    if (!cropping) return
    const { slot, pick, shown } = cropping
    if (pick) use(slot, pick, shown)
    change({ [`${slot}Crop`]: crop })
    setCropping(undefined)
  }

  const cropCancel = () => {
    if (cropping?.pick) revoke({ ...cropping.pick, shown: cropping.shown })
    setCropping(undefined)
  }

  // Called from the menu item's click, so the picker opens inside the user's tap (iOS needs it).
  const choose = (slot: ProfileSlot) => {
    const accept = slot === 'backdrop' ? 'image/*,video/mp4,video/quicktime,video/webm' : 'image/*,video/*'
    void pickFiles(accept).then(([file]) => {
      if (!file) return
      if (file.type.startsWith('video/') && slot !== 'backdrop') setGif({ file, slot })
      else void take(slot, file)
    })
  }

  const remove = (slot: ProfileSlot) => {
    change({ [`${slot}Crop`]: undefined })
    setPicks((p) => {
      revoke(p[slot])
      // Removing a pick that replaced nothing just drops the pick.
      return { ...p, [slot]: saved[slot] ? null : undefined }
    })
  }

  const done = async () => {
    if (busy) return
    setBusy(true)
    const changed: Partial<Record<ProfileSlot, Media | null>> = {}
    for (const slot of PROFILE_SLOTS) if (picks[slot] !== undefined) changed[slot] = picks[slot] && { blob: picks[slot].blob, still: picks[slot].still, kind: picks[slot].kind }
    try {
      await saveProfile(draft, changed)
      close()
    } catch (error) {
      setBusy(false)
      setPage('Profile')
      setTab('Images')
      // Writes fail when storage is full.
      fail(PROFILE_SLOTS.find((s) => picks[s]) ?? 'avatar', new DOMException(String(error), 'QuotaExceededError'))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu or a sheet over the editor (Sign In, YouTube, Reports) takes Escape for itself.
      if (e.key !== 'Escape' || gif || cropping || document.querySelector('.menu, .sheet-scrim')) return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Opened on Pinned (a Board section's Edit): desktop stacks every section, so bring that one into view.
  useEffect(() => {
    if (start === 'Pinned' && isWide) document.querySelector('.pe-section-pinned')?.scrollIntoView({ block: 'start' })
  }, [])

  const props: SectionProps = { draft, change, media, live }
  const section = (which: Tab) => {
    switch (which) {
      case 'Images':
        return <Images draft={draft} media={media} errors={errors} choose={choose} adjust={adjust} remove={remove} />
      case 'Colors':
        return <Colors {...props} />
      case 'Frame':
        return <Frames {...props} />
      case 'Effect':
        return <Effects {...props} restart={() => setEffectRun((n) => n + 1)} />
      case 'Name':
        return <Name {...props} />
      case 'Bio':
        return <Bio {...props} />
      case 'Pinned':
        return <PinnedSection {...props} />
    }
  }

  const vars = profileColors(draft, !!media.backdrop) as CSSProperties
  return (
    <div className={`pe-scrim${isWide ? ' wide' : ''}${closing ? ' closing' : ''}`} onPointerDown={(e) => isWide && e.target === e.currentTarget && close()}>
      <div className={`pe${isWide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label="Edit Profile" style={vars}>
        <header className="pe-head">
          <button type="button" className="pe-cancel" onClick={close}>
            Cancel
          </button>
          <Segmented label="Edit" className="pe-pages" options={PAGES} value={page} onChange={setPage} render={(p) => ({ content: p })} />
          <button type="button" className="pe-done" onClick={() => void done()} disabled={busy}>
            Done
          </button>
        </header>
        {page === 'Settings' ? (
          <div className="pe-settings">
            <Settings />
          </div>
        ) : (
          <div className="pe-main">
            {isWide && (
              <div className="pe-sections">
                {TABS.map((which) => (
                  <section key={which} className={`pe-section pe-section-${which.toLowerCase()}`}>
                    <h3>{which}</h3>
                    {section(which)}
                  </section>
                ))}
              </div>
            )}
            <div className="pe-preview" ref={previewRef}>
              <div className="pe-card" inert>
                <ProfileCard profile={draft} media={media} live={live} effectRun={effectRun} claimsVideo />
              </div>
            </div>
            {!isWide && (
              <>
                <nav className="pe-tabs" role="tablist">
                  {TABS.map((which) => (
                    <button key={which} type="button" role="tab" aria-selected={tab === which} className={`pe-chip${tab === which ? ' on' : ''}`} onClick={() => setTab(which)}>
                      {which}
                    </button>
                  ))}
                </nav>
                <div className={`pe-tray pe-tray-${tab.toLowerCase()}`} role="tabpanel">
                  {section(tab)}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {gif && (
        <GifMaker
          file={gif.file}
          aspect={gif.slot === 'avatar' ? 1 : 3}
          onDone={(blob) => {
            const slot = gif.slot
            setGif(undefined)
            void take(slot, blob, true)
          }}
          onCancel={() => setGif(undefined)}
        />
      )}
      {cropping && (
        <ImageCrop
          key={cropping.shown.url}
          slot={cropping.slot}
          media={cropping.shown}
          crop={cropping.pick ? undefined : draft[`${cropping.slot}Crop`]}
          aspect={cropping.aspect}
          onDone={cropDone}
          onCancel={cropCancel}
        />
      )}
    </div>
  )
}
