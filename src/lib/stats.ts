// Listening stats, badges and On Repeat. Placeholder — WP-C (Listening) fills it in.
import type { Badge } from '../types.ts'

/** Track ids played most in the last 30 days (at least 3 qualify, else empty). */
export function useOnRepeat(): string[] {
  return []
}

export function useBadges(): Badge[] {
  return []
}
