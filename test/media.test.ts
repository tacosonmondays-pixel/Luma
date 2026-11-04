import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIMITS, checkAnimated, checkVideo, extOf, gifInfo, imageInfo, metadataBoxes, pngInfo, stillPlan, webpInfo, withoutMetadata } from '../src/lib/media.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const MB = 1024 * 1024

describe('GIF', () => {
  it('counts one frame', () => {
    expect(gifInfo(fixture('still.gif'))).toEqual({ type: 'gif', width: 32, height: 24, frames: 1 })
  })

  it('counts three frames', () => {
    expect(gifInfo(fixture('anim3.gif'))?.frames).toBe(3)
  })

  it('walks the blocks instead of searching for 0x2C', () => {
    const bytes = fixture('noise2.gif')
    expect(bytes.filter((b) => b === 0x2c).length).toBeGreaterThan(2) // image data holds 0x2C bytes too
    expect(gifInfo(bytes)).toEqual({ type: 'gif', width: 48, height: 48, frames: 2 })
  })

  it('ignores other files', () => {
    expect(gifInfo(fixture('still.png'))).toBeUndefined()
  })
})

describe('PNG', () => {
  it('reads acTL num_frames', () => {
    expect(pngInfo(fixture('anim3.png'))).toEqual({ type: 'png', width: 32, height: 24, frames: 3 })
  })

  it('treats a PNG without acTL as still', () => {
    expect(pngInfo(fixture('still.png'))).toEqual({ type: 'png', width: 32, height: 24, frames: 1 })
  })
})

describe('WebP', () => {
  it('reads the VP8X animation flag and counts ANMF chunks', () => {
    expect(webpInfo(fixture('anim3.webp'))).toEqual({ type: 'webp', width: 32, height: 24, frames: 3 })
  })

  it('treats a plain WebP as still', () => {
    expect(webpInfo(fixture('still.webp'))).toMatchObject({ type: 'webp', width: 32, height: 24, frames: 1 })
  })
})

describe('imageInfo', () => {
  it('detects each format', () => {
    expect(imageInfo(fixture('anim3.gif')).type).toBe('gif')
    expect(imageInfo(fixture('anim3.png')).type).toBe('png')
    expect(imageInfo(fixture('anim3.webp')).type).toBe('webp')
    expect(imageInfo(fixture('cover.jpg'))).toEqual({ type: 'other', width: 0, height: 0, frames: 1 })
  })
})

