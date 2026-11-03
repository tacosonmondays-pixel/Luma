// Theme, cover colors and player style. Placeholder store — WP-A (Look) adds the side effects.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeId = 'luma' | 'black' | 'mocha' | 'fjord' | 'rose' | 'y2k'
export type PlayerStyle = 'color' | 'vinyl' | 'canvas'

interface Appearance {
  theme: ThemeId
  coverColors: boolean
  playerStyle: PlayerStyle
}

export const useAppearance = create<Appearance>()(
  persist((): Appearance => ({ theme: 'luma', coverColors: true, playerStyle: 'color' }), { name: 'luma-appearance' }),
)
