/**
 * How many of this machine's terminals run a program in front, whichever
 * window opened them (ADR 0106, decision 4; `terminal.running`). Its
 * update waits for them as it does for the Threads. Each Project says its
 * own count, so the sum is held only while an update needs it.
 */
import type { Engine, ProjectSummary } from "@banda/contract"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useEffect, useState } from "react"

const NONE: readonly ProjectSummary[] = []

/** The sum over `engine`'s Projects, heard while `held`; none until every
 * Project answered, so nothing reads no answer as no program. A stream or
 * a list refused, as by an older engine, counts as none: an update is not
 * held for a count it can never hear. An engine out of reach refuses
 * nothing, so its count stays unknown and "Restart now" is the way past. */
export function useRunningHere(
  engine: Engine,
  held: boolean
): number | undefined {
  const { listed } = useProjects(engine)
  const projects =
    listed.state === "ready"
      ? listed.value
      : listed.state === "refused"
        ? NONE
        : undefined
  const [running, setRunning] = useState<number>()
  useEffect(() => {
    if (!held || !projects) return
    const counts = new Map(
      projects.map(({ id }) => [id, undefined as number | undefined])
    )
    const tell = () => {
      const each = [...counts.values()]
      if (each.includes(undefined)) return
      setRunning(each.reduce<number>((all, one) => all + (one ?? 0), 0))
    }
    const stops = projects.map(({ id }) =>
      engine.stream(
        id,
        "terminal.running",
        {},
        ({ terminals }) => {
          counts.set(id, terminals)
          tell()
        },
        () => {
          counts.set(id, 0)
          tell()
        }
      )
    )
    tell()
    return () => {
      for (const stop of stops) stop()
      setRunning(undefined)
    }
  }, [engine, held, projects])
  return running
}
