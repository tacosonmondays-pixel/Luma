// Binary data (audio, covers, images) lives in IndexedDB under string keys:
//   audio:<trackId>  cover:<trackId>  canvas:<trackId> (with canvas-still:<trackId> while it is an animated image)
//   playlist-cover:<playlistId>  background
//   avatar  banner  backdrop (the profile card's own background), each with a `<key>-still` copy (JPEG) while
//   it is an animated image or a video
// Metadata records a version number (Date.now()) next to each blob; bump it to replace the blob.

import { useEffect, useState } from 'react'
import { createStore, del, get, set } from 'idb-keyval'
import type { Version } from '../types.ts'

export const db = createStore('luma', 'kv')

export const getBlob = (key: string) => get<Blob>(key, db)
export const putBlob = (key: string, blob: Blob) => set(key, blob, db)
export const deleteBlob = (key: string) => del(key, db)

const urls = new Map<string, { v: number; url: Promise<string | undefined> }>()

/** An object URL for a stored blob, cached until its version changes. */
export function blobUrl(key: string, v: number): Promise<string | undefined> {
  const hit = urls.get(key)
  if (hit?.v === v) return hit.url
  if (hit) void hit.url.then((old) => old && setTimeout(() => URL.revokeObjectURL(old), 5000))
  const url = getBlob(key).then((blob) => (blob ? URL.createObjectURL(blob) : undefined))
  urls.set(key, { v, url })
  return url
}

export function useBlobUrl(key: string, v: Version): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let live = true
    if (v === undefined) setUrl(undefined)
    else void blobUrl(key, v).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [key, v])
  return v === undefined ? undefined : url
}
