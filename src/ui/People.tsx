// People: the nameplate (the sidebar's, and each row of a Following or Followers list), a person as a card (Search),
// the faces on a song friends played, the Following and Followers sheet, and a profile's More menu.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { profileLink } from '../lib/account.ts'
import { ban, removeProfile } from '../lib/moderation.ts'
import { currentMe, isOnline, loadFollows, report, useSocial, type Person } from '../lib/social.ts'
import { REPORT_REASONS, type NameStyleId, type ReportReason } from '../types.ts'
import { PersonAvatar } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { Link } from './kit.tsx'
import type { MenuItem } from './Menu.tsx'
import { profileColors } from './profile/colors.ts'
import { NameStyle } from './profile/NameStyle.tsx'
import { Sentinel } from './Shelf.tsx'
import { Sheet } from './Sheet.tsx'
import '../styles/profile.css'
import '../styles/social.css'

/** What a nameplate shows: your profile, or someone's (`handle` stands in for a blank name). */
export interface PlatePerson {
  name: string
  handle?: string
  nameStyle?: NameStyleId
  colors?: [string, string]
  autoColors?: [string, string]
}

/** A blank name has no style. */
const styleOf = (person: PlatePerson) => (person.name.trim() ? person.nameStyle : undefined)

/** The classes of the element the plate rests on (the sidebar link, a list row): its style's plate, if any. */
export const plateClass = (person: PlatePerson) => {
  const style = styleOf(person)
  return style ? ` plate plate-${style}` : ''
}

/** The name in its style, at rest, in the person's profile colors; `children` (an avatar) come first. */
export function Nameplate({ person, children }: { person: PlatePerson; children?: ReactNode }) {
  const name = person.name.trim() || (person.handle ? `@${person.handle}` : 'You')
  return (
    <span className="nameplate" style={profileColors(person, false) as CSSProperties}>
      {children}
      <NameStyle name={name} style={styleOf(person)} rest className="ns-plate" />
    </span>
  )
}

/** The name a list shows: the name, else @handle. */
export const displayName = (person: Pick<Person, 'name' | 'handle'>) => person.name.trim() || `@${person.handle}`

/** Someone as a card (Search's Luma row): their photo filling the card, round, and their name. */
export function PersonCard({ person }: { person: Person }) {
  return (
    <Link to={`/u/${person.handle}`} className="card person-card">
      <PersonAvatar person={person} />
      <span className="card-title ellipsis">{displayName(person)}</span>
    </Link>
  )
}

/** Up to 3 friends who played a song, over its thumbnail's lower left. Anyone not loaded is skipped. */
export function Faces({ ids }: { ids: readonly string[] }) {
  const people = useSocial((s) => s.people)
  const shown = ids.flatMap((id) => (people[id] ? [people[id]] : [])).slice(0, 3)
  if (!shown.length) return null
  return (
    <span className="faces" aria-hidden="true">
      {shown.map((p) => (
        <PersonAvatar key={p.id} person={p} size={22} />
      ))}
    </span>
  )
}

// ── Following and Followers ──────────────────────────────────────────────

type Which = 'following' | 'followers'

/** Who someone follows, or who follows them: rows of a photo and a nameplate, 50 at a time. Anyone may look. */
export function PeopleSheet({ userId, which, onClose }: { userId: string; which: Which; onClose: () => void }) {
  const [list, setList] = useState<{ people: Person[]; done: boolean } | null | undefined>()
  const [from, setFrom] = useState(0)
  useEffect(() => {
    let live = true
    void loadFollows(userId, which, from).then((page) => {
      if (!live) return
      setList((old) => {
        if (!page) return from ? old && { ...old, done: true } : null
        if (!from || !old) return page
        const seen = new Set(old.people.map((p) => p.id))
        return { people: [...old.people, ...page.people.filter((p) => !seen.has(p.id))], done: page.done }
      })
    })
    return () => {
      live = false
    }
  }, [userId, which, from])

  return (
    <Sheet title={which === 'following' ? 'Following' : 'Followers'} onClose={onClose} className="people-sheet">
      {list === undefined ? (
        <div className="sheet-state">
          <span className="spinner" aria-label="Loading" />
        </div>
      ) : !list?.people.length ? (
        <div className="sheet-state" role="img" aria-label="No One">
          <Icon name="user" size={40} />
        </div>
      ) : (
        <ul className="sheet-list">
          {list.people.map((p) => (
            <li key={p.id}>
              <Link to={`/u/${p.handle}`} className={`sheet-row person-row${plateClass(p)}`}>
                <PersonAvatar person={p} size={40} />
                <Nameplate person={p} />
              </Link>
            </li>
          ))}
          {!list.done && (
            <li>
              <Sentinel key={list.people.length} onNear={() => setFrom(list.people.length)} />
            </li>
          )}
        </ul>
      )}
    </Sheet>
  )
}

// ── A profile's More menu ────────────────────────────────────────────────

const REASON_LABELS: Record<ReportReason, string> = { spam: 'Spam', abuse: 'Abuse', explicit: 'Explicit', copyright: 'Copyright', other: 'Other' }

/** The five report reasons, as a submenu. */
export const reasonItems = (onPick: (reason: ReportReason) => void): MenuItem[] =>
  REPORT_REASONS.map((reason) => ({ label: REASON_LABELS[reason], onSelect: () => onPick(reason) }))

/** Share a profile: the share sheet, else the clipboard. */
export async function shareProfile(handle: string): Promise<void> {
  const url = profileLink(handle)
  try {
    if (navigator.share) return await navigator.share({ url })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
  }
  await navigator.clipboard?.writeText(url).catch(() => {})
}

/**
 * A profile's More menu: Share Profile; Following and Followers (online); Report (a member, on someone else's
 * profile they haven't reported); Remove Profile and Ban (an admin, on someone else's). `onChange` runs after a
 * removal or a ban, so the page can load the profile again.
 */
export function profileMenuItems({
  person,
  self,
  onPeople,
  onChange,
}: {
  person: Person
  self: boolean
  onPeople: (which: Which) => void
  onChange?: () => void
}): MenuItem[] {
  const me = currentMe()
  const items: MenuItem[] = [{ label: 'Share Profile', icon: 'share', onSelect: () => void shareProfile(person.handle) }]
  if (isOnline())
    items.push(
      { label: 'Following', icon: 'user', onSelect: () => onPeople('following') },
      { label: 'Followers', icon: 'user', onSelect: () => onPeople('followers') },
    )
  if (!me || self) return items
  if (!me.admin) {
    if (!useSocial.getState().hidden.has(`profile:${person.id}`))
      items.push({ label: 'Report', icon: 'flag', items: reasonItems((reason) => void report('profile', person.id, reason)) })
    return items
  }
  items.push({
    label: 'Remove Profile',
    icon: 'trash',
    danger: true,
    items: [{ label: 'Remove Profile', icon: 'trash', danger: true, onSelect: () => void removeProfile(person.id).then((ok) => ok && onChange?.()) }],
  })
  // Banned people too: a ban that failed part-way (their posts or files still there) runs again from here.
  if (!person.admin)
    items.push({
      label: 'Ban',
      icon: 'none',
      danger: true,
      items: [{ label: `Ban @${person.handle}`, icon: 'none', danger: true, onSelect: () => void ban(person.id).then((ok) => ok && onChange?.()) }],
    })
  return items
}
