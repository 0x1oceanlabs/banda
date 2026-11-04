/**
 * What the bar shows of Banda's own update (ADR 0041, decision 4). Pure,
 * so plain tests cover it; Update.tsx draws it.
 */
import { ago } from "@banda/ui/lib/words"
import type { Update } from "../host"

/** How long a download runs before the bar shows it: a Dev that differs
 * by a few blocks is down sooner, and the bar would only flicker. */
export const SHOW_AFTER = 2000

/** The line on hover. */
export function lineOf(update: Update): string {
  const named = (version: string) => `${update.name} ${version}`
  switch (update.state) {
    case "none":
      return named(update.have)
    case "looking":
      return `Looking for a new ${update.name}…`
    case "downloading":
      return `Downloading ${named(update.version)} · ${percentOf(update.share)}`
    case "ready":
      return `${named(update.version)} is ready: it installs when you quit ${update.name}`
    case "out":
      return `${named(update.version)} is out: ${update.command}`
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

/** What the popover says of a look while nothing new is known
 * (ADR 0045). */
export function lookedWords(
  update: Extract<Update, { state: "none" }>,
  now: number
): string {
  if (update.missed) return `Could not update: ${update.missed}`
  if (update.looked === undefined)
    return `${update.name} looks every hour, and when you ask`
  const when = ago(update.looked, now)
  return `You have the newest ${update.name} · looked ${when === "now" ? "just now" : `${when} ago`}`
}

/** How the popover says where a download goes. */
export function downloadWords(
  update: Extract<Update, { state: "downloading" }>
): string {
  const share = percentOf(update.share)
  return update.restarts
    ? `Downloading · ${share} · restarts when it is down`
    : `Downloading · ${share} · installs when you quit ${update.name}`
}

/** A download's share as the bar says it: `38%`. */
function percentOf(share: number): string {
  return `${Math.round(share * 100)}%`
}
