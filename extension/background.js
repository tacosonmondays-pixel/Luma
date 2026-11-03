// Opens Luma at <lumaUrl>save?u=<YouTube link>: navigates a Luma tab that is already open, else opens one.
import { getSettings, helperRunning, PRESETS } from './settings.js'

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return
  // First install: use this computer's Luma when it is running here (it downloads straight away).
  if (await helperRunning()) await chrome.storage.sync.set({ lumaUrl: PRESETS.computer })
})

/** `background`: an auto-saved like. It goes to Luma without taking the owner away from YouTube. */
async function save(url, background) {
  const { lumaUrl } = await getSettings()
  const target = `${lumaUrl}save?u=${encodeURIComponent(url)}`
  const tabs = (await chrome.tabs.query({})).filter((t) => t.url?.startsWith(lumaUrl) || t.pendingUrl?.startsWith(lumaUrl))
  const tab = tabs.find((t) => t.active) ?? tabs[0]
  if (!tab) return void (await chrome.tabs.create({ url: target, active: !background }))
  await chrome.tabs.update(tab.id, background ? { url: target } : { url: target, active: true })
  if (!background) await chrome.windows.update(tab.windowId, { focused: true })
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'luma-save' || typeof message.url !== 'string') return
  save(message.url, !!message.background).then(
    () => reply({ ok: true }),
    () => reply({ ok: false }),
  )
  return true // replies asynchronously
})

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage())
