/**
 * A Project's `git.watch`, shared by every card and Diff that shows it:
 * one stream, one fetch every 30 seconds, however many are open.
 */
import { useCallback, useSyncExternalStore } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Status } from "@banda/contract/git"

type Watched = {
  status: Status | null
  hearing: Set<() => void>
  /** How to stop the stream; none while it is not heard. */
  stop?: () => void
  leaving?: ReturnType<typeof setTimeout>
}

const watched = new WeakMap<Engine, Map<ProjectId, Watched>>()

/** How long a Project's watch stays after its last hearer went: a popover
 * opened again has the status at once, and fetches no more. */
const LINGER = 60_000
/** How long after the engine ended a watch it is asked again. */
const AGAIN = 1000

function watching(engine: Engine, project: ProjectId): Watched {
  let projects = watched.get(engine)
  if (!projects) watched.set(engine, (projects = new Map()))
  let watch = projects.get(project)
  if (!watch)
    projects.set(project, (watch = { status: null, hearing: new Set() }))
  return watch
}

function tell(watch: Watched, status: Status | null): void {
  watch.status = status
  for (const hear of watch.hearing) hear()
}

function start(engine: Engine, project: ProjectId, watch: Watched): void {
  watch.stop = engine.stream(
    project,
    "git.watch",
    {},
    (status) => tell(watch, status),
    (refusal) => {
      watch.stop = undefined
      tell(watch, null)
      // Ended unasked, it is asked again while some still hear it;
      // refused, by the next to come.
      if (refusal) return
      setTimeout(() => {
        if (!watch.stop && watch.hearing.size > 0) start(engine, project, watch)
      }, AGAIN)
    }
  )
}

/** Hears each change of the Project's status, starting its watch; returns
 * how to stop. The watch lingers a while after the last hearer went. */
export function hearStatus(
  engine: Engine,
  project: ProjectId,
  hear: () => void
): () => void {
  const watch = watching(engine, project)
  clearTimeout(watch.leaving)
  watch.hearing.add(hear)
  if (!watch.stop) start(engine, project, watch)
  return () => {
    watch.hearing.delete(hear)
    if (watch.hearing.size > 0) return
    watch.leaving = setTimeout(() => {
      watch.stop?.()
      watch.stop = undefined
      // Only this watch: a newer one of the Project stays.
      const projects = watched.get(engine)
      if (projects?.get(project) === watch) projects.delete(project)
    }, LINGER)
  }
}

/** The Project's status as its watch last said it. */
export function statusOf(engine: Engine, project: ProjectId): Status | null {
  return watched.get(engine)?.get(project)?.status ?? null
}

/** The Project's status as `git.watch` says it; none until it first does,
 * when the engine refuses it, or while it is not `heard`, when nothing
 * watches it for this. */
export function useGitStatus(
  engine: Engine,
  project: ProjectId,
  heard = true
): Status | null {
  const subscribe = useCallback(
    (hear: () => void) =>
      heard ? hearStatus(engine, project, hear) : () => {},
    [engine, project, heard]
  )
  return useSyncExternalStore(subscribe, () =>
    heard ? statusOf(engine, project) : null
  )
}

/** How many files, in words: `1 file`, `2 files`. */
export function filesOf(count: number): string {
  return count === 1 ? "1 file" : `${count} files`
}
