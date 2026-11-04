// Someone's profile row is anyone's JSON. What the public page (/u/:handle) takes from it is well-formed, or left out,
// so one member's row can't break the page for everyone who opens it, or put its own classes or URLs in it.
import { expect, it } from 'vitest'
import { badgesOf, pinnedOf, profileFromRow, profilePath } from '../../src/lib/account.ts'
import { mountEffect } from '../../src/ui/profile/effects.ts'
import type { EffectId, ProfileRow } from '../../src/types.ts'
import { blankRow } from './fake-supabase.ts'

const ID = '00000000-0000-4000-8000-000000000001'
const row = (extra: Record<string, unknown>) => blankRow(ID, extra) as unknown as ProfileRow

it('ids the app doesn’t know are left out', () => {
  const p = profileFromRow(row({ frame: 'x pc-wrap', effect: 'boom', name_style: 'a b c', colors: ['red;x', '#fff'], auto_colors: ['#ff7ab8', '#6b5bff'] }))
  expect(p).toMatchObject({ frame: undefined, effect: undefined, nameStyle: undefined, colors: undefined, autoColors: ['#ff7ab8', '#6b5bff'] })
  expect(profileFromRow(row({ frame: 'halo', effect: 'snow', name_style: 'neon' }))).toMatchObject({ frame: 'halo', effect: 'snow', nameStyle: 'neon' })
  expect(profileFromRow(row({ name: { a: 1 }, bio: 42 }))).toMatchObject({ name: '', bio: undefined })
})

it('pinned songs: objects with string fields and a known source only', () => {
  const good = { id: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist', source: 'youtube' }
  const r = row({ pinned_songs: [null, 'x', { ...good, title: { a: 1 } }, { ...good, source: 'audio' }, { ...good, id: 5 }, good] })
  expect(pinnedOf(r)).toEqual([{ ...good, title: '' }, good])
  expect(profileFromRow(r).pinnedSongs).toEqual(['dQw4w9WgXcQ', 'dQw4w9WgXcQ'])
  expect(pinnedOf(row({ pinned_songs: { a: 1 } }))).toEqual([])
  expect(profileFromRow(row({ pinned_playlists: [null, 'p', 5] })).pinnedPlaylists).toEqual(['p'])
})

it('badges: known ids, whole tiers from 1 to 4, one of each', () => {
  const r = row({ badges: [{ id: 'toString', tier: 1 }, { id: '__proto__', tier: 1 }, { id: 'hours', tier: 5 }, { id: 'hours', tier: 1.5 }, null, { id: 'streak', tier: 2 }, { id: 'founder', tier: 4 }, { id: 'streak', tier: 3 }] })
  expect(badgesOf(r)).toEqual([{ id: 'founder', tier: 4 }, { id: 'streak', tier: 2 }])
  expect(badgesOf(row({ badges: 'x' }))).toEqual([])
})

it("media paths: one of the row's own profile files only", () => {
  const r = row({})
  expect(profilePath(r, `${ID}/profile/avatar-1.jpg`)).toBe(`${ID}/profile/avatar-1.jpg`)
  for (const path of [`${ID}/profile/../../other/profile/a.jpg`, `${ID}/profile/x/a.jpg`, `${ID}/profile/`, `other/profile/a.jpg`, 5, null, `${ID}/profile/${'x'.repeat(200)}`])
    expect(profilePath(r, path)).toBeUndefined()
})

it('an effect this version doesn’t know draws nothing (and doesn’t throw)', () => {
  const handle = mountEffect({} as HTMLCanvasElement, 'boom' as EffectId, { accent: '#fff' })
  expect(() => (handle.setPaused(true), handle.destroy())).not.toThrow()
  expect(() => mountEffect({} as HTMLCanvasElement, 'toString' as EffectId, { accent: '#fff' })).not.toThrow()
})
