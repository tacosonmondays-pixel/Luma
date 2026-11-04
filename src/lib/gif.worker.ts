// Encodes the GIF off the main thread, one frame at a time as gif.ts streams them in.
//
// Palette: one global 256-colour palette, quantized from a handful of frames sampled across the clip, then a
// persistent RGB565 → index table. Measured on 105 frames at 480×480 against a fresh palette per frame (RGB444,
// since per-frame RGB565 quantizing costs seconds a frame): about twice as fast, PSNR 39.9 vs 30.6 dB, and a quarter
// of the frame-to-frame flicker, since colours stay put between frames.

// @ts-expect-error gifenc ships no types; the part used here is typed below.
import * as gifenc from 'gifenc'

type Palette = number[][]
interface Encoder {
  writeFrame(index: Uint8Array, width: number, height: number, options: { palette?: Palette; delay?: number; repeat?: number }): void
  finish(): void
  bytes(): Uint8Array
}
const { GIFEncoder, quantize, nearestColorIndex } = gifenc as {
  GIFEncoder: () => Encoder
  quantize: (rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' }) => Palette
  nearestColorIndex: (palette: Palette, pixel: number[]) => number
}

export type WorkerIn =
  | { type: 'start'; width: number; height: number; delays: number[] }
  | { type: 'palette'; samples: ArrayBuffer }
  | { type: 'frame'; data: ArrayBuffer }
  | { type: 'finish' }

let encoder: Encoder | undefined
let width = 0
let height = 0
let delays: number[] = []
let frame = 0
let palette: Palette | undefined
let table = new Int16Array(65536)

function indexed(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const r = rgba[j]
    const g = rgba[j + 1]
    const b = rgba[j + 2]
    const key = ((r << 8) & 0xf800) | ((g << 3) & 0x7e0) | (b >> 3)
    let index = table[key]
    if (index < 0) index = table[key] = nearestColorIndex(palette!, [r, g, b])
    out[i] = index
  }
  return out
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  try {
    const message = event.data
    if (message.type === 'start') {
      ;({ width, height, delays } = message)
      encoder = GIFEncoder()
      frame = 0
      palette = undefined
    } else if (message.type === 'palette') {
      palette = quantize(new Uint8Array(message.samples), 256, { format: 'rgb565' })
      table = new Int16Array(65536).fill(-1)
    } else if (message.type === 'frame') {
      const rgba = new Uint8Array(message.data)
      if (!palette) {
        palette = quantize(rgba, 256, { format: 'rgb565' })
        table = new Int16Array(65536).fill(-1)
      }
      const first = frame === 0
      encoder!.writeFrame(indexed(rgba), width, height, {
        palette: first ? palette : undefined,
        delay: delays[frame] ?? delays[delays.length - 1] ?? 100,
        repeat: 0, // loop forever
      })
      frame++
      postMessage({ type: 'ack' })
    } else if (message.type === 'finish') {
      encoder!.finish()
      const bytes = encoder!.bytes()
      encoder = undefined
      postMessage({ type: 'done', bytes: bytes.buffer }, { transfer: [bytes.buffer] })
    }
  } catch (error) {
    postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
