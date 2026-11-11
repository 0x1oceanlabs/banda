/**
 * The sidebar's rows (ADR 0008, as ADR 0098 amends it): what each Project
 * lists, each Thread where `status.ts` says it stands, and when it woke;
 * and, under the `places` preset, the list of Projects' lines, until that
 * list goes (decision 16). The Inbox (`inbox.ts`) puts the rows in their
 * places, and `order` gathers them; this only makes them. Pure, so plain
 * tests cover it.
 *
 * The other machines of `hosts.toml` come after this one's (ADR 0081,
 * decision 4): their rows are among this machine's, each with its host's
 * name, and their Projects follow this machine's in the list of Projects.
 * With no other host, nothing changes.
 */
import type { ProjectSummary } from "@banda/contract"
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

/** Each named Project's line in the list of Projects, with `host`, the
 * other machine it is on: its loudest mark, how many need the Person, and
 * how many it holds. A scratch Project has none. */
export function projectLines(
  rows: readonly Row[],
  projects: readonly ProjectSummary[],
  settings: Settings,
  host?: string
): ProjectLine[] {
  const named = projects.filter((project) => !project.scratch)
  return orderProjects(rows, named, settings).map((project) => {
    const held = rows.filter((row) => row.project.id === project.id)
    return {
      project,
      count: held.length,
      mark: loudest(held.map((row) => row.listed.mark)),
      waiting: held.filter((row) => row.stand === "turn").length,
      ...(host === undefined ? {} : { host }),
    }
  })
}
