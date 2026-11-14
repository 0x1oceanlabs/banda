/**
 * Undo of an archive from the sidebar (ADR 0098, decision 10, as
 * amended): told in the one toast, `sidebar-undo`, as "Archived · Undo",
 * and more while it shows add to it, "Archived 3", its time starting
 * again; its Undo takes all of them back. That button is the one Undo: no
 * key takes an act back. "Archive N done" is one act (decision 15), and
 * its toast says what it left.
 * What is put back is the Thread's mark and its Later, never its Panes:
 * one brought back from the Archive opens none (#1069).
 */
import type { ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import type { Run } from "@banda/core/react"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { asleep } from "@banda/ui/status"
import { itemActionOf } from "../window/items"

/** One step that puts back what an archive changed: what it does, by
 * the Thread's item actions, and with what. */
type Step = { does: "archive" | "later"; args: Args }

/** What takes back one archive: the Thread it was on, and its steps. */
export type Archived = {
  project: ProjectId
  listed: Listed
  steps: readonly Step[]
}

/** How `listed` sleeps at `now`, as the Later that puts it back to sleep
 * takes it: till a time, its turn's end or Someday; none awake. */
function sleepOf(listed: Listed, now: number): Args | undefined {
  const later = listed.later
  if (!later || !asleep(listed, now)) return undefined
  if (later.someday) return { someday: true }
  return later.until === undefined ? { done: true } : { until: later.until }
}

/** What takes back the archive of `listed`, as it stood just before, at
 * `now`: it comes back, and goes back to sleep as it slept, till the same
 * time, its turn's end or Someday, as archiving ended its Later. */
export function archivedOf(
  project: ProjectId,
  listed: Listed,
  now: number
): Archived {
  const slept = sleepOf(listed, now)
  return {
    project,
    listed,
    steps: [
      { does: "archive", args: { archived: false } },
      ...(slept ? [{ does: "later" as const, args: slept }] : []),
    ],
  }
}

/** The toast's one id, so each archive adds to the one that shows. */
export const UNDO_TOAST = "sidebar-undo"

/** How long the toast stays, in ms; Sonner holds it while the pointer is
 * on it. */
const LASTS = 6000

/** The archives the toast that shows tells of, the first first. */
let told: readonly Archived[] = []

const forget = () => {
  told = []
}

/** Tells of archives in the toast, whose Undo then takes them back with
 * the others it tells of, by their Threads' Apps' item actions, and of
 * what the act left, `left`, as "1 not reached (mac is away)". */
export function toldArchived(
  run: Run,
  done: readonly Archived[],
  left?: string
): void {
  told = [...told, ...done]
  if (told.length === 0) return
  const count = told.length > 1 ? ` ${told.length}` : ""
  toast([`Archived${count}`, left].filter(Boolean).join(" · "), {
    id: UNDO_TOAST,
    duration: LASTS,
    action: {
      label: "Undo",
      onClick: () => {
        const all = told
        forget()
        for (const { project, listed, steps } of all)
          for (const { does, args } of steps) {
            const action = itemActionOf(listed, does)
            if (action) run(action.id, { project, item: listed.id, ...args })
          }
      },
    },
    onDismiss: forget,
    onAutoClose: forget,
  })
}
