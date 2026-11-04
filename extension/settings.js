// Shared by the service worker and the options page.
export const PRESETS = {
  computer: 'http://localhost:4848/',
  website: 'https://tacosonmondays-pixel.github.io/Luma/',
}
export const DEFAULTS = { lumaUrl: PRESETS.website, autoSaveLikes: false }

/** The helper (Luma.exe or npm start) answers here when it runs on this computer. */
export async function helperRunning() {
  try {
    const r = await fetch(`${PRESETS.computer}api/health`, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
    return r.ok && (await r.json()).ok === true
  } catch {
    return false
  }
}

/** A Luma URL always ends in '/', so `save?u=` goes after it. */
export function normalize(url) {
  const trimmed = String(url ?? '').trim()
  if (!/^https?:\/\/[^/]/i.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    u.search = ''
    u.hash = ''
    return u.href.endsWith('/') ? u.href : `${u.href}/`
  } catch {
    return null
  }
}

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) }
}
