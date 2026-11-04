// The account rows in You's settings group, and the sign-in sheet: email, then the 6-digit code, then an invite
// code if not a member yet, then a handle if there is none. Mistakes mark the field; there is no helper text.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { claimHandle, HANDLE, isMember, profileLink, redeemInvite, setShareActivity, signIn, signOut, useAccount, verify } from '../lib/account.ts'
import { createInvite, hasOpenReports } from '../lib/moderation.ts'
import { useMe } from '../lib/social.ts'
import { linkDevice, useSyncOwner } from '../lib/sync.ts'
import { Icon } from './Icon.tsx'
import { IconButton, Link } from './kit.tsx'
import { ReportsSheet } from './Reports.tsx'
import '../styles/appearance.css'
import '../styles/account.css'

type Step = 'email' | 'code' | 'invite' | 'handle'

/** Where the sheet starts (or continues) for the current account; undefined when it is done. */
function nextStep(): Step | undefined {
  const a = useAccount.getState()
  if (!a.user) return 'email'
  if (!a.row || !a.row.member) return a.row?.banned ? undefined : 'invite'
  if (a.row.banned) return undefined
  if (!a.row.handle) return 'handle'
}

const FIELDS: Record<Step, { label: string; type: string; mode?: 'numeric' | 'email' | 'text'; auto?: string; max?: number }> = {
  email: { label: 'Email', type: 'email', mode: 'email', auto: 'email' },
  code: { label: 'Code', type: 'text', mode: 'numeric', auto: 'one-time-code', max: 6 },
  invite: { label: 'Invite Code', type: 'text', mode: 'text', max: 32 },
  handle: { label: 'Handle', type: 'text', mode: 'text', auto: 'username', max: 20 },
}

const SUBMIT: Record<Step, string> = { email: 'Continue', code: 'Sign In', invite: 'Join', handle: 'Done' }

export function SignInSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(() => nextStep() ?? 'email')
  const [email, setEmail] = useState(() => useAccount.getState().user?.email ?? '')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [step])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = (next: Step | undefined) => {
    setValue('')
    setWrong(false)
    if (next) setStep(next)
    else onClose()
  }

  const valid =
    step === 'email' ? /^\S+@\S+\.\S+$/.test(value.trim()) : step === 'code' ? /^\d{6}$/.test(value) : step === 'handle' ? HANDLE.test(value) : value.trim().length >= 6

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setWrong(false)
    try {
      if (step === 'email') {
        if (!(await signIn(value))) return setWrong(true)
        setEmail(value.trim())
        go('code')
      } else if (step === 'code') {
        if (!(await verify(email, value))) return setWrong(true)
        go(nextStep())
      } else if (step === 'invite') {
        const r = await redeemInvite(value)
        if (r !== 'ok' && r !== 'member') return setWrong(true)
        go(nextStep())
      } else {
        const r = await claimHandle(value)
        if (r !== 'ok') return setWrong(true)
        go(undefined)
      }
    } finally {
      setBusy(false)
    }
  }

  const f = FIELDS[step]
  const onChange = (raw: string) => {
    setWrong(false)
    const next = step === 'code' ? raw.replace(/\D/g, '').slice(0, 6) : step === 'handle' ? raw.toLowerCase().replace(/[^a-z0-9_]/g, '') : step === 'invite' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : raw
    setValue(next)
  }
  // The code fills in from the keyboard's suggestion: go on as soon as all six digits are there.
  useEffect(() => {
    if (step === 'code' && /^\d{6}$/.test(value) && !busy && !wrong) void submit()
  }, [value])

  return createPortal(
    <div className="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet signin" role="dialog" aria-modal="true" aria-label="Sign In" onSubmit={submit}>
        <div className="sheet-head">
          <h2>Sign In</h2>
          <IconButton icon="close" label="Close" size={20} onClick={onClose} />
        </div>
        <label className={`sheet-field${wrong ? ' wrong' : ''}`} key={step}>
          {step === 'handle' && <span className="sheet-at">@</span>}
          <input
            ref={field}
            name={step}
            aria-label={f.label}
            aria-invalid={wrong || undefined}
            placeholder={f.label}
            type={f.type}
            inputMode={f.mode}
            autoComplete={f.auto ?? 'off'}
            autoCapitalize={step === 'invite' ? 'characters' : 'off'}
            autoCorrect="off"
            spellCheck={false}
            maxLength={f.max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <button type="submit" className="pill primary sheet-submit" disabled={!valid || busy}>
          {busy ? <span className="spinner" aria-label="Working" /> : SUBMIT[step]}
        </button>
      </form>
    </div>,
    document.body,
  )
}

/** The account part of You's settings group. */
export function AccountRows() {
  const user = useAccount((s) => s.user)
  const row = useAccount((s) => s.row)
  const ready = useAccount((s) => s.ready)
  const owner = useSyncOwner((s) => s.owner)
  const [open, setOpen] = useState(false)
  const member = isMember({ ready, user, row })
  if (!ready) return null
  const done = !!user && member && !!row?.handle
  // This device's library syncs with another account (someone else's iPad): only on request does it become this one's.
  const other = done && !!owner && owner !== user?.id
  return (
    <>
      {done ? (
        <Link to={`/u/${row!.handle}`} className="group-row">
          <span className="ellipsis">@{row!.handle}</span>
          <span className="group-value">
            <Icon name="chevron-right" size={18} />
          </span>
        </Link>
      ) : (
        <button type="button" className="group-row" onClick={() => setOpen(true)}>
          <span className="ellipsis">{user ? user.email : 'Sign In'}</span>
          <span className="group-value">
            <Icon name="chevron-right" size={18} />
          </span>
        </button>
      )}
      {done && (
        <label className="group-row">
          <span>Share Listening</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={row!.share_activity}
            onChange={(e) => void setShareActivity(e.target.checked)}
          />
        </label>
      )}
      {other && (
        <button type="button" className="group-row" onClick={linkDevice}>
          Sync Library
        </button>
      )}
      <AdminRows />
      {user && (
        <button type="button" className="group-row danger" onClick={() => void signOut()}>
          Sign Out
        </button>
      )}
      {open && <SignInSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/** Admins: Invite (a code to share, shown here until you leave), and Reports while any are open. */
function AdminRows() {
  const me = useMe()
  const [code, setCode] = useState<string | null>()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [reports, setReports] = useState(false)
  const admin = !!me?.admin
  useEffect(() => {
    if (!admin || open) return
    let live = true
    void hasOpenReports().then((any) => live && setReports(any))
    return () => {
      live = false
    }
  }, [admin, open])
  if (!me?.admin) return null

  const invite = async () => {
    if (busy) return
    setBusy(true)
    const made = await createInvite().finally(() => setBusy(false))
    setCode(made)
    if (!made) return
    try {
      if (navigator.share) return await navigator.share({ text: made, url: profileLink(me.handle) })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
    await navigator.clipboard?.writeText(made).catch(() => {})
  }

  return (
    <>
      <button type="button" className="group-row" onClick={() => void invite()}>
        <span>Invite</span>
        <span className="group-value">
          {busy ? <span className="spinner" aria-label="Working" /> : code ? <span className="invite-code">{code}</span> : code === null && <Icon name="alert" size={18} />}
        </span>
      </button>
      {reports && (
        <button type="button" className="group-row" onClick={() => setOpen(true)}>
          <span>Reports</span>
          <span className="group-value">
            <Icon name="chevron-right" size={18} />
          </span>
        </button>
      )}
      {open && <ReportsSheet onClose={() => setOpen(false)} />}
    </>
  )
}
