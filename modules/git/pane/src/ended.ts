/**
 * How a run of the git button ended, told to the Person when no card of
 * its Project is in sight (`notifications.tell`): a card in sight says it
 * itself. What each step changed its Thread's Agent hears from the
 * engine (`git.acted`).
 */
import type { ProjectId } from "@banda/contract"
import { detailsShown } from "@banda/ui/components/thread-details"
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

/** How a run of the git button ended, as the card says it. */
export type Ended =
  | { is: "done"; title: string; detail?: string }
  | { is: "failed"; message: string }

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
        title: "Git failed",
        body: ended.message,
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
