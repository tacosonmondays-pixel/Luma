// Reports, for admins: one row per reported profile, post or video, newest first, with its reasons. Actions are
// optimistic: the row folds away at once and comes back (shaking) if the server refuses.
import { useEffect, useState } from 'react'
import { ban, dismiss, loadReports, removeContent, removeProfile, type ReportGroup } from '../lib/moderation.ts'
import { navigate } from '../lib/router.ts'
import { useSocial } from '../lib/social.ts'
import { openPost } from '../lib/viewer.ts'
import { PersonAvatar } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { IconButton } from './kit.tsx'
import { openMenu, type MenuItem } from './Menu.tsx'
import { Sheet } from './Sheet.tsx'
import type { ReportReason } from '../types.ts'
import '../styles/social.css'

const REASONS: Record<ReportReason, string> = { spam: 'Spam', abuse: 'Abuse', explicit: 'Explicit', copyright: 'Copyright', other: 'Other' }

type RowState = 'leaving' | 'gone' | 'wrong'

export function ReportsSheet({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<ReportGroup[] | null | undefined>()
  const [states, setStates] = useState<Record<string, RowState>>({})
  const hidden = useSocial((s) => s.hidden)
  const people = useSocial((s) => s.people)

  useEffect(() => {
    let live = true
    void loadReports().then((g) => live && setGroups(g))
    return () => {
      live = false
    }
  }, [])

  const mark = (key: string, state?: RowState) =>
    setStates((all) => {
      const next = { ...all }
      if (state) next[key] = state
      else delete next[key]
      return next
    })

  // Focus the action took away (its row's buttons were disabled, then went) moves to the first row left, else the sheet.
  const keepFocus = () =>
    requestAnimationFrame(() => {
      const now = document.activeElement
      if (now && now !== document.body && now.isConnected && !(now as HTMLButtonElement).disabled) return
      const sheet = document.querySelector<HTMLElement>('.reports-sheet')
      ;(sheet?.querySelector<HTMLElement>('.report-main:not(:disabled)') ?? sheet)?.focus({ preventScroll: true })
    })

  const act = async (g: ReportGroup, run: () => Promise<boolean>) => {
    mark(g.key, 'leaving')
    const ok = await run()
    mark(g.key, ok ? 'gone' : 'wrong')
    keepFocus()
  }

  // A ban resolves every report on them (admin_purge): their other rows go too.
  const banAll = async (id: string) => {
    const ok = await ban(id)
    if (ok) for (const other of groups ?? []) if (other.person?.id === id) mark(other.key, 'gone')
    return ok
  }

  const actions = (g: ReportGroup): MenuItem[] => {
    const person = g.person && (people[g.person.id] ?? g.person)
    // Banned people too: an open report on someone banned means the ban stopped part-way, and this finishes it.
    const banItem: MenuItem[] =
      person && !person.admin
        ? [
            {
              label: g.kind === 'profile' ? 'Ban' : 'Ban Author',
              icon: 'none',
              danger: true,
              items: [{ label: `Ban @${person.handle}`, icon: 'none', danger: true, onSelect: () => void act(g, () => banAll(person.id)) }],
            },
          ]
        : []
    const remove: MenuItem =
      g.kind === 'profile'
        ? {
            label: 'Remove Profile',
            icon: 'trash',
            danger: true,
            items: [{ label: 'Remove Profile', icon: 'trash', danger: true, onSelect: () => void act(g, () => removeProfile(g.targetId)) }],
          }
        : {
            label: 'Remove',
            icon: 'trash',
            danger: true,
            items: [
              {
                label: 'Remove Post',
                icon: 'trash',
                danger: true,
                onSelect: () => void act(g, () => removeContent({ kind: g.kind as 'post' | 'video', id: g.targetId, paths: g.post?.paths ?? [] })),
              },
            ],
          }
    return [{ label: 'Dismiss', icon: 'tick', onSelect: () => void act(g, () => dismiss(g.kind, g.targetId)) }, remove, ...banItem]
  }

  const open = (g: ReportGroup) => {
    if (g.post) return openPost(g.post)
    if (g.kind === 'profile' && g.person) {
      onClose()
      navigate(`/u/${g.person.handle}`)
    }
  }

  // Gone here too: removed or reported from the Viewer over this sheet, or its author banned since it loaded. Someone
  // banned before it loaded still has open reports only because their ban stopped part-way: they stay, to finish it.
  const shown = (groups ?? []).filter((g) => {
    if (states[g.key] === 'gone' || (hidden.has(g.key) && states[g.key] !== 'leaving')) return false
    const person = g.person && people[g.person.id]
    return !(person?.banned && !g.person?.banned && states[g.key] !== 'leaving')
  })

  return (
    <Sheet title="Reports" onClose={onClose} className="reports-sheet">
      {groups === undefined ? (
        <div className="sheet-state">
          <span className="spinner" aria-label="Loading" />
        </div>
      ) : groups === null ? (
        <div className="sheet-state" role="img" aria-label="Failed">
          <Icon name="alert" size={40} />
        </div>
      ) : !shown.length ? (
        <div className="sheet-state" role="img" aria-label="No Reports">
          <Icon name="tick" size={40} />
        </div>
      ) : (
        <ul className="sheet-list">
          {shown.map((g) => {
            const state = states[g.key]
            return (
              <li
                key={g.key}
                className={`report${state ? ` ${state}` : ''}`}
                onAnimationEnd={() => state === 'wrong' && mark(g.key)}
              >
                <div className="sheet-row report-row">
                  <button type="button" className="report-main" disabled={state === 'leaving'} onClick={() => open(g)}>
                    <ReportThumb group={g} />
                    <span className="report-reasons ellipsis">{g.reasons.map((r) => REASONS[r]).join(' · ')}</span>
                  </button>
                  <IconButton icon="more" label="Actions" disabled={state === 'leaving'} onClick={(e) => openMenu(e.currentTarget, actions(g))} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}

/** A profile's round avatar; a post's video still or first image; else an image glyph. */
function ReportThumb({ group }: { group: ReportGroup }) {
  const [failed, setFailed] = useState(false)
  if (group.kind === 'profile' && group.person) return <PersonAvatar person={group.person} size={44} />
  const src = group.post?.video?.still ?? group.post?.images[0]
  return (
    <span className="sheet-thumb">
      {src && !failed ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : <Icon name="image" size={20} />}
    </span>
  )
}
