import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useModules } from "@banda/ui/hooks/use-status"
import { openProjects } from "@banda/ui/lib/projects"
import {
  emptyIn,
  HostsContext,
  type KeptHosts,
  liveIn,
  sameEach,
  type Shown,
  useHostsBy,
} from "@banda/core/react"
import type { Listed, Report, Watch } from "@banda/ui/pane"
import {
  dropHost,
  StoresContext,
  takeAttention,
  takeLists,
} from "../calls/stores"
import { runs, watches } from "../registry"
import { combine, folded } from "./attention"

/**
 * Draws every module's Watch for every Project, while the engine runs the
 * module, and keeps what they call the Person for together and what each
 * Project lists in the Window's stores. It shows nothing: the bar and the
 * sidebar show what it says, and the notifications module tells of what
 * calls (ADR 0056). This machine's draws one more for each other host
 * that is live (`Elsewhere`). Drawn again only as its own props change.
 */
export const Watches = memo(function Watches({
  engine,
  modules,
  projects,
  host,
}: {
  engine: Engine
  modules: readonly string[]
  projects: readonly ProjectSummary[]
  /** The other host whose engine it is, by its name: only the Watches of
   * the modules its engine runs are drawn, never one of this machine's
   * own, as the browser's. None for this machine. */
  host?: string
}) {
  const stores = useContext(StoresContext)
  const [reports, setReports] = useState<Record<string, Heard>>({})
  // Another host's says nothing before its first report, so what it
  // listed before it went away stands until then; with no Project, it
  // has none to wait for.
  const [told, setTold] = useState(host === undefined)
  const says = told || projects.length === 0
  const hear = useCallback((key: string, heard?: Heard) => {
    if (heard) setTold(true)
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
  useEffect(() => {
    if (says) takeAttention(stores, { mark, waiting }, host)
  }, [stores, mark, waiting, host, says])
  const lists = useMemo(() => {
    const lists: Record<ProjectId, readonly Listed[]> = {}
    for (const { project, listed } of Object.values(reports)) {
      lists[project] = [...(lists[project] ?? []), ...listed]
    }
    for (const project in lists) lists[project] = folded(lists[project]!)
    return lists
  }, [reports])
  useEffect(() => {
    if (says) takeLists(stores, lists, host)
  }, [stores, lists, host, says])

  const drawn = watches
    .filter(({ module }) =>
      host === undefined
        ? runs(module, modules)
        : module.engine && modules.includes(module.id)
    )
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
  return (
    <>
      {drawn}
      {host === undefined && <Elsewhere />}
    </>
  )
})

/**
 * One Watches for each other host that is live (ADR 0081, decision 4),
 * so what its engine's Apps list flows into the Window's stores under its
 * name. A host that goes away keeps what it listed last; one the Window
 * shows no rows of lets go of it.
 */
function Elsewhere() {
  const hosts = useContext(HostsContext)
  const stores = useContext(StoresContext)
  const live = useHostsBy(liveIn, sameEach)
  const empty = useHostsBy(emptyIn, sameEach)
  useEffect(() => {
    for (const name of empty) dropHost(stores, name)
  }, [stores, empty])
  return live.map((name) => <Remote key={name} hosts={hosts} name={name} />)
}

/** A live host's Watches, on its Projects as its engine lists them. */
function Remote({ hosts, name }: { hosts: KeptHosts; name: string }) {
  const engine = hosts.engine(name)
  const modules = useModules(engine)
  const { listed } = useProjects(engine)
  useEffect(() => {
    if (listed.state === "ready") hosts.projects(name, listed.value)
  }, [hosts, name, listed])
  const select = useCallback(
    (all: readonly Shown[]) =>
      all.find((one) => one.name === name)?.projects ?? NONE,
    [name]
  )
  const projects = useHostsBy(select)
  const open = useMemo(() => openProjects(projects), [projects])
  return (
    <Watches engine={engine} modules={modules} projects={open} host={name} />
  )
}

const NONE: readonly ProjectSummary[] = []

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
