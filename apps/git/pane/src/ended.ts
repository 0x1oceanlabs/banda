/**
 * How a run of the git button ended, told to the Person when no card of
 * its Project is in sight (`notifications.tell`): a card in sight says it
 * itself. What each step changed its Thread's Agent hears from the
 * engine (`git.acted`).
 */
import type { ProjectId } from "@banda/contract"
import type { Action } from "@banda/contract/git"
import type { Args, WindowApi } from "@banda/ui/module"

/** What the window lets the module ask, while it runs. */
let kept: WindowApi | null = null

/** Keeps `window` for the module while it runs it; returns how to let it
 * go. */
export function keepWindow(window: WindowApi): () => void {
  kept = window
  return () => {
    if (kept === window) kept = null
  }
}

/** The cards git's rows are drawn in now, by Project: each one's Thread,
 * none for a new one. */
const drawn = new Map<ProjectId, Map<symbol, string | null>>()

/** Says git's rows are drawn in the card of `thread` in `project`, as they
 * are while the card shows; returns how to say they are not. */
export function showDetails(
  project: ProjectId,
  thread: string | null
): () => void {
  const one = Symbol(project)
  const cards = drawn.get(project) ?? new Map<symbol, string | null>()
  drawn.set(project, cards.set(one, thread))
  return () => {
    cards.delete(one)
    if (cards.size === 0 && drawn.get(project) === cards) drawn.delete(project)
  }
}

/** The Threads of `project` whose card is drawn now, none for a new
 * Thread's: what git's rows say there is seen, when its Thread is. */
function detailsShown(project: ProjectId): (string | null)[] {
  return [...(drawn.get(project)?.values() ?? [])]
}

/** What a run cut off on its way needs for Check to say what became of
 * it: what it did, and the commit it started from. */
export type Unsure = { action: Action; head: string | undefined }

/** How a run of the git button ended, as the card says it. One cut off
 * on its way, which may have gone through, carries `check`. */
export type Ended =
  | { is: "done"; title: string; detail?: string }
  | { is: "failed"; message: string; check?: Unsure }

/** The toast of a run that ended in `project`, as `notifications.tell`
 * takes it: one per Project, the next replacing it; a failure sounds and
 * says why. Of the Thread `about`, whose card is drawn, it tells nothing
 * while that Thread is on screen. */
export function toldOf(project: ProjectId, ended: Ended, about?: string): Args {
  const base = {
    key: `git.${project}`,
    in: project,
    ...(about ? { about } : {}),
    buttons: [],
  }
  return ended.is === "done"
    ? {
        ...base,
        kind: "done",
        title: ended.title,
        ...(ended.detail ? { body: ended.detail } : {}),
        silent: true,
      }
    : {
        ...base,
        kind: "failed",
        // Cut off on its way, it may not have failed at all.
        ...(ended.check
          ? { title: ended.message }
          : { title: "Git failed", body: ended.message }),
        close: true,
      }
}

/** Tells the Person how a run in `project` ended, unless a card of it in
 * sight says so: a new Thread's drawn, or a Thread's on screen. */
export function afterRun(project: ProjectId, run: Ended): void {
  if (!kept) return
  const shown = detailsShown(project)
  if (shown.includes(null)) return
  kept.run("notifications.tell", toldOf(project, run, shown[0] ?? undefined))
}
