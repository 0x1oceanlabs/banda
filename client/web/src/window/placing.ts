import { useCallback, useMemo } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { tomlOf } from "@banda/contract/settings"
import { type Flow, TILING_FILE } from "@banda/contract/workspaces"
import { sameEach, useStore } from "@banda/core/react"
import { type Stores, threadlessIn } from "../calls/stores"
import { logged, type Write } from "../settings/write"
import type { PickFlow } from "../tiling/flow"
import type { Gone } from "../tiling/model"
import { noProjectOf, type Placing, placingOf } from "../tiling/opening"

/**
 * How the Person works the Panes in `flow` (`placingOf`), and whether a
 * Project's emptied workspace goes once the Person has left it, as the
 * Projects are now and the `stores` list their Threads: one with no
 * Threads (ADR 0102, decision 2); one of no Project, a draft in the
 * `machine`'s own ID too (`noProjectOf`), which owns none (decision 1);
 * and one the window does not know, archived or removed, which the bar
 * could not name.
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
  gone: Gone
  strict: boolean
  projectOf: (id: ProjectId) => ProjectSummary | undefined
} {
  const threadless = useStore(stores.items, threadlessIn, sameEach)
  const none = useMemo(
    () => noProjectOf(projects, machine),
    [projects, machine]
  )
  const placing = useMemo(() => placingOf(flow, none), [flow, none])
  const projectOf = useCallback(
    (id: ProjectId) => projects.find((project) => project.id === id),
    [projects]
  )
  const gone = useMemo(
    () => goneOf(threadless, none, projects),
    [threadless, none, projects]
  )
  return { placing, gone, strict: flow !== "free", projectOf }
}

/** Whether a Project's emptied workspace goes: it has no Threads but
 * archived ones (`threadless`), it is of no Project (`none`), or it is
 * none of the `projects` the window knows, archived or removed, so the
 * bar could not name it (ADR 0102, decision 2). */
export function goneOf(
  threadless: readonly ProjectId[],
  none: readonly ProjectId[],
  projects: readonly ProjectSummary[]
): Gone {
  const known = new Set(projects.map((project) => project.id))
  return (id) => threadless.includes(id) || none.includes(id) || !known.has(id)
}

/** Writes what a pick of the Flow says tiling.toml is to say now
 * (`PickFlow`), when it changes how the engine places (ADR 0127, decision
 * 4): the look brings it back, and what went wrong goes to the console. */
export function writeFlow(write: Write, flow: ReturnType<PickFlow>): void {
  const file = TILING_FILE.name
  if (flow) logged(file, write(file, "flow", tomlOf(flow)))
}
