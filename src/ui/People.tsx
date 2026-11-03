// People: the nameplate (the sidebar's, and later each row of a Following or Followers list).
import type { CSSProperties, ReactNode } from 'react'
import type { NameStyleId } from '../types.ts'
import { profileColors } from './profile/colors.ts'
import { NameStyle } from './profile/NameStyle.tsx'
import '../styles/profile.css'

/** What a nameplate shows: your profile, or someone's (`handle` stands in for a blank name). */
export interface PlatePerson {
  name: string
  handle?: string
  nameStyle?: NameStyleId
  colors?: [string, string]
  autoColors?: [string, string]
}

/** A blank name has no style. */
const styleOf = (person: PlatePerson) => (person.name.trim() ? person.nameStyle : undefined)

/** The classes of the element the plate rests on (the sidebar link, a list row): its style's plate, if any. */
export const plateClass = (person: PlatePerson) => {
  const style = styleOf(person)
  return style ? ` plate plate-${style}` : ''
}

/** The name in its style, at rest, in the person's profile colors; `children` (an avatar) come first. */
export function Nameplate({ person, children }: { person: PlatePerson; children?: ReactNode }) {
  const name = person.name.trim() || (person.handle ? `@${person.handle}` : 'You')
  return (
    <span className="nameplate" style={profileColors(person, false) as CSSProperties}>
      {children}
      <NameStyle name={name} style={styleOf(person)} rest className="ns-plate" />
    </span>
  )
}
