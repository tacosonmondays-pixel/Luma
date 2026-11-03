import { getSettings, helperRunning, normalize, PRESETS } from './settings.js'

const url = document.getElementById('url')
const likes = document.getElementById('likes')
const helper = document.getElementById('helper')
const presets = [...document.querySelectorAll('.preset')]

function show(lumaUrl) {
  url.value = lumaUrl
  url.classList.remove('wrong')
  for (const b of presets) b.setAttribute('aria-pressed', String(PRESETS[b.dataset.preset] === lumaUrl))
}

async function setUrl(value) {
  const lumaUrl = normalize(value)
  if (!lumaUrl) return url.classList.add('wrong')
  await chrome.storage.sync.set({ lumaUrl })
  show(lumaUrl)
}

const settings = await getSettings()
show(settings.lumaUrl)
likes.checked = settings.autoSaveLikes

url.addEventListener('change', () => void setUrl(url.value))
url.addEventListener('keydown', (e) => e.key === 'Enter' && url.blur())
likes.addEventListener('change', () => void chrome.storage.sync.set({ autoSaveLikes: likes.checked }))
for (const b of presets) b.addEventListener('click', () => void setUrl(PRESETS[b.dataset.preset]))

// The dot on "This computer" lights while Luma.exe (or npm start) answers on this computer.
async function check() {
  helper.classList.toggle('on', await helperRunning())
  helper.title = helper.classList.contains('on') ? 'Running' : 'Not running'
}
void check()
setInterval(check, 5000)
