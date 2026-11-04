/**
 * The last notices, which the bell shows again (ADR 0048, decision 2;
 * ADR 0056, decision 2): plain data, so they are kept across a restart,
 * in the window's own storage. A thing's newer notice takes its older's
 * place.
 */
import { type Told, toldOf } from "./told"

/** How many of the last notices the bell shows. */
export const LAST = 5

/** Where the window keeps them. */
const KEPT = "banda.notifications.recent"

/** `kept` with `told` the newest, a thing's older one gone, `LAST` at
 * most, the oldest first. Pure, so plain tests cover it. */
export function withNewest(kept: readonly Told[], told: Told): Told[] {
  return [...kept.filter((one) => one.key !== told.key), told].slice(-LAST)
}

function read(): Told[] {
  try {
    const said: unknown = JSON.parse(localStorage.getItem(KEPT) ?? "[]")
    if (!Array.isArray(said)) return []
    return said.flatMap((one) => {
      const told = toldOf(one)
      return told ? [told] : []
    })
  } catch {
    return []
  }
}

let recent: Told[] | null = null

/** The last notices, the oldest first. */
export function recentNow(): readonly Told[] {
  recent ??= read()
  return recent
}

/** Keeps `told` as the newest. */
export function keep(told: Told): void {
  recent = withNewest(recentNow(), told)
  try {
    localStorage.setItem(KEPT, JSON.stringify(recent))
  } catch {
    // A window that keeps nothing shows what it told since it started.
  }
}
