import type { CSSProperties } from 'react'
import { useLibrary } from '../lib/library.ts'
import type { Route } from '../lib/router.ts'
import { Avatar, PlaylistArt } from './Art.tsx'
import { Icon } from './Icon.tsx'
import { Link } from './kit.tsx'
import { profileColors } from './profile/colors.ts'
import { NameStyle } from './profile/NameStyle.tsx'
import '../styles/profile.css'

const is = (on: boolean) => (on ? ' active' : '')

export function Sidebar({ route }: { route: Route }) {
  const playlists = useLibrary((s) => s.playlists)
  const profile = useLibrary((s) => s.profile)
  const name = profile.name.trim()
  const style = name ? profile.nameStyle : undefined
  return (
    <nav className="sidebar">
      {/* The nameplate: the name style's plate and font, at rest. */}
      <Link to="/you" className={`side-link side-profile${style ? ` plate plate-${style}` : ''}${is(route.name === 'you')}`}>
        <span className="side-plate-vars" style={profileColors(profile, false) as CSSProperties}>
          <Avatar size={28} />
          <NameStyle name={name || 'You'} style={style} rest className="ns-plate" />
        </span>
      </Link>
      <Link to="/search" className={`side-link${is(route.name === 'search')}`}>
        <Icon name="search" size={20} />
        Search
      </Link>
      <Link to="/" className={`side-link${is(route.name === 'songs')}`}>
        <Icon name="music" size={20} />
        Songs
      </Link>
      <Link to="/playlists" className={`side-link${is(route.name === 'playlists')}`}>
        <Icon name="playlists" size={20} />
        Playlists
      </Link>
      <div className="side-playlists">
        {playlists.map((p) => (
          <Link key={p.id} to={`/playlist/${p.id}`} className={`side-link${is(route.name === 'playlist' && route.id === p.id)}`}>
            <PlaylistArt playlist={p} size={26} />
            <span className="ellipsis">{p.name}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

export function TabBar({ route }: { route: Route }) {
  const hasAvatar = useLibrary((s) => !!s.profile.avatar)
  return (
    <nav className="tabbar">
      <Link to="/" label="Songs" className={is(route.name === 'songs')}>
        <Icon name="music" />
      </Link>
      <Link to="/playlists" label="Playlists" className={is(route.name === 'playlists' || route.name === 'playlist')}>
        <Icon name="playlists" />
      </Link>
      <Link to="/search" label="Search" className={is(route.name === 'search')}>
        <Icon name="search" />
      </Link>
      <Link to="/you" label="You" className={`tab-you${is(route.name === 'you')}`}>
        {hasAvatar ? <Avatar size={26} /> : <Icon name="user" />}
      </Link>
    </nav>
  )
}
