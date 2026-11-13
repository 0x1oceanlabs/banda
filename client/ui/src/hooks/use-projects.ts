import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type Engine,
  type ProjectList,
  type ProjectSummary,
  Refused,
} from "@banda/contract"
import { onRestart } from "./use-file-url"
import { READ_AGAIN, type Source, useMachineLive } from "./use-live"
import type { Read } from "./use-read"
import { sameProjects } from "@banda/ui/lib/projects"

/** What a machine says as its Projects' list reads otherwise (ADR 0127):
 * the kernel's own fact, in that machine's log. */
const CHANGED = { module: "projects", kinds: ["changed"] }

const LOADING = { state: "loading" } as const

/** The list as `engine`'s machine says it, with its place in that
 * machine's log. An engine from before the fact refuses it as invalid, as
 * it has no such method: it has only its list, which names no place, and
 * says no change of it. Remove once no machine runs an engine from before
 * it. */
async function readList(engine: Engine): Promise<ProjectList> {
  try {
    return await engine.call("projects.listed", {})
  } catch (error) {
    if (!(error instanceof Refused) || error.refusal.code !== "invalid")
      throw error
    return { at: 0, projects: await engine.call("projects.list", {}) }
  }
}

/** The list of `engine`'s machine as a view followed in its log: read
 * again on each fact of its Projects. A list that says what it said keeps
 * the one before, so what draws it is not drawn again. */
function listOf(engine: Engine): Source<ProjectList> {
  let was: ProjectSummary[] | undefined
  return {
    read: async () => {
      const list = await readList(engine)
      if (was && sameProjects(was, list.projects))
        return { ...list, projects: was }
      was = list.projects
      return list
    },
    filter: CHANGED,
    apply: () => READ_AGAIN,
  }
}

/** How many times `engine` started anew since this mounted: what an engine
 * finds as it starts, as a folder gone while it was stopped, no fact says. */
function useStarts(engine: Engine): number {
  const [starts, setStarts] = useState(0)
  useEffect(
    () => onRestart(engine, () => setStarts((count) => count + 1)),
    [engine]
  )
  return starts
}

/**
 * Every Project of `engine`'s machine, the archived too (ADR 0026). Read
 * once, then again each time that machine says one changed (ADR 0127): a
 * Project added, renamed or removed anywhere, as by `banda project add`,
 * shows as the machine says so, on this machine and on another alike. A
 * list that says what it said keeps the one before. `put` draws a Project
 * the engine just answered ahead of the list that says it; the next list
 * read wins.
 */
export function useProjects(engine: Engine): {
  listed: Read<ProjectSummary[]>
  put: (project: ProjectSummary) => void
} {
  const source = useMemo(() => listOf(engine), [engine])
  const live = useMachineLive(engine, source, useStarts(engine))
  const view = live.state === "ready" ? live.view : undefined
  // What was put, over the list it was put on alone.
  const [ahead, setAhead] = useState<{
    on: ProjectList
    projects: ProjectSummary[]
  }>()
  const put = useCallback(
    (project: ProjectSummary) => {
      if (!view) return
      setAhead((was) => ({
        on: view,
        projects: [
          ...(was?.on === view ? was.projects : []).filter(
            (one) => one.id !== project.id
          ),
          project,
        ],
      }))
    },
    [view]
  )
  const read = view?.projects
  const over = ahead?.on === view ? ahead?.projects : undefined
  const projects = useMemo(
    () =>
      read && over
        ? [
            ...read.filter((one) => !over.some((put) => put.id === one.id)),
            ...over,
          ]
        : read,
    [read, over]
  )
  const refusal = live.state === "refused" ? live.refusal : undefined
  const listed = useMemo<Read<ProjectSummary[]>>(() => {
    if (projects) return { state: "ready", value: projects }
    return refusal ? { state: "refused", refusal } : LOADING
  }, [projects, refusal])
  return { listed, put }
}
