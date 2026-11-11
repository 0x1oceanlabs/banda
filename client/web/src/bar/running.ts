/**
 * How many of this machine's terminals run a program in front, whichever
 * window opened them (ADR 0106, decision 4; `terminal.running`). Its
 * update waits for them as it does for the Threads. Each Project says its
 * own count, so the sum is held only while an update needs it.
 */
import type { Engine, ProjectId } from "@banda/contract"
import { onProjectsChanged } from "@banda/ui/lib/projects"
import { useEffect, useState } from "react"

/** The sum over `engine`'s Projects, heard while `held`; none until every
 * Project answered, so nothing reads no answer as no program. A Project
 * whose engine has no such stream answers none: it runs no terminal the
 * update could stop. */
export function useRunningHere(
  engine: Engine,
  held: boolean
): number | undefined {
  const [running, setRunning] = useState<number>()
  useEffect(() => {
    if (!held) return
    let left = false
    const counts = new Map<ProjectId, number | undefined>()
    const stops = new Map<ProjectId, () => void>()
    const tell = () => {
      const each = [...counts.values()]
      if (each.includes(undefined)) return
      setRunning(each.reduce<number>((all, one) => all + (one ?? 0), 0))
    }
    const follow = (project: ProjectId) => {
      counts.set(project, undefined)
      const stop = engine.stream(
        project,
        "terminal.running",
        {},
        ({ terminals }) => {
          counts.set(project, terminals)
          tell()
        },
        () => {
          counts.set(project, 0)
          tell()
        }
      )
      stops.set(project, stop)
    }
    // A Project gone, or one added meanwhile, as the list says now.
    const list = (projects: readonly { id: ProjectId }[]) => {
      if (left) return
      const listed = new Set(projects.map((one) => one.id))
      for (const [project, stop] of stops)
        if (!listed.has(project)) {
          stop()
          stops.delete(project)
          counts.delete(project)
        }
      for (const { id } of projects) if (!stops.has(id)) follow(id)
      tell()
    }
    // A list that cannot be read leaves what it had: an update must not
    // wait for ever on an engine out of reach, which runs no terminal.
    const read = () =>
      void engine.call("projects.list", {}).then(list, () => {
        if (!left) tell()
      })
    read()
    const stopHearing = onProjectsChanged(read)
    return () => {
      left = true
      stopHearing()
      for (const stop of stops.values()) stop()
      setRunning(undefined)
    }
  }, [engine, held])
  return running
}
