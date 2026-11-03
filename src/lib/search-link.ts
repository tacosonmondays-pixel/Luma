// Open Search with a query already running (a pinned song on someone's profile).

import { navigate } from './router.ts'

let pending: string | undefined

export function searchFor(query: string, replace = false): void {
  pending = query
  navigate('/search', replace)
}

/** The query to run as Search opens. Search clears it once it runs. */
export const askedSearch = (): string | undefined => pending

export function clearSearch(): void {
  pending = undefined
}
