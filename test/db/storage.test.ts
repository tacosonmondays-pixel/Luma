// The media bucket's policies: members write only their own folder, with allowed file types; anyone reads (public).
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from './harness.ts'

let db: Db
let alice: { id: string }
let bob: { id: string }
let nobody: { id: string }
let admin: { id: string }

beforeAll(async () => {
  db = await createDb()
  alice = await db.member('alice')
  bob = await db.member('bob')
  nobody = await db.user()
  admin = await db.admin()
}, 60_000)

const upload = (who: Parameters<Db['as']>[0], name: string, bucket = 'media') =>
  db.as(who, `insert into storage.objects (bucket_id, name, metadata) values ($1, $2, '{}')`, [bucket, name])

const denied = /row-level security|permission denied/

describe('media bucket', () => {
  it('is public, capped at 50 MB, and takes images and videos only (never audio)', async () => {
    const [b] = await db.as<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      'owner',
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'media'`,
    )
    expect(b.public).toBe(true)
    expect(Number(b.file_size_limit)).toBe(50 * 1024 * 1024)
    expect(b.allowed_mime_types.every((t) => t.startsWith('image/') || t.startsWith('video/'))).toBe(true)
  })

  it('members upload into their own folder', async () => {
    await upload(alice, `${alice.id}/profile/avatar-1.jpg`)
    await upload(alice, `${alice.id}/videos/v-1.mp4`)
    await upload(alice, `${alice.id}/posts/p-1.webp`)
  })

  it("nobody writes into someone else's folder", async () => {
    await expect(upload(bob, `${alice.id}/profile/avatar-2.jpg`)).rejects.toThrow(denied)
    expect(Number((await db.as<{ n: string }>(bob, `with q as (update storage.objects set name = name where name like $1 returning 1) select count(*) n from q`, [`${alice.id}/%`]))[0].n)).toBe(0)
    expect(Number((await db.as<{ n: string }>(bob, `with q as (delete from storage.objects where name like $1 returning 1) select count(*) n from q`, [`${alice.id}/%`]))[0].n)).toBe(0)
  })

  it("moving a file into another folder isn't allowed", async () => {
    await expect(db.as(alice, `update storage.objects set name = $1 where name = $2`, [`${bob.id}/profile/x.jpg`, `${alice.id}/posts/p-1.webp`])).rejects.toThrow(denied)
  })

  it('non-members and signed-out visitors upload nothing', async () => {
    await expect(upload(nobody, `${nobody.id}/profile/avatar.jpg`)).rejects.toThrow(denied)
    await expect(upload('anon', `${alice.id}/profile/avatar.jpg`)).rejects.toThrow(denied)
  })

  it('only allowed folders and file types', async () => {
    await expect(upload(alice, `${alice.id}/songs/track.m4a`)).rejects.toThrow(denied)
    await expect(upload(alice, `${alice.id}/profile/track.mp3`)).rejects.toThrow(denied)
    await expect(upload(alice, `${alice.id}/profile/script.html`)).rejects.toThrow(denied)
    await expect(upload(alice, `${alice.id}/avatar.jpg`)).rejects.toThrow(denied)
    await expect(upload(alice, `${alice.id}/profile/deep/avatar.jpg`)).rejects.toThrow(denied)
    await expect(upload(alice, `${alice.id}/profile/../x.jpg`)).rejects.toThrow(denied)
    await expect(upload(alice, `x/${alice.id}/profile/a.jpg`)).rejects.toThrow(denied)
  })

  it('only the media bucket', async () => {
    await db.as('owner', `insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing`)
    await expect(upload(alice, `${alice.id}/profile/a.jpg`, 'other')).rejects.toThrow(denied)
  })

  it('owners list and delete their own files; admins delete anyone’s', async () => {
    expect((await db.as(alice, `select name from storage.objects`)).length).toBe(3)
    expect((await db.as(bob, `select name from storage.objects`)).length).toBe(0)
    await upload(bob, `${bob.id}/posts/b.png`)
    await db.as(admin, `delete from storage.objects where name = $1`, [`${bob.id}/posts/b.png`])
    expect((await db.as(bob, `select name from storage.objects`)).length).toBe(0)
  })

  it('banned members stop uploading', async () => {
    await db.as(admin, 'select public.admin_ban($1)', [bob.id])
    await expect(upload(bob, `${bob.id}/posts/c.png`)).rejects.toThrow(denied)
  })
})
