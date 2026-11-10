/**
 * What the sidebar's settings make of every Project's list (ADR 0008, as
 * ADR 0098 amends it): the rows, each where `status.ts` says it stands;
 * what the list is grouped by; and the list of Projects, when the
 * settings ask for it. The Inbox (`inbox.ts`) puts the rows in their
 * places; this only gathers them. Pure, so plain tests cover every preset
 * and key.
 *
 * The other machines of `hosts.toml` come after this one's (ADR 0081,
 * decision 4): their rows are among this machine's, each with its host's
 * name, and their Projects follow this machine's in the list of Projects.
 * With no other host, nothing changes.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { loudest, type MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { type Stand, standOf, wokeAt } from "@banda/ui/status"
import type { Settings } from "./settings"

/** One row: what a module listed, the Project it is in, where it stands
 * (`status.ts`), when it woke from a Later while its Person has not seen
 * it, and the other host its Project is on. */
export type Row = {
  project: ProjectSummary
  listed: Listed
  stand: Stand
  woke?: number
  host?: string
}

/** Where a Thread stands, and when it woke: a row but for its Project
 * and host. */
export type Placed = Pick<Row, "listed" | "stand" | "woke">

/** Where `listed` stands at `now`, the Later clock, as `status.ts` says,
 * and when it woke. */
export function placedOf(listed: Listed, now: number): Placed {
  const woke = wokeAt(listed, now)
  return {
    listed,
    stand: standOf(listed, now),
    ...(woke === undefined ? {} : { woke }),
  }
}

/** Another host's Projects, by its name, in `hosts.toml`'s order. */
export type Elsewhere = {
  name: string
  projects: readonly ProjectSummary[]
}

/** One line of the list of Projects, and the other host it is on. */
export type ProjectLine = {
  project: ProjectSummary
  mark: MarkState
  waiting: number
  count: number
  host?: string
}

export type Arranged = {
  /** The list of Projects, when the settings ask for it. */
  projects?: ProjectLine[]
  /** Every row, this machine's and the other machines'. */
  rows: Row[]
  /** What the list is grouped by: each Project under its header, or one
   * list. The presets' `group.by = "state"` is one list now, as the tabs
   * and the Inbox's parts stand in for its sections (ADR 0098, decisions
   * 2 and 7). */
  group: "none" | "project"
}

/**
 * The rows of `held`'s Projects, from what each lists, each where it
 * stands at `now`, the Later clock, as `status.ts` says, and when it woke;
 * each named after `host` when it is another machine's. The sidebar's
 * arrangements all start from them, so none works out where a Thread
 * stands by itself.
 */
export function rowsOf(
  lists: Lists,
  held: readonly ProjectSummary[],
  now: number,
  host?: string
): Row[] {
  return held.flatMap((project) =>
    (lists[project.id] ?? []).map((listed) => ({
      project,
      ...placedOf(listed, now),
      ...(host === undefined ? {} : { host }),
    }))
  )
}

/**
 * @param lists what each Project lists
 * @param now the Later clock, by which each row stands where it does
 * @param only shows only this Project's rows, as a click in the list of
 * Projects asks
 * @param elsewhere the other hosts' Projects, whose lists are in `lists`
 * too
 */
export function arrange(
  lists: Readonly<Record<ProjectId, readonly Listed[]>>,
  projects: readonly ProjectSummary[],
  settings: Settings,
  now: number,
  only?: ProjectId,
  elsewhere: readonly Elsewhere[] = []
): Arranged {
  const namedIn = (held: readonly ProjectSummary[]) =>
    held.filter((project) => !project.scratch)
  const all = rowsOf(lists, projects, now)
  const others = elsewhere.map((host) => ({
    ...host,
    all: rowsOf(lists, host.projects, now, host.name),
  }))
  const rows = [...all, ...others.flatMap((host) => host.all)].filter(
    (row) => only === undefined || row.project.id === only
  )
  return {
    ...(settings.projects.list
      ? {
          projects: [
            ...projectLines(all, namedIn(projects), settings),
            ...others.flatMap((host) =>
              projectLines(host.all, namedIn(host.projects), settings).map(
                (line) => ({ ...line, host: host.name })
              )
            ),
          ],
        }
      : {}),
    rows,
    group: settings.group.by === "project" ? "project" : "none",
  }
}

/** The Projects in the settings' order; one with nothing listed goes last. */
function orderProjects(
  rows: readonly Row[],
  projects: readonly ProjectSummary[],
  settings: Settings
): ProjectSummary[] {
  const changed = (project: ProjectSummary) =>
    Math.max(
      -Infinity,
      ...rows
        .filter((row) => row.project.id === project.id)
        .map((row) => row.listed.changed)
    )
  return [...projects].sort((a, b) =>
    settings.projects.order === "name"
      ? a.name.localeCompare(b.name)
      : changed(b) - changed(a) || a.name.localeCompare(b.name)
  )
}

/** Each Project's line: its loudest mark, how many need the Person, and
 * how many it holds. */
function projectLines(
  rows: readonly Row[],
  projects: readonly ProjectSummary[],
  settings: Settings
): ProjectLine[] {
  return orderProjects(rows, projects, settings).map((project) => {
    const held = rows.filter((row) => row.project.id === project.id)
    return {
      project,
      count: held.length,
      mark: loudest(held.map((row) => row.listed.mark)),
      waiting: held.filter((row) => row.stand === "turn").length,
    }
  })
}
