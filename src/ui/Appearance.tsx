import { PLAYER_STYLES, THEMES, setCoverColors, setPlayerStyle, setTheme, useAppearance } from '../lib/appearance.ts'
import '../styles/appearance.css'
import { Segmented } from './Segmented.tsx'

/** Theme, Cover Colors and Player Style: one settings group, no heading. The You page places it. */
export function Appearance() {
  const { theme, coverColors, playerStyle } = useAppearance()
  return (
    <div className="group appearance">
      <div className="group-row">
        <span id="appearance-theme">Theme</span>
        <div className="swatches" role="radiogroup" aria-labelledby="appearance-theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-label={t.name}
              className={`swatch${theme === t.id ? ' on' : ''}`}
              style={{ background: t.bg, color: t.accent }}
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>
      </div>
      <label className="group-row">
        <span>Cover Colors</span>
        <input type="checkbox" role="switch" className="switch" checked={coverColors} onChange={(e) => setCoverColors(e.target.checked)} />
      </label>
      <div className="group-row">
        <span>Player Style</span>
        <Segmented
          label="Player Style"
          className="player-style"
          options={PLAYER_STYLES.map((s) => s.id)}
          value={playerStyle}
          onChange={setPlayerStyle}
          render={(id) => ({ content: PLAYER_STYLES.find((s) => s.id === id)!.name })}
        />
      </div>
    </div>
  )
}
