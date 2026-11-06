/**
 * The sidebar's one rule (ADR 0008): every Project's list, the Projects and
 * the settings in; the sections and their rows out. The sidebar only draws
 * what it returns. Pure, so plain tests cover every preset and key.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  loudest,
  type MarkState,
  waits,
  works,
} from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import type { Settings, State } from "./settings"

/** One row: what a module listed, the Project it is in, where it stands,
 * and when it woke from a snooze while its Person has not seen it. */
export type Row = {
  project: ProjectSummary
  listed: Listed
  state: State
  woke?: number
}

/** What the Person's marks say of a row now: archived, asleep, woke. */
export type Marks = {
  archived?: (listed: Listed) => boolean
  asleep?: (listed: Listed) => boolean
  woke?: (listed: Listed) => number | undefined
}

export type Section = {
  /** A state, or a Project's id. */
  key: string
  /** The state's words, or the Project's name. */
  label: string
  /** The Project a section of `group.by = "project"` holds. */
  project?: ProjectSummary
  rows: Row[]
  folded: boolean
  /** When the first of a snoozed shelf's rows wakes. */
  next?: number
  /** The loudest mark of its rows, and how many need the Person. */
  mark: MarkState
  waiting: number
}

/** One line of the list of Projects. */
export type ProjectLine = {
  project: ProjectSummary
  mark: MarkState
  waiting: number
  count: number
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
  working: "Working",
  snoozed: "Snoozed",
  archived: "Archive",
}

/** Where a row stands: asleep, at work, archived as the Person's marks
 * say, or active. A snooze outranks the rest (ADR 0074). */
function stateOf(listed: Listed, marks: Marks): State {
  if (marks.asleep?.(listed)) return "snoozed"
  if (works(listed.mark)) return "working"
  return marks.archived?.(listed) ? "archived" : "active"
}

/** The attention order: what waits or woke first, then work, the rest,
 * the snoozed, the archived. */
function rank(row: Row): number {
  if (row.state === "archived") return 4
  if (row.state === "snoozed") return 3
  if (row.state === "working") return 1
  return waits(row.listed.mark) || row.woke !== undefined ? 0 : 2
}

/** When a row last changed: a Thread that woke changed as it woke. */
function changedOf(row: Row): number {
  return Math.max(row.listed.changed, row.woke ?? 0)
}

/** When a snoozed row wakes; one until done, after every time. */
function wakesAt(row: Row): number {
  return row.listed.snooze?.until ?? Infinity
}

/**
 * @param lists what each Project lists
 * @param only shows only this Project's rows, as a click in the list of
 * Projects asks
 * @param toggled the sections the Person folded or opened, against what
 * the settings start with
 * @param marks what the Person's marks say of each row now
 */
export function arrange(
  lists: Readonly<Record<ProjectId, readonly Listed[]>>,
  projects: readonly ProjectSummary[],
  settings: Settings,
  only?: ProjectId,
  toggled: ReadonlySet<string> = new Set(),
  marks: Marks = {}
): Arranged {
  const named = projects.filter((project) => !project.scratch)
  const all: Row[] = projects.flatMap((project) =>
    (lists[project.id] ?? []).map((listed) => {
      const state = stateOf(listed, marks)
      const woke = marks.woke?.(listed)
      return { project, listed, state, ...(woke === undefined ? {} : { woke }) }
    })
  )
  const rows = all
    .filter((row) => only === undefined || row.project.id === only)
    .sort(order(settings.sort.by))
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
    const asleep = held.filter((row) => row.state === "snoozed")
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

  const listed = settings.projects.list
    ? { projects: projectLines(all, named, settings) }
    : {}

  switch (settings.group.by) {
    case "project":
      return {
        ...listed,
        sections: kept([
          ...orderProjects(all, named, settings).map((project) =>
            section(
              project.id,
              project.name,
              rows.filter((row) => row.project.id === project.id),
              project,
              project.name
            )
          ),
          ...(rows.some((row) => row.project.scratch)
            ? [
                section(
                  "no-project",
                  "No Project",
                  rows.filter((row) => row.project.scratch)
                ),
              ]
            : []),
        ]),
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
      // The snoozed by when they wake; the rest as the settings sort.
      const of = (state: State) => {
        const held = rows.filter((row) => row.state === state)
        return state === "snoozed"
          ? held.sort((a, b) => wakesAt(a) - wakesAt(b))
          : held
      }
      const sections = states.map((state) =>
        section(state, STATE_WORDS[state], of(state))
      )
      // A state the settings name nowhere goes to the last section, so no
      // row is ever hidden.
      const placed = new Set<State>([...states, ...bottom])
      const rest = rows.filter((row) => !placed.has(row.state))
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
      return (a, b) => rank(a) - rank(b) || latest(a, b)
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
    waiting: rows.filter(
      (row) =>
        row.state !== "archived" &&
        row.state !== "snoozed" &&
        waits(row.listed.mark)
    ).length,
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