describe('caps', () => {
  const small = { width: 320, height: 320, frames: 40 }

  it('takes animated images within the slot caps', () => {
    for (const slot of ['avatar', 'banner', 'backdrop', 'canvas'] as const) expect(checkAnimated(slot, 1 * MB, small)).toBeUndefined()
  })

  it('rejects an animated avatar over 2 MB, 640 px or 16 M pixels', () => {
    expect(checkAnimated('avatar', 5 * MB, small)).toBe('too-large')
    expect(checkAnimated('avatar', 1 * MB, { width: 800, height: 400, frames: 2 })).toBe('too-large')
    expect(checkAnimated('avatar', 1 * MB, { width: 640, height: 640, frames: 40 })).toBe('too-large') // 16.4 M
    expect(checkAnimated('avatar', 2 * MB, { width: 640, height: 640, frames: 39 })).toBeUndefined()
  })

  it('rejects a banner over 4 MB, 1200 px wide or 48 M pixels', () => {
    expect(checkAnimated('banner', 4 * MB + 1, small)).toBe('too-large')
    expect(checkAnimated('banner', MB, { width: 1201, height: 400, frames: 2 })).toBe('too-large')
    expect(checkAnimated('banner', MB, { width: 1200, height: 400, frames: 101 })).toBe('too-large')
    expect(checkAnimated('banner', MB, { width: 1200, height: 400, frames: 100 })).toBeUndefined()
  })

  it('caps the Background and the Canvas alike', () => {
    for (const slot of ['backdrop', 'canvas'] as const) {
      expect(checkAnimated(slot, MB, { width: 1081, height: 1350, frames: 2 })).toBe('too-large')
      expect(checkAnimated(slot, MB, { width: 1080, height: 1350, frames: 32 })).toBeUndefined()
      expect(checkAnimated(slot, MB, { width: 1080, height: 1350, frames: 33 })).toBe('too-large')
    }
  })

  it('takes Background and Canvas videos up to 8 MB and 12 s', () => {
    const clip = { duration: 8, width: 1080, height: 1920 }
    for (const slot of ['backdrop', 'canvas'] as const) {
      expect(checkVideo(slot, 6 * MB, clip)).toBeUndefined()
      expect(checkVideo(slot, 9 * MB, clip)).toBe('too-large')
      expect(checkVideo(slot, 6 * MB, { ...clip, duration: 15 })).toBe('too-long')
    }
    expect(checkVideo('backdrop', 6 * MB, { ...clip, width: 2160, height: 3840 })).toBe('too-large')
    expect(checkVideo('canvas', 6 * MB, { ...clip, width: 2160, height: 3840 })).toBeUndefined()
  })

  it('takes posted videos up to 50 MB and 60 s, and no video in an image slot', () => {
    const clip = { duration: 30, width: 1080, height: 1920 }
    expect(checkVideo('video', 49 * MB, clip)).toBeUndefined()
    expect(checkVideo('video', 51 * MB, clip)).toBe('too-large')
    expect(checkVideo('video', MB, { ...clip, duration: 61 })).toBe('too-long')
    expect(checkVideo('video', 49 * MB, { ...clip, duration: 60, width: 3840, height: 2160 })).toBeUndefined()
    expect(checkVideo('post', MB, clip)).toBe('unsupported')
    expect(LIMITS.video.images).toBe(false)
  })

  it('keeps the first frame of an animated image in a post, whatever its size', () => {
    expect(LIMITS.post.animated).toBeUndefined()
    expect(checkAnimated('post', 40 * MB, { width: 4000, height: 4000, frames: 300 })).toBeUndefined()
  })

  it('sends avatar and banner videos to the GIF maker', () => {
    expect(checkVideo('avatar', MB, { duration: 3, width: 640, height: 640 })).toBe('unsupported')
    expect(checkVideo('banner', MB, { duration: 3, width: 640, height: 640 })).toBe('unsupported')
    expect(LIMITS.avatar.video).toBeUndefined()
  })
})

describe('stillPlan', () => {
  it('center-crops a 4000 px photo to a 512 px avatar', () => {
    expect(stillPlan('avatar', 4000, 3000)).toMatchObject({ sx: 500, sy: 0, sw: 3000, sh: 3000, width: 512, height: 512 })
  })

  it('crops the banner to 3:1 and the Background to 4:5', () => {
    expect(stillPlan('banner', 3000, 3000)).toMatchObject({ sw: 3000, sh: 1000, sy: 1000, width: 1500, height: 500 })
    expect(stillPlan('backdrop', 4000, 3000)).toMatchObject({ sw: 2400, sh: 3000, width: 1080, height: 1350 })
  })

  it('shrinks post images and video stills without cropping or enlarging', () => {
    expect(stillPlan('post', 4000, 3000)).toMatchObject({ sx: 0, sy: 0, sw: 4000, sh: 3000, width: 1600, height: 1200, quality: 0.82 })
    expect(stillPlan('video', 1920, 1080)).toMatchObject({ sx: 0, sy: 0, sw: 1920, sh: 1080, width: 1080, height: 608 })
    expect(stillPlan('post', 800, 600)).toMatchObject({ width: 800, height: 600 })
    expect(stillPlan('video', 720, 1280)).toMatchObject({ width: 608, height: 1080 })
  })

  it('never enlarges, and shrinks a Canvas without cropping', () => {
    expect(stillPlan('avatar', 200, 100)).toMatchObject({ width: 100, height: 100 })
    expect(stillPlan('canvas', 4000, 3000)).toMatchObject({ sx: 0, sy: 0, sw: 4000, sh: 3000, width: 1350, height: 1013 })
  })
})

describe('extOf', () => {
  it('names the extensions the bucket takes', () => {
    expect(extOf('video/quicktime')).toBe('mov')
    expect(extOf('image/jpeg')).toBe('jpg')
    expect(extOf('audio/mpeg')).toBeUndefined()
  })
})

