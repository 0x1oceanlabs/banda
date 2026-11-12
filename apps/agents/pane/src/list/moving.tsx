/**
 * Moving a Thread to another Project, as the Person asks it from the
 * Thread menu (ADR 0098, decision 14; ADR 0116, decision 7): the Projects
 * the dialog lists ({@link placesOf}, `MoveThread.tsx`), and the move
 * itself, which goes on after the dialog closed ({@link moveBeside},
 * {@link moveTo}), with a toast that says how far it is and stops it
 * while nothing changed yet.
 */
import type { Machine } from "@banda/core/react"
import { type Engine, newId, type ProjectId } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import type { MarkState } from "@banda/ui/lib/mark-state"
import type { WindowApi } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { mayArchive } from "@banda/ui/status"
import { paneOf } from "@banda/ui/pane"
import { threadPane } from "../ThreadPane"
import {
  carry,
  type End,
  type Looked,
  type Progress,
  Stopped,
  Unsent,
} from "./carry"

/** The Top layer part that moves a Thread, as `WindowApi.top` asks for
 * it: its args are the Thread's `project` and `item`, and `to`, the
 * Project it moves to, when what asked names one. */
export const MOVE = "agents.move"

/** A Thread the Person moves: where it is. */
export type Asked = { project: ProjectId; listed: Listed }

/** A Project a Thread may move to, and the machine it is on. */
export type Place = {
  project: ProjectId
  name: string
  folder: string
  /** Its machine's key in `hosts.toml`; none for this machine. */
  host?: string
}

/** The machines' Projects a Thread in `project` on `host` may move to,
 * as the dialog groups them: its own machine first, then the others as
 * the Window lists them, an away one with none. Not the Project it is
 * in, and none of No Project. */
export function placesOf<M extends Machine>(
  machines: readonly M[],
  project: ProjectId,
  host: string | undefined
): { machine: M; own: boolean; places: Place[] }[] {
  const groups = machines.map((machine) => ({
    machine,
    own: machine.host === host,
    places:
      machine.state === "away"
        ? []
        : machine.projects
            .filter((one) => one.id !== project && !one.scratch)
            .map(({ id, name, folder }) => ({
              project: id,
              name,
              folder,
              ...(machine.host !== undefined && { host: machine.host }),
            })),
  }))
  return [
    ...groups.filter((group) => group.own),
    ...groups.filter((group) => !group.own),
  ]
}

/** Whether a Thread works or asks: it moves once it is at rest. */
export const busy = (mark: MarkState) => !mayArchive({ mark })

/** How long a move is quiet at first: a quick one only says its end. */
const QUIET = 400

