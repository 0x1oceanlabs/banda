/**
 * Which Threads the Person put away, as T3 Code settles them (ADR 0008,
 * decision 4): one of the Person's own marks the sidebar keeps (ADR 0005,
 * decision 8), kept by the window as "seen" is.
 */
import type { SpaceId } from "@banda/contract"
import { works } from "@banda/ui/components/banda-mark"
import { kept } from "@banda/ui/lib/kept"
import type { Listed } from "@banda/ui/pane"
import type { Lists } from "../bar/Watches"

/** What the Person said of a row, and when: put away, or kept out. */
export type Say = { settled: boolean; at: number }

export type Says = Readonly<Record<string, Say>>

/** Three days with nothing new settle a Thread by itself. */
export const SETTLE_AFTER = 3 * 24 * 60 * 60 * 1000

/** Whether the Person may settle `listed`: not at work, not asking. */
export function settles(listed: Listed): boolean {
  return !works(listed.mark) && listed.mark !== "asking"
}

/**
 * Whether `listed` is settled `now`. What the Person said holds until
 * something new happens in it; without that, three quiet days settle it.
 * Work going on, or a question, is never settled.
 */
export function isSettled(
  listed: Listed,
  say: Say | undefined,
  now: number
): boolean {
  if (!settles(listed)) return false
  if (say && listed.changed <= say.at) return say.settled
  return now - listed.changed > SETTLE_AFTER
}

const says = kept(
  "banda.sidebar.settled",
  (say): say is Say =>
    typeof say === "object" &&
    say !== null &&
    typeof (say as Say).settled === "boolean" &&
    typeof (say as Say).at === "number"
)

/** What this window's Person said of each row, kept current. */
export const useSettled = says.use

/** Keeps that the Person settled `id`, or brought it back, now. */
export function settle(id: string, settled: boolean) {
  says.put(id, { settled, at: Date.now() })
}

/**
 * Settles the row of `space` that is `thing`, as Alt+S on the Pane that
 * shows it asks, or brings it back if it is settled now.
 */
export function toggleSettled(lists: Lists, space: SpaceId, thing: string) {
  const listed = lists[space]?.find((row) => row.id === thing)
  if (!listed) return
  if (isSettled(listed, says.read()[listed.id], Date.now()))
    settle(listed.id, false)
  else if (settles(listed)) settle(listed.id, true)
}
