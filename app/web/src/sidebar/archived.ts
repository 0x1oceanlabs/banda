/**
 * Which Threads the Person archived (ADR 0069; ADR 0008, decision 4): one
 * of the Person's own marks the sidebar keeps (ADR 0005, decision 8), kept
 * by the window as "seen" is. Only the Person archives a Thread, and
 * anything new in it brings it back, as a reply brings a letter back in
 * Gmail.
 */
import type { ProjectId } from "@banda/contract"
import { useCallback } from "react"
import { works } from "@banda/ui/components/banda-mark"
import { kept } from "@banda/ui/lib/kept"
import { DAY } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"

/** What the Person said of a row, and when: archived, or brought back. */
export type Say = { archived: boolean; at: number }

/** Where the window keeps what the Person said. */
const KEY = "banda.sidebar.archived"

/** Where the window keeps the moment `cutoff` gave. */
const CUTOFF_KEY = "banda.sidebar.archived-before"

/** Whether the Person may archive `listed`: not at work, not asking. */
export function archivable(listed: Listed): boolean {
  return !works(listed.mark) && listed.mark !== "asking"
}

/**
 * Whether `listed` is archived. What the Person said holds until
 * something new happens in it; without that, it is archived only if
 * nothing has happened in it since `before`. Work going on, or a
 * question, is never archived.
 */
export function isArchived(
  listed: Listed,
  say: Say | undefined,
  before: number
): boolean {
  if (!archivable(listed)) return false
  if (say && listed.changed <= say.at) return say.archived
  return listed.changed <= before
}

/**
 * The moment before which a quiet Thread is archived, kept in `storage`
 * the first time: what the three quiet days had archived when a window
 * that had them first started without them, so nothing came back by the
 * change (ADR 0069, decision 5). A window that never had them, with
 * nothing of Banda's kept yet, archives nothing so: 0.
 */
export function cutoff(storage: Storage, now: number): number {
  const kept = storage.getItem(CUTOFF_KEY)
  if (kept !== null) return Number(kept) || 0
  let older = false
  for (let n = 0; n < storage.length; n++)
    older ||= storage.key(n)?.startsWith("banda.") ?? false
  const before = older ? now - 3 * DAY : 0
  storage.setItem(CUTOFF_KEY, String(before))
  return before
}

/** The moment before which a quiet Thread is archived; 0 for none. */
const BEFORE = (() => {
  // No window, as in a test: nothing was archived by the three days.
  if (typeof window === "undefined") return 0
  try {
    return cutoff(window.localStorage, Date.now())
  } catch {
    // Its storage fails: nothing to read either.
    return 0
  }
})()

const says = kept(
  KEY,
  (say): say is Say =>
    typeof say === "object" &&
    say !== null &&
    typeof (say as Say).archived === "boolean" &&
    typeof (say as Say).at === "number",
  // Nothing archives a Thread by itself any more, so a say that fell off
  // would bring its Thread back: keep many.
  10_000
)

/** Whether a Thread is archived, kept current by what the Person says. */
export function useIsArchived(): (listed: Listed) => boolean {
  const said = says.use()
  return useCallback(
    (listed: Listed) => isArchived(listed, said[listed.id], BEFORE),
    [said]
  )
}

/** Keeps that the Person archived `id`, or brought it back, now. */
export function archive(id: string, archived: boolean) {
  says.put(id, { archived, at: Date.now() })
}

/**
 * What Alt+S makes the row of `project` that is `thing`: archived, or back
 * if it is archived now. Nothing when it can be neither, as a Thread at
 * work.
 */
export function toggled(
  lists: Lists,
  project: ProjectId,
  thing: string
): boolean | undefined {
  const listed = lists[project]?.find((row) => row.id === thing)
  if (!listed) return undefined
  if (isArchived(listed, says.read()[listed.id], BEFORE)) return false
  return archivable(listed) ? true : undefined
}
