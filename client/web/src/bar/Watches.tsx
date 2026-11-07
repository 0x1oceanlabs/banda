import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Attention, Listed, Lists, Report, Watch } from "@banda/ui/pane"
import { runs, watches } from "../registry"
import { combine, folded } from "./attention"

/**
 * Draws every module's Watch for every Project, while the engine runs the
 * module, and says what they call the Person for together and what each
 * Project lists. It shows nothing: the bar and the sidebar show what it
 * says, and the notifications module tells of what calls (ADR 0056).
 */
export function Watches({
  engine,
  modules,
  projects,
  onChange,
  onLists,
}: {
  engine: Engine
  modules: readonly string[]
  projects: ProjectSummary[]
  onChange: (attention: Attention) => void
  onLists: (lists: Lists) => void
}) {
  const [reports, setReports] = useState<Record<string, Heard>>({})
  const hear = useCallback((key: string, heard?: Heard) => {
    setReports((reports) => {
      const before = reports[key]
      if (before && heard && same(before, heard)) return reports
      if (!before && !heard) return reports
      const next = { ...reports }
      if (heard) next[key] = heard
      else delete next[key]
      return next
    })
  }, [])

  const { mark, waiting } = useMemo(
    () => combine(Object.values(reports)),
    [reports]
  )
  useEffect(() => onChange({ mark, waiting }), [onChange, mark, waiting])
  const lists = useMemo(() => {
    const lists: Record<ProjectId, readonly Listed[]> = {}
    for (const { project, listed } of Object.values(reports)) {
      lists[project] = [...(lists[project] ?? []), ...listed]
    }
    for (const project in lists) lists[project] = folded(lists[project]!)
    return lists
  }, [reports])
  useEffect(() => onLists(lists), [onLists, lists])

  return watches
    .filter(({ module }) => runs(module, modules))
    .flatMap(({ watch, module }) =>
      projects.map((project) => {
        const key = `${module.id}:${project.id}`
        return (
          <One
            key={key}
            id={key}
            watch={watch}
            engine={engine}
            project={project.id}
            hear={hear}
          />
        )
      })
    )
}

/** What one Watch said about one Project. */
type Heard = Report & { project: ProjectId }

function same(a: Heard, b: Heard): boolean {
  return a.mark === b.mark && a.waiting === b.waiting && a.listed === b.listed
}

/** One Watch on one Project; what it said goes with it. */
function One({
  id,
  watch,
  engine,
  project,
  hear,
}: {
  id: string
  watch: Watch
  engine: Engine
  project: ProjectId
  hear: (key: string, heard?: Heard) => void
}) {
  const report = useCallback(
    (report: Report) => hear(id, { ...report, project }),
    [hear, id, project]
  )
  // It says what it calls for itself, once drawn; leaving, it calls for
  // nothing.
  useEffect(() => () => hear(id), [hear, id])
  const Watched = watch.Watch
  return <Watched engine={engine} project={project} report={report} />
}
