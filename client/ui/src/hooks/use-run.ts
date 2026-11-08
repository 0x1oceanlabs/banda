import { createContext, useContext } from "react"
import type { Args } from "../module"

/** Runs an action by its id, as its key would, with `args`. */
export type Run = (action: string, args?: Args) => void

/**
 * The Window's run (ADR 0087, decision 11): it acts with the Here of the
 * click, as each action reads where the Person is as it runs. Only the
 * Window gives it; outside one nothing runs, as in a test or a Pane's own
 * window.
 */
export const RunContext = createContext<Run>(() => undefined)

/**
 * Runs an action by its id, the Window's, the Tiling's or an App's, with
 * the Here of the click: how the sidebar list, the Thread menus and the
 * machine label do what the Person asks, and the Bar's widgets once B4f
 * hands it to them.
 */
export function useRun(): Run {
  return useContext(RunContext)
}
