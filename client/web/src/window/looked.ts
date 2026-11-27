/**
 * A Pane an Agent opened is marked until the Person looks at it: has it
 * in focus, while `looking`, the window in front and no overview over it
 * (ADR 0032). Which they looked at is kept.
 */
import { useCallback, useEffect, useState } from "react"
import { type Entry, entries, focused, type Workspaces } from "../tiling/model"
import { keepLooked, loadLooked } from "../tiling/store"

/** Whether `entry` is marked still. */
export function useMarked(
  workspaces: Workspaces,
  looking: boolean
): (entry: Entry) => boolean {
  const [looked, setLooked] = useState(loadLooked)
  const lookedAt = (looking && focused(workspaces)) || undefined
  if (lookedAt?.by && !looked.has(lookedAt.id)) {
    // Only the Panes still there are kept.
    const now = new Set([lookedAt.id])
    for (const entry of entries(workspaces))
      if (looked.has(entry.id)) now.add(entry.id)
    setLooked(now)
  }
  useEffect(() => keepLooked(looked), [looked])
  return useCallback(
    (entry: Entry) => entry.by !== undefined && !looked.has(entry.id),
    [looked]
  )
}
