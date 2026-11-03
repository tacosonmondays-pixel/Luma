// Builds Luma as a single executable (build/Luma.exe on Windows, build/luma elsewhere) with Node's
// Single Executable Applications, following https://nodejs.org/docs/v22.23.4/api/single-executable-applications.html
// Run `npm run build` first: the built app in dist/ is embedded as assets. Use the Node version the exe should ship.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { build } from 'esbuild'
import { inject } from 'postject'

const OUT = 'build'
const EXE = join(OUT, process.platform === 'win32' ? 'Luma.exe' : 'luma')
const MAIN = join(OUT, 'luma.cjs')
const BLOB = join(OUT, 'sea-prep.blob')
const CONFIG = join(OUT, 'sea-config.json')

if (!existsSync('dist/index.html')) throw new Error('Run npm run build first')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT)

// 1. Bundle the helper into one CommonJS file: SEA in Node 22 runs a single CommonJS script.
//    import.meta is empty in CommonJS; server/index.ts only reads it outside the exe.
await build({
  entryPoints: ['server/exe.ts'],
  outfile: MAIN,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node}`,
  logOverride: { 'empty-import-meta': 'silent' },
})

// 2. The preparation blob, with every file of dist/ as an asset keyed by its path, such as "assets/index.js".
const assets = Object.fromEntries(
  readdirSync('dist', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((file) => [relative('dist', file).split(sep).join('/'), file]),
)
writeFileSync(CONFIG, JSON.stringify({ main: MAIN, output: BLOB, disableExperimentalSEAWarning: true, assets }, null, 2))
execFileSync(process.execPath, ['--experimental-sea-config', CONFIG], { stdio: 'inherit' })

// 3. A copy of this Node with the blob injected. On Windows the copy's signature becomes invalid; the exe still runs.
copyFileSync(process.execPath, EXE)
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', EXE])
await inject(EXE, 'NODE_SEA_BLOB', readFileSync(BLOB), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
})
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', EXE])

console.log(`Built ${EXE} with ${Object.keys(assets).length} app files`)
