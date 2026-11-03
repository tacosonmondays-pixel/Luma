#!/usr/bin/env node
// A stand-in for yt-dlp, for test/e2e/app.mjs (run the helper with LUMA_YTDLP pointing here). Listings come from
// the JSON file in FAKE_YTDLP_LISTING ({ title, entries }), so a test can add songs to "YouTube"; downloads copy a
// real M4A from test/fixtures after a short delay, so progress shows.
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const target = args[args.length - 1]

if (args.includes('--version')) {
  console.log('2026.10.20')
} else if (args.includes('--dump-single-json')) {
  const listing = JSON.parse(fs.readFileSync(process.env.FAKE_YTDLP_LISTING, 'utf8'))
  const v = /[?&]v=([\w-]{11})/.exec(target)?.[1]
  if (target.includes('list=')) {
    process.stdout.write(JSON.stringify({ _type: 'playlist', id: 'PL', title: listing.title, entries: listing.entries.map((e) => ({ ie_key: 'Youtube', ...e })) }))
  } else {
    const e = listing.entries.find((x) => x.id === v) ?? listing.extra?.find((x) => x.id === v) ?? { id: v, title: `Video ${v}`, channel: 'Channel', duration: 200 }
    process.stdout.write(JSON.stringify({ _type: 'video', ...e }))
  }
} else {
  const out = args[args.indexOf('-o') + 1]
  const id = /v=([\w-]{11})/.exec(target)[1]
  const audio = path.join(__dirname, '../fixtures/Daft Punk - One More Time.m4a')
  setTimeout(() => fs.copyFileSync(audio, out.replace('%(id)s', id).replace('%(ext)s', 'm4a')), 700)
}
