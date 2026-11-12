import { createContext, useContext } from "react"
import { type Run, useRun } from "@banda/core/react"
import type { CardRow } from "./card"

/**
 * How the Sidebar shown over the Strip lets itself go, for its parts that
 * open a Pane or a menu: it has done its work then (ADR 0025, decision
 * 10). None while it is docked.
 */
export const Dismiss = createContext<(() => void) | undefined>(undefined)

/**
 * How a part of the sidebar runs what opens a Pane or a menu, by the
 * Window's actions (ADR 0087, decision 11): the Sidebar over the Strip
 * goes first. What changes in place, as a pin, a wake or a Flow, runs by
 * `useRun` and leaves it there.
 */
export function useOpen(): Run {
  const run = useRun()
  const dismiss = useContext(Dismiss)
  return (action, args) => {
    dismiss?.()
    run(action, args)
  }
}

/**
 * Opens the Pane a row stands for, as `pane.pick` does: where a workspace
 * shows it, or in a new column of the current one. A Thread that woke is
 * seen as its Pane shows it to its Person (ADR 0074).
 */
export function useOpenRow(
  row: Pick<CardRow, "project" | "listed">
): () => void {
  const open = useOpen()
  return () =>
    open("pane.pick", { project: row.project.id, pane: row.listed.pane })
}
