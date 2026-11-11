/**
 * What a Thread's toast's buttons run (ADR 0056, decision 3): answer its
 * Question with a choice, try its failed turn again, or show it, as to
 * sign in there. Unlisted: only a toast runs them. Each goes to the
 * machine whose Thread it is, by its Project, as the window's directory
 * places it (`WindowApi.sessionOf`, ADR 0106, decision 1), never to this
 * machine's engine in its place.
 */
import type { Engine, ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import type { Action, Args, WindowApi } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { threadPane } from "../ThreadPane"
import { ANSWER, RETRY, SHOW } from "./rows"

/** An arg that is a text, or none. */
export const textOf = (args: Args | undefined, key: string) => {
  const value = args?.[key]
  return typeof value === "string" ? value : undefined
}

/**
 * Sends `what`, by `send`, to the machine whose Thread in `project` it is
 * about. A machine the Window does not reach now refuses it at once, and
 * a toast says why, naming that machine and `what`, as for what that
 * engine refuses.
 */
function sendTo(
  window: WindowApi,
  project: ProjectId,
  what: string,
  send: (engine: Engine) => Promise<unknown>
): void {
  const failed = (error: unknown) => void toast.error(problem(error, what))
  try {
    send(window.sessionOf(project)).catch(failed)
  } catch (error) {
    failed(error)
  }
}

/** The actions a toast's buttons run, by the ids its answers name. */
export const answering: Action[] = [
  {
    id: ANSWER,
    title: "Answer a Question",
    section: "Threads",
    unlisted: true,
    run: (window, args) => {
      const [project, item, choice] = ["project", "item", "choice"].map((key) =>
        textOf(args, key)
      )
      if (!args || !project || !item || !choice) return
      const at = project as ProjectId
      sendTo(window, at, "your answer", (engine) =>
        engine.command("agents.answer", { item, choice }, at)
      )
    },
  },
  {
    id: RETRY,
    title: "Try a turn again",
    section: "Threads",
    unlisted: true,
    run: (window, args) => {
      const [project, turn] = ["project", "turn"].map((key) =>
        textOf(args, key)
      )
      if (!args || !project || !turn) return
      const at = project as ProjectId
      sendTo(window, at, "Try again", (engine) =>
        engine.command("agents.retry", { turn }, at)
      )
    },
  },
  {
    id: SHOW,
    title: "Show a Thread",
    section: "Threads",
    unlisted: true,
    run: (window, args) => {
      const [project, thread, harness] = ["project", "thread", "harness"].map(
        (key) => textOf(args, key)
      )
      if (!project || !thread) return
      const pane = paneOf(threadPane, {
        thread,
        harness: harness ?? "",
        title: "",
      })
      // On the machine its Project is on, as the directory places it.
      window.open(pane, project as ProjectId, { again: false })
    },
  },
]
