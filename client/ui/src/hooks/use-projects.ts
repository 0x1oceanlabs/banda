import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, ProjectSummary } from "@banda/contract"
import { useInFront } from "./use-in-front"
import { type Read, useRead } from "./use-read"
import {
  onProjectsChanged,
  sameProjects,
  projectsChanged,
} from "@banda/ui/lib/projects"

/**
 * Every Project, the archived too (ADR 0026). Read once, then again as the
 * window comes to the front, so one added or changed elsewhere, as by
 * `banda project add`, shows then; and again once one is changed here
 * (`projectsChanged`). A list that says what it said keeps the one before.
 * `put` shows a Project the engine just answered at once, and tells the
 * window's other lists.
 */
export function useProjects(engine: Engine): {
  listed: Read<ProjectSummary[]>
  put: (project: ProjectSummary) => void
} {
  const first = useRead(
    useCallback(() => engine.call("projects.list", {}), [engine])
  )
  const [list, setList] = useState<ProjectSummary[]>()
  const reread = useCallback(() => {
    engine.call("projects.list", {}).then(
      (projects) =>
        setList((was) => (was && sameProjects(was, projects) ? was : projects)),
      () => undefined
    )
  }, [engine])
  useEffect(() => onProjectsChanged(reread), [reread])
  const front = useInFront()
  const started = useRef(false)
  useEffect(() => {
    // The first read is `first`'s.
    if (front && started.current) reread()
    started.current = true
  }, [front, reread])
  const read = first.state === "ready" ? first.value : undefined
  const put = useCallback(
    (project: ProjectSummary) => {
      setList((was) => [
        ...(was ?? read ?? []).filter((one) => one.id !== project.id),
        project,
      ])
      projectsChanged()
    },
    [read]
  )
  const projects = list ?? read
  const listed = useMemo<Read<ProjectSummary[]>>(
    () => (projects ? { state: "ready", value: projects } : first),
    [projects, first]
  )
  return { listed, put }
}
