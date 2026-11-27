/**
 * Whether the overview covers the workspaces (ADR 0025): open, closed, or
 * closing, while it moves away and is drawn still.
 */
import { useCallback, useState } from "react"

export function useOverviewShown() {
  const [overviewState, setOverview] = useState<"closed" | "open" | "closing">(
    "closed"
  )
  const toggleOverview = useCallback(
    () => setOverview((was) => (was === "open" ? "closing" : "open")),
    []
  )
  const closeOverview = useCallback(() => setOverview("closing"), [])
  // Its move away over, it is drawn no more.
  const leftOverview = useCallback(
    () => setOverview((was) => (was === "closing" ? "closed" : was)),
    []
  )
  return {
    overviewState,
    /** Drawn: open, or on its way out. */
    overview: overviewState !== "closed",
    toggleOverview,
    closeOverview,
    leftOverview,
  }
}
