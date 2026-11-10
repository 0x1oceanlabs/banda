import { useEffect, useRef } from "react"
import type { ProjectSummary } from "@banda/contract"
import type { Change } from "../tiling/arrange"
import { arranging, type Placing } from "./actions"

/**
 * A Project of no Project made a Project's (ADR 0046) takes its Panes to
 * its own workspace, in the row and solo, made at the end when it has
 * none (ADR 0102, decision 7). It keeps its ID, so only its `scratch`
 * changes.
 */
export function useMadeGoesHome(
  projects: readonly ProjectSummary[],
  placing: Placing,
  change: (how: Change) => unknown
): void {
  const scratch = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    const was = scratch.current
    scratch.current = new Set(
      projects.filter((one) => one.scratch).map((one) => one.id)
    )
    if (was === null || placing.flow === "free") return
    for (const one of projects)
      if (was.has(one.id) && !one.scratch)
        void change((w) => arranging(w, placing, one.id))
  }, [projects, placing, change])
}
