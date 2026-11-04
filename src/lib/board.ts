// The profile's tabs under the card: Board (what is pinned), Activity (what was played) and Posts. Pure.

export const PROFILE_TABS = ['board', 'activity', 'posts'] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

export const TAB_NAMES: Record<ProfileTab, string> = {
  board: 'Board',
  activity: 'Activity',
  posts: 'Posts',
}

/** The tabs that have something in them, in their fixed order. */
export function tabsOf(filled: Partial<Record<ProfileTab, boolean>>): ProfileTab[] {
  return PROFILE_TABS.filter((tab) => filled[tab])
}

/** The tab to show: the one picked while it still has something, else the first that does. */
export function shownTab(tabs: ProfileTab[], picked: ProfileTab | undefined): ProfileTab | undefined {
  return picked && tabs.includes(picked) ? picked : tabs[0]
}

/** A secret as a row shows it at rest: dots, then its last 4 characters (all dots when it is that short). */
export function masked(secret: string): string {
  const s = secret.trim()
  if (!s) return ''
  if (s.length <= 4) return '•'.repeat(s.length)
  return `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`
}
