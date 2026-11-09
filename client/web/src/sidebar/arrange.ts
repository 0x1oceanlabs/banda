/**
 * The sidebar's one rule (ADR 0008): every Project's list, the Projects and
 * the settings in; the sections and their rows out. The sidebar only draws
 * what it returns. Pure, so plain tests cover every preset and key.
 *
 * The other machines of `hosts.toml` come after this one's (ADR 0081,
 * decision 4): grouped by Project, each host's sections follow this
 * machine's, under its name; grouped otherwise, their rows join this
 * machine's, each with its host's name. With no other host, nothing
 * changes.
 */
import { NO_PROJECT } from "@banda/ui/lib/projects"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { loudest, type MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { STAND_WORDS, type Stand, standOf, wokeAt } from "@banda/ui/status"
import type { Settings, State } from "./settings"

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

/** Another host's Projects, by its name, in `hosts.toml`'s order. */
export type Elsewhere = {
  name: string
  projects: readonly ProjectSummary[]
}

export type Section = {
  /** A state, or a Project's id. */
  key: string
  /** The state's words, or the Project's name. */
  label: string
  /** The Project a section of `group.by = "project"` holds. */
  project?: ProjectSummary
  /** The other host whose Project it holds, below this machine's. */
  host?: string
  rows: Row[]
  folded: boolean
  /** When the first of the Later shelf's rows wakes. */
  next?: number
  /** The loudest mark of its rows, and how many need the Person. */
  mark: MarkState
  waiting: number
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
  sections: Section[]
  shelves: Section[]
}

/** The sections' headings: the active list has none, as T3 Code's. */
export const STATE_WORDS: Record<State, string> = {
  active: "",
  working: STAND_WORDS.working,
  later: STAND_WORDS.later,
  archived: STAND_WORDS.archived,
}

/** The section of `group.by = "state"` a row goes in: the Person's turn
 * and the open ones are both active. */
function stateOf(stand: Stand): State {
  return stand === "turn" || stand === "open" ? "active" : stand
}

/** The attention order: the Person's turn first, then work, the open
 * ones, the Later, the archived. */
const RANK: Readonly<Record<Stand, number>> = {
  turn: 0,
  working: 1,
  open: 2,
  later: 3,
  archived: 4,
}

/** When a row last changed: a Thread that woke changed as it woke. */
function changedOf(row: Row): number {
  return Math.max(row.listed.changed, row.woke ?? 0)
}

/** When a Later row wakes; one until done, after every time. */
function wakesAt(row: Row): number {
  return row.listed.later?.until ?? Infinity
}

/**
 * @param lists what each Project lists
 * @param now the Later clock, by which each row stands where it does
 * @param only shows only this Project's rows, as a click in the list of
 * Projects asks
 * @param toggled the sections the Person folded or opened, against what
 * the settings start with
 * @param elsewhere the other hosts' Projects, whose lists are in `lists`
 * too
 */
export function arrange(
  lists: Readonly<Record<ProjectId, readonly Listed[]>>,
  projects: readonly ProjectSummary[],
  settings: Settings,
  now: number,
  only?: ProjectId,
  toggled: ReadonlySet<string> = new Set(),
  elsewhere: readonly Elsewhere[] = []
): Arranged {
  const namedIn = (held: readonly ProjectSummary[]) =>
    held.filter((project) => !project.scratch)
  const rowsOf = (held: readonly ProjectSummary[], host?: string): Row[] =>
    held.flatMap((project) =>
      (lists[project.id] ?? []).map((listed) => {
        const woke = wokeAt(listed, now)
        return {
          project,
          listed,
          stand: standOf(listed, now),
          ...(woke === undefined ? {} : { woke }),
          ...(host === undefined ? {} : { host }),
        }
      })
    )
  const named = namedIn(projects)
  const all = rowsOf(projects)
  const others = elsewhere.map((host) => ({
    ...host,
    all: rowsOf(host.projects, host.name),
  }))
  const shown = (held: Row[]) =>
    held
      .filter((row) => only === undefined || row.project.id === only)
      .sort(order(settings.sort.by))
  // Grouped by Project, each host's rows stay in its own sections.
  const rows = shown(
    settings.group.by === "project"
      ? all
      : [...all, ...others.flatMap((host) => host.all)]
  )
  const folds = (key: string, name = key) =>
    (settings.group.folded.includes(name) ||
      settings.group.folded.includes(key)) !== toggled.has(key)
  const section = (
    key: string,
    label: string,
    held: Row[],
    project?: ProjectSummary,
    name?: string
  ): Section => {
    const asleep = held.filter((row) => row.stand === "later")
    const next = Math.min(...asleep.map(wakesAt))
    return {
      key,
      label,
      ...(project ? { project } : {}),
      rows: held,
      folded: folds(key, name),
      ...(Number.isFinite(next) ? { next } : {}),
      ...rollup(held),
    }
  }
  const kept = (sections: Section[]) =>
    settings.group.empty === "show"
      ? sections
      : sections.filter((section) => section.rows.length > 0)

  /** The sections of `held`'s Projects, `all` their rows, keyed after
   * `host` for another host's. */
  const byProject = (
    all: Row[],
    held: readonly ProjectSummary[],
    host?: string
  ): Section[] => {
    const rows = shown(all)
    const key = (id: string) => (host === undefined ? id : `${host}/${id}`)
    const sections = [
      ...orderProjects(all, namedIn(held), settings).map((project) =>
        section(
          key(project.id),
          project.name,
          rows.filter((row) => row.project.id === project.id),
          project,
          project.name
        )
      ),
      ...(rows.some((row) => row.project.scratch)
        ? [
            section(
              key("no-project"),
              NO_PROJECT,
              rows.filter((row) => row.project.scratch)
            ),
          ]
        : []),
    ]
    return kept(
      host === undefined
        ? sections
        : sections.map((section) => ({ ...section, host }))
    )
  }

  const listed = settings.projects.list
    ? {
        projects: [
          ...projectLines(all, named, settings),
          ...others.flatMap((host) =>
            projectLines(host.all, namedIn(host.projects), settings).map(
              (line) => ({ ...line, host: host.name })
            )
          ),
        ],
      }
    : {}

  switch (settings.group.by) {
    case "project":
      return {
        ...listed,
        sections: [
          ...byProject(all, projects),
          ...others.flatMap((host) =>
            byProject(host.all, host.projects, host.name)
          ),
        ],
        shelves: [],
      }
    case "none":
      return {
        ...listed,
        sections: kept([section("all", "", rows)]),
        shelves: [],
      }
    case "state": {
      const { states, bottom } = settings.group
      // The Laters by when they wake; the rest as the settings sort.
      const of = (state: State) => {
        const held = rows.filter((row) => stateOf(row.stand) === state)
        return state === "later"
          ? held.sort((a, b) => wakesAt(a) - wakesAt(b))
          : held
      }
      const sections = states.map((state) =>
        section(state, STATE_WORDS[state], of(state))
      )
      // A state the settings name nowhere goes to the last section, so no
      // row is ever hidden.
      const placed = new Set<State>([...states, ...bottom])
      const rest = rows.filter((row) => !placed.has(stateOf(row.stand)))
      if (rest.length > 0) {
        const last = sections.at(-1)
        if (last) {
          const joined = [...last.rows, ...rest].sort(order(settings.sort.by))
          sections[sections.length - 1] = {
            ...last,
            rows: joined,
            ...rollup(joined),
          }
        } else {
          sections.push(section("all", "", rest))
        }
      }
      return {
        ...listed,
        sections: kept(sections),
        shelves: kept(
          bottom.map((state) => section(state, STATE_WORDS[state], of(state)))
        ),
      }
    }
  }
}

function order(by: Settings["sort"]["by"]): (a: Row, b: Row) => number {
  const latest = (a: Row, b: Row) => changedOf(b) - changedOf(a)
  switch (by) {
    case "attention":
      return (a, b) => RANK[a.stand] - RANK[b.stand] || latest(a, b)
    case "title":
      return (a, b) =>
        a.listed.title.localeCompare(b.listed.title) || latest(a, b)
    case "changed":
      return latest
  }
}

function rollup(rows: readonly Row[]): { mark: MarkState; waiting: number } {
  return {
    mark: loudest(rows.map((row) => row.listed.mark)),
    waiting: rows.filter((row) => row.stand === "turn").length,
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

function projectLines(
  rows: readonly Row[],
  projects: readonly ProjectSummary[],
  settings: Settings
): ProjectLine[] {
  return orderProjects(rows, projects, settings).map((project) => {
    const held = rows.filter((row) => row.project.id === project.id)
    return { project, count: held.length, ...rollup(held) }
  })
}
