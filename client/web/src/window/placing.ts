import { useCallback, useMemo } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Flow } from "@banda/contract/agents"
import { sameEach, useStore } from "@banda/core/react"
import { type Stores, threadlessIn } from "../calls/stores"
import { noProjectOf, type Placing, placingOf } from "./actions"

/**
 * How the Person works the Panes in `flow` (`placingOf`), and the Projects
 * whose emptied workspace goes once the Person has left it, as the
 * Projects are now and the `stores` list their Threads: those with no
 * Threads (ADR 0102, decision 2), and those of no Project, a draft in the
 * `machine`'s own ID too (`noProjectOf`), which own none (decision 1).
 * `strict`: in the row and solo, an emptied Project's workspace keeps its
 * place; in the Flow free every workspace is free. `projectOf`: any
 * Project by its ID, its folder missing or not, as the bar names it.
 */
export function usePlacing(
  stores: Stores,
  flow: Flow,
  projects: readonly ProjectSummary[],
  machine: ProjectId | undefined
): {
  placing: Placing
  gone: readonly ProjectId[]
  strict: boolean
  projectOf: (id: ProjectId) => ProjectSummary | undefined
} {
  const threadless = useStore(stores.items, threadlessIn, sameEach)
  const none = useMemo(
    () => noProjectOf(projects, machine),
    [projects, machine]
  )
  const placing = useMemo(() => placingOf(flow, none), [flow, none])
  const gone = useMemo(() => [...threadless, ...none], [threadless, none])
  const projectOf = useCallback(
    (id: ProjectId) => projects.find((project) => project.id === id),
    [projects]
  )
  return { placing, gone, strict: flow !== "free", projectOf }
}
