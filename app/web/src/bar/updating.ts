/**
 * What the bar shows of Banda's own update (ADR 0041, decision 4). Pure,
 * so plain tests cover it; Update.tsx draws it.
 */
import type { Update } from "../host"

/** How long a download runs before the bar shows it: a Dev that differs
 * by a few blocks is down sooner, and the bar would only flicker. */
export const SHOW_AFTER = 2000

/** The line on hover. */
export function lineOf(update: Update): string {
  const named = (version: string) => `${update.name} ${version}`
  switch (update.state) {
    case "none":
      return ""
    case "downloading":
      return `Downloading ${named(update.version)} · ${Math.round(update.share * 100)}%`
    case "ready":
      return `${named(update.version)} is ready: it installs when you quit ${update.name}`
    case "failed":
      return `${update.name} cannot update itself: ${update.reason}`
  }
}

/** A version as the popover's list names it: a Dev by its number
 * (`dev.66`), a Stable whole (`0.2.0`). */
export function shortOf(version: string): string {
  return /-(.+)$/.exec(version)?.[1] ?? version
}

/** How the popover says that Threads work, which a restart stops. */
export function workingWords(working: number): string | undefined {
  if (working === 0) return undefined
  return working === 1
    ? "A Thread works: a restart stops its turn."
    : `${working} Threads work: a restart stops their turns.`
}
