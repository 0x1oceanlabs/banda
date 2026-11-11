/**
 * Undo of the Person's acts on a card (ADR 0098, decision 10; spec S7a):
 * each act keeps what puts back what was, which its ghost line's Undo
 * runs; an archive is told in the one toast, `sidebar-undo`, as
 * "Archived · Undo", and more while it shows add to it, "Archived 3", its
 * time starting again, and its Undo takes all of them back. What is put
 * back is the Thread's mark and its Later, never its Panes: one brought
 * back from the Archive opens none (#1069).
 */
import type { ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import type { Run } from "@banda/core/react"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { asleep } from "@banda/ui/status"
import type { Act } from "./acts"
import { itemActionOf } from "./items"

/** One step that puts back what an act changed: what it does, by the
 * Thread's item actions, and with what. */
export type Step = { does: "archive" | "later" | "wake"; args: Args }

/** How `listed` sleeps at `now`, as the Later that puts it back to sleep
 * takes it: till a time, its turn's end or Someday; none awake. */
function sleepOf(listed: Listed, now: number): Args | undefined {
  const later = listed.later
  if (!later || !asleep(listed, now)) return undefined
  if (later.someday) return { someday: true }
  return later.until === undefined ? { done: true } : { until: later.until }
}

/**
 * What puts back what `act` changed of `listed`, as it stood just before,
 * at `now`:
 * - an archive brings it back, and puts it back to sleep as it slept,
 *   till the same time, its turn's end or Someday, as archiving ended its
 *   Later;
 * - an Unarchive archives it again;
 * - a Later or a Wake puts its Later back as it was, asleep or awake.
 */
export function undoOf(act: Act, listed: Listed, now: number): Step[] {
  const slept = sleepOf(listed, now)
  const sleep: Step[] = slept ? [{ does: "later", args: slept }] : []
  switch (act) {
    case "archive":
      return [{ does: "archive", args: { archived: false } }, ...sleep]
    case "unarchive":
      return [{ does: "archive", args: { archived: true } }]
    case "later":
    case "wake":
      return slept ? sleep : [{ does: "wake", args: {} }]
  }
}

/** What takes back one act: the Thread it was on, and its steps. */
export type Undoable = {
  project: ProjectId
  listed: Listed
  steps: readonly Step[]
}

/** The toast's one id, so each archive adds to the one that shows. */
export const UNDO_TOAST = "sidebar-undo"

/** How long the toast stays, in ms; Sonner holds it while the pointer is
 * on it. */
const LASTS = 6000

/** The archives the toast shows tells of, the first first. */
let told: readonly Undoable[] = []

const forget = () => {
  told = []
}

/** Runs `done`'s steps, by its Thread's App's item actions. */
function runSteps(run: Run, { project, listed, steps }: Undoable): void {
  for (const { does, args } of steps) {
    const action = itemActionOf(listed, does)
    if (action) run(action.id, { project, item: listed.id, ...args })
  }
}

/** The toast, telling of `archives`; none takes it away. */
function tell(run: Run, archives: readonly Undoable[]): void {
  told = archives
  if (archives.length === 0) {
    toast.dismiss(UNDO_TOAST)
    return
  }
  const count = archives.length > 1 ? ` ${archives.length}` : ""
  toast(`Archived${count}`, {
    id: UNDO_TOAST,
    duration: LASTS,
    action: {
      label: "Undo",
      onClick: () => {
        const all = told
        forget()
        for (const done of all) runSteps(run, done)
      },
    },
    onDismiss: forget,
    onAutoClose: forget,
  })
}

/** Tells of an archive in the toast, whose Undo then takes it back with
 * the others it tells of. */
export function toldArchived(run: Run, done: Undoable): void {
  tell(run, [...told, done])
}

/** Puts back what `done` changed, as a ghost line's Undo does: the toast
 * no longer tells of it. */
export function putBack(run: Run, done: Undoable): void {
  runSteps(run, done)
  if (told.includes(done))
    tell(
      run,
      told.filter((one) => one !== done)
    )
}
