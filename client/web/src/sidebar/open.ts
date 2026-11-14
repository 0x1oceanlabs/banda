import { createContext, useContext } from "react"
import { type Run, useRun } from "@banda/core/react"

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
