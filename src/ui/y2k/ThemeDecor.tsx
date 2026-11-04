// Extra markup the Y2K theme needs inside shared surfaces: the LCD display in Now Playing and in the
// desktop player bar. Renders nothing for other themes.
import { useAppearance } from '../../lib/appearance.ts'
import { useCurrentTrack, usePlayer } from '../../lib/player.ts'
import { Equalizer, LcdTime, Marquee, useY2K } from './Lcd.tsx'

/** Now Playing's display: time, equalizer, title and artist. `data-style` tells y2k.css which player style
 * it frames (Canvas only counts when the song has one; otherwise it falls back to Color). */
function NowPlayingLcd() {
  const track = useCurrentTrack()
  const open = usePlayer((s) => s.open)
  const playing = usePlayer((s) => s.playing)
  const style = useAppearance((s) => s.playerStyle)
  if (!track) return null
  const live = open && playing
  return (
    <div className="y2k-np" data-style={style === 'canvas' && !track.canvas ? 'color' : style}>
      <div className="y2k-bezel">
        <div className={`y2k-lcd${playing ? '' : ' paused'}`}>
          <div className="y2k-lcd-row">
            <LcdTime />
            <Equalizer bars={16} run={live} />
          </div>
          <Marquee text={track.title} run={live} className="y2k-title" />
          <span className="y2k-artist ellipsis" aria-hidden="true">
            {track.artist}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The desktop bar's display. Spans only: it sits inside the bar's "Open Now Playing" button. */
function BarLcd() {
  const track = useCurrentTrack()
  const covered = usePlayer((s) => s.open)
  const playing = usePlayer((s) => s.playing)
  if (!track) return null
  const live = playing && !covered
  return (
    <span className="y2k-bezel y2k-bar-bezel">
      <span className={`y2k-lcd y2k-bar-lcd${playing ? '' : ' paused'}`}>
        <span className="y2k-lcd-text">
          <Marquee text={track.title} run={live} className="y2k-title" />
          <span className="y2k-artist ellipsis" aria-hidden="true">
            {track.artist}
          </span>
        </span>
        <Equalizer bars={9} run={live} />
      </span>
    </span>
  )
}

export function ThemeDecor({ place }: { place: 'now-playing' | 'bar' }) {
  const y2k = useY2K()
  if (!y2k) return null
  return place === 'now-playing' ? <NowPlayingLcd /> : <BarLcd />
}