/** "8 KB", "3.1 MB": a size a toast says. */
export function sized(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** How far a move is: its bytes, and a thin bar. */
function Far({ done, of }: Progress) {
  const part = of > 0 ? Math.min(1, done / of) : 0
  return (
    <span className="flex w-56 flex-col gap-1">
      <span className="truncate tabular-nums">
        {of > 0 ? `${sized(done)} of ${sized(of)}` : "Packing…"}
      </span>
      <span
        role="progressbar"
        aria-label="How far the move is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(part * 100)}
        className="block h-1 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className="block h-full rounded-full bg-foreground/60"
          style={{ width: `${part * 100}%` }}
        />
      </span>
    </span>
  )
}

/** Shows the Thread in the Project it moved to, in place of the Panes
 * that showed it where it was. */
function follow(
  window: WindowApi,
  from: ProjectId,
  to: ProjectId,
  { id, harness, title }: Listed
) {
  window.run("pane.put-away", { project: from, item: id })
  window.run("pane.pick", {
    project: to,
    pane: paneOf(threadPane, {
      thread: id as ThreadId,
      harness: harness ?? "",
      title,
    }),
  })
}

/**
 * Moves the Thread to another Project of its own machine, as
 * `agents.move_thread` does, and shows it there.
 */
export async function moveBeside(
  window: WindowApi,
  engine: Engine,
  { project, listed }: Asked,
  to: Place
): Promise<void> {
  const thread = listed.id as ThreadId
  try {
    await engine.commandAt(
      "agents.move_thread",
      { thread, project: to.project },
      project,
      newId(),
      { once: true }
    )
    follow(window, project, to.project, listed)
    toast(`Moved to ${to.name}`)
  } catch (error) {
    toast.error(problem(error, "Move to Project"))
  }
}

/**
 * Moves the Thread to a Project on another machine (`carry`), saying how
 * far it is in a toast, whose Cancel stops it while nothing changed
 * there; once it left, it is shown where it went. A Thread at work moves
 * once its turn ends, while this Window is open: `items` says when.
 */
export async function moveTo(
  window: WindowApi,
  { project, listed }: Asked,
  { from, to }: { from: End; to: End },
  looked: () => Promise<Looked>,
  message: string
): Promise<void> {
  const thread = listed.id as ThreadId
  const id = `agents.move.${thread}`
  const where = `${to.name} on ${to.machine}`
  const stop = new AbortController()
  let shown = false
  // The toast stays, to say how it stopped.
  const cancel = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    stop.abort()
  }
  const dismiss = () => {
    if (shown) toast.dismiss(id)
    shown = false
  }
  try {
    const now = () =>
      window.items.get()[project]?.find((one) => one.id === listed.id)
    if (busy(now()?.mark ?? listed.mark)) {
      shown = true
      toast(`Moves to ${where} once its turn ends`, {
        id,
        duration: Infinity,
        action: { label: "Cancel", onClick: cancel },
      })
      await atRest(window, () => now()?.mark, stop.signal)
    }
    let last: Progress = { done: 0, of: 0 }
    const show = () => {
      shown = true
      toast(
        last.arriving ? `Arriving on ${to.machine}…` : `Moving to ${where}…`,
        {
          id,
          duration: Infinity,
          description: <Far {...last} />,
          // Once the other machine unpacks, it goes through.
          action: last.arriving
            ? undefined
            : { label: "Cancel", onClick: cancel },
        }
      )
    }
    const timer = shown ? undefined : setTimeout(show, QUIET)
    if (shown) show()
    await carry({ thread, from, to }, await looked(), {
      message,
      stop: stop.signal,
      onProgress: (progress) => {
        last = progress
        if (shown) show()
      },
    }).finally(() => clearTimeout(timer))
    follow(window, project, to.project, listed)
    shown = false
    // In the progress toast's place, and gone in its time as any other:
    // one that took the id keeps the time it was given.
    toast(`Moved to ${where}`, {
      id,
      description: undefined,
      action: undefined,
      duration: 4000,
    })
  } catch (error) {
    dismiss()
    if (error instanceof Stopped) {
      toast(`Not moved: the Thread stays on ${from.machine}.`)
    } else if (error instanceof Unsent) {
      follow(window, project, to.project, listed)
      // Its words are not lost: the toast keeps them to copy.
      const { words } = error
      toast.error(`Moved to ${where}, but your message was not sent`, {
        description: `${error.message} “${words}”`,
        duration: Infinity,
        action: {
          label: "Copy",
          onClick: () => void navigator.clipboard.writeText(words),
        },
      })
    } else {
      toast.error(problem(error, "Move"))
    }
  }
}

/** Waits until the Thread is at rest, as the Window's lists say it;
 * stopped, it throws {@link Stopped}. */
function atRest(
  window: WindowApi,
  mark: () => MarkState | undefined,
  stop: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const heard = () => {
      if (stop.aborted) {
        end()
        reject(new Stopped())
        return
      }
      const now = mark()
      if (now !== undefined && busy(now)) return
      end()
      resolve()
    }
    const unsubscribe = window.items.subscribe(heard)
    const end = () => {
      unsubscribe()
      stop.removeEventListener("abort", heard)
    }
    stop.addEventListener("abort", heard)
    heard()
  })
}