describe('withoutMetadata', () => {
  const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')
  const utf8 = (s: string) => new TextEncoder().encode(s)
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) (out.set(p, at), (at += p.length))
    return out
  }
  /** A box: its size, its type, then its body. */
  const box = (type: string, ...body: (Uint8Array | string)[]) => {
    const out = concat(new Uint8Array(8), ...body.map((p) => (typeof p === 'string' ? utf8(p) : p)))
    new DataView(out.buffer).setUint32(0, out.length)
    out.set(utf8(type), 4)
    return out
  }
  /** The top-level boxes, as [type, offset]. */
  const top = (b: Uint8Array) => {
    const out: [string, number][] = []
    for (let at = 0; at + 8 <= b.length; ) {
      out.push([text(b.subarray(at + 4, at + 8)), at])
      at += new DataView(b.buffer, b.byteOffset).getUint32(at) || b.length
    }
    return out
  }
  const strip = async (bytes: Uint8Array, type: string) =>
    new Uint8Array(await (await withoutMetadata(new Blob([bytes.slice()], { type }))).arrayBuffer())

  it("removes a phone video's place and camera, and changes nothing else", async () => {
    const bytes = fixture('located.mov') // clip.mp4 through ffmpeg -f mov -metadata location=… make=… model=…
    expect(text(bytes)).toContain('+48.8584+002.2945')
    expect(text(bytes)).toContain('iPhone 15 Pro')
    const out = await strip(bytes, 'video/quicktime')
    expect(out.length).toBe(bytes.length) // nothing moves: the chunk offsets stay right
    expect(text(out)).not.toContain('48.8584')
    expect(text(out)).not.toContain('iPhone')
    expect(top(out).map(([t]) => t)).toEqual(['ftyp', 'wide', 'mdat', 'moov'])
    const moov = top(out).find(([t]) => t === 'moov')![1]
    const [udta] = metadataBoxes(bytes.subarray(moov))
    const changed = [...out.keys()].filter((i) => out[i] !== bytes[i])
    expect(changed[0]).toBeGreaterThanOrEqual(moov + udta.at + 4) // only inside the one box…
    expect(changed.at(-1)).toBeLessThan(moov + udta.end)
    expect(text(out.subarray(moov + udta.at + 4, moov + udta.at + 8))).toBe('free') // …which players skip
    expect(metadataBoxes(out.subarray(moov))).toEqual([])
  })

  it('walks the top level, moov and its tracks, 64-bit sizes too; leaves every other box alone', async () => {
    const large = concat(new Uint8Array([0, 0, 0, 1, ...utf8('udta'), 0, 0, 0, 0, 0, 0, 0, 24]), utf8('long one'))
    const moov = box(
      'moov',
      box('mvhd', 'x'.repeat(20)),
      box('meta', box('hdlr', 'mdta'), box('keys', 'com.apple.quicktime.location.ISO6709')),
      box('trak', box('tkhd', 'y'), box('udta', box('name', 'cam')), box('mdia', box('udta', 'deep'))),
      large,
    )
    const spans = metadataBoxes(moov)
    expect(spans.map((m) => text(moov.subarray(m.at + 4, m.at + 8)))).toEqual(['meta', 'udta', 'udta'])
    expect(spans[2]).toEqual({ at: moov.length - 24, body: moov.length - 8, end: moov.length }) // the 64-bit one

    const file = concat(box('ftyp', 'qt  '), box('meta', 'top secret'), box('mdat', 'media'), moov)
    const out = await strip(file, 'video/mp4')
    expect(out.length).toBe(file.length)
    expect(top(out).map(([t]) => t)).toEqual(['ftyp', 'free', 'mdat', 'moov'])
    for (const gone of ['meta', 'secret', 'ISO6709', 'cam', 'long one']) expect(text(out)).not.toContain(gone)
    for (const kept of ['qt  ', 'media', 'mvhd', 'tkhd', 'mdia']) expect(text(out)).toContain(kept)
    expect(text(out)).toContain('udtadeep') // inside mdia: not where metadata lives, and not walked
    const big = top(out).find(([t]) => t === 'moov')![1] + spans[2].at
    expect([...out.subarray(big, big + 16)]).toEqual([0, 0, 0, 1, ...utf8('free'), 0, 0, 0, 0, 0, 0, 0, 24])
  })

  it('passes WebM, and a file it cannot walk, through untouched', async () => {
    const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: 'video/webm' })
    expect(await withoutMetadata(webm)).toBe(webm)
    const junk = new Blob([new Uint8Array([0, 0, 0, 3, 1, 2, 3, 4, 5])], { type: 'video/mp4' })
    expect(await withoutMetadata(junk)).toBe(junk)
  })
})
