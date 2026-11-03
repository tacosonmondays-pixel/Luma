import { PLAYER_STYLES, THEMES, setCoverColors, setPlayerStyle, setTheme, useAppearance } from '../lib/appearance.ts'
import '../styles/appearance.css'

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
        <span id="appearance-style">Player Style</span>
        <div className="segmented" role="radiogroup" aria-labelledby="appearance-style">
          {PLAYER_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={playerStyle === s.id}
              className={playerStyle === s.id ? 'on' : undefined}
              onClick={() => setPlayerStyle(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
