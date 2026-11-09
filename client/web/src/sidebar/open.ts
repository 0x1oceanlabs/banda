import { createContext, useContext } from "react"
import type { ProjectId } from "@banda/contract"
import { type Run, useRun } from "@banda/core/react"
import type { Row } from "./arrange"

/**
 * How the Sidebar shown over the Strip lets itself go, for its parts that
 * open a Pane or a menu: it has done its work then (ADR 0025, decision
 * 10). None while it is docked.
 */
export const Dismiss = createContext<(() => void) | undefined>(undefined)

/** `run`, once the Sidebar over the Strip has gone (`dismiss`). */
export function dismissing(run: Run, dismiss?: () => void): Run {
  return (action, args) => {
    dismiss?.()
    run(action, args)
  }
}

/**
 * How a part of the sidebar runs what opens a Pane or a menu, by the
 * Window's actions (ADR 0087, decision 11): the Sidebar over the Strip
 * goes first. What changes in place, as a pin, a wake or a Flow, runs by
 * `useRun` and leaves it there.
 */
export function useOpen(): Run {
  return dismissing(useRun(), useContext(Dismiss))
}

/**
 * A new Thread in `project`, as its key starts one (`thread.new`, the
 * agents module's); a Project whose folder is missing finds it first (ADR
 * 0026, decision 6).
 */
export function newThread(open: Run, project: ProjectId, missing = false) {
  if (missing) open("projects.locate", { project })
  else open("thread.new", { project })
}

/**
 * Opens the Pane a row stands for, as `pane.pick` does: where a workspace
 * shows it, or in a new column of the current one. A Thread that woke is
 * seen as its Pane shows it to its Person (ADR 0074).
 */
export function useOpenRow(row: Row): () => void {
  const open = useOpen()
  return () =>
    open("pane.pick", { project: row.project.id, pane: row.listed.pane })
}
