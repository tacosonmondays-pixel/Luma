export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A stable two-tone gradient for anything without artwork. */
export function gradientFor(seed: string): string {
  let h = 7
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  const a = h % 360
  const b = (a + 30 + ((h >>> 9) % 60)) % 360
  return `linear-gradient(135deg, hsl(${a} 50% 44%), hsl(${b} 55% 20%))`
}

/** Short random id. Works on plain http (crypto.randomUUID needs a secure context). */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
