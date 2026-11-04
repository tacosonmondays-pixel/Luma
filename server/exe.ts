// Luma.exe's entry (see scripts/build-exe.mjs). On Windows it fetches yt-dlp and Deno on first run,
// then starts the helper and opens Luma in the browser. The console window shows that Luma is running.

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setup, tools } from './setup.ts'

const url = `http://localhost:${Number(process.env.PORT || 4848)}`

async function main() {
  if (await running()) {
    console.log('Luma is already running.')
    return open()
  }

  if (process.platform === 'win32') {
    const dir = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Luma', 'bin')
    const { ytdlp, deno } = tools(dir)
    try {
      await setup(dir)
    } catch (e) {
      console.error(`Search and downloads won't work: ${(e as Error).message}. Check your connection, then start Luma again.`)
    }
    process.env.LUMA_YTDLP ||= ytdlp
    process.env.LUMA_JS_RUNTIME ||= `deno:${deno}`
    // Keep yt-dlp current: YouTube changes often. It replaces itself when done.
    spawn(ytdlp, ['-U'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
  }

  const { server } = await import('./index.ts')
  server.once('listening', () => {
    console.log('Luma is running. Close this window to stop it.')
    open()
  })
}

/** Whether a Luma already answers on the port, e.g. from a second double-click. */
const running = () =>
  fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)

function open() {
  const command = { win32: 'explorer.exe', darwin: 'open' }[process.platform as string] ?? 'xdg-open'
  spawn(command, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

main().catch((e: unknown) => {
  console.error(`Luma could not start: ${(e as Error).message}`)
  console.error('Press Enter to close.')
  process.stdin.once('data', () => process.exit(1))
})
