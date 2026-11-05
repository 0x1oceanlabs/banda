/**
 * What the bar shows of Banda's own update (ADR 0041, decision 4; ADR
 * 0072). Pure, so plain tests cover it; Update.tsx draws it.
 */
import { ago } from "@banda/ui/lib/words"
import type { Note, Update } from "../host"

/** How long a download runs before the bar shows it: a Dev that differs
 * by a few blocks is down sooner, and the bar would only flicker. */
export const SHOW_AFTER = 2000

/** How long no Thread works before Banda restarts into a version that
 * waits for them (ADR 0072, decision 3): a Thread's next turn may follow
 * its last at once. */
export const IDLE_FOR = 2000

/** How long a Banda that restarted into a new version says so on its own
 * (ADR 0072, decision 4). */
export const UPDATED_FOR = 6000

/** The line on hover, which says what a click does. */
export function lineOf(update: Update): string {
  switch (update.state) {
    case "none":
      return `${update.name} ${update.have}`
    case "looking":
      return `Looking for a new ${update.name}…`
    case "downloading":
      return `Downloading ${shortOf(update.version)} · ${percentOf(update.share)}`
    case "ready":
      return update.waits
        ? `Restarts into ${shortOf(update.version)} once no Thread works`
        : `${shortOf(update.version)} is ready · click to restart`
    case "out":
      return `${shortOf(update.version)} is out · install it with brew`
    case "updated":
      return `Updated to ${shortOf(update.have)}`
    case "failed":
      return `${update.name} cannot update itself: ${update.reason}`
  }
}

/** The version the icon names beside it (ADR 0072, decision 1): once one
 * is ready, out, or just came; none while one downloads. */
export function pillOf(update: Update): string | undefined {
  switch (update.state) {
    case "ready":
    case "out":
      return shortOf(update.version)
    case "updated":
      return shortOf(update.have)
    default:
      return undefined
  }
}

/** A version as the popover's list names it: a Dev by its number
 * (`dev.66`), a Stable whole (`0.2.0`). */
export function shortOf(version: string): string {
  return /-(.+)$/.exec(version)?.[1] ?? version
}

/** How many versions lie between the Person's and the new one, said
 * only when there are several. */
export function versionsWords(notes: readonly Note[]): string | undefined {
  return notes.length > 1 ? `${notes.length} versions newer` : undefined
}

/** How the popover says that Threads work, which a restart stops. */
export function workingWords(working: number): string | undefined {
  if (working === 0) return undefined
  return working === 1
    ? "A Thread is working. A restart stops its turn."
    : `${working} Threads are working. A restart stops their turns.`
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
  return `You have the newest · looked ${when === "now" ? "just now" : `${when} ago`}`
}

/** How much of a download is down, when electron-updater says:
 * `12 of 31 MB`. */
export function sizeWords(
  update: Extract<Update, { state: "downloading" }>
): string | undefined {
  const { down, size } = update
  if (down === undefined || !size) return undefined
  const mb = (bytes: number) => bytes / 1_000_000
  const digits = mb(size) < 10 ? 1 : 0
  return `${mb(down).toFixed(digits)} of ${mb(size).toFixed(digits)} MB`
}

/** A download's share as the bar says it: `38%`. */
export function percentOf(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** One note as the popover lists it: its scope apart, its kind gone. */
export type Line = { version: string; scope?: string; text: string }

/** The notes' groups, in the popover's order. */
export type Group = { title: "New" | "Fixed" | "Other"; lines: Line[] }

/** A Dev's note is its commit's title (`Built from 6e9145f: feat(window):
 * …`); a Stable's, any text. */
const TITLE =
  /^(?:Built from \w+: )?(?:(feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert)(?:\(([^)]*)\))?!?: )?(.+)$/s

/** The notes by kind (ADR 0072, decision 5): New for `feat`, Fixed for
 * `fix`, and the rest, or a note in no such form, in Other. */
export function groupsOf(notes: readonly Note[]): Group[] {
  const groups: Group[] = [
    { title: "New", lines: [] },
    { title: "Fixed", lines: [] },
    { title: "Other", lines: [] },
  ]
  for (const note of notes) {
    const [, kind, scope, text] = TITLE.exec(note.text.trim()) ?? []
    const at = kind === "feat" ? 0 : kind === "fix" ? 1 : 2
    groups[at]!.lines.push({
      version: note.version,
      scope: scope || undefined,
      text: text ?? note.text,
    })
  }
  return groups.filter((group) => group.lines.length > 0)
}

/** The first `count` lines of `groups`, in order. */
export function firstOf(groups: readonly Group[], count: number): Group[] {
  let left = count
  return groups
    .map((group) => {
      const lines = group.lines.slice(0, Math.max(0, left))
      left -= lines.length
      return { ...group, lines }
    })
    .filter((group) => group.lines.length > 0)
}
