/**
 * The sidebar's rows (ADR 0008, as ADR 0098 amends it): what each Project
 * lists, each Thread where `status.ts` says it stands, and when it woke.
 * The Inbox (`inbox.ts`) puts the rows in their places, and `order`
 * gathers them; this only makes them. Pure, so plain tests cover it.
 *
 * The other machines of `hosts.toml` come after this one's (ADR 0081,
 * decision 4): their rows are among this machine's, each with its host's
 * name. With no other host, nothing changes.
 */
import type { ProjectSummary } from "@banda/contract"
import type { Listed, Lists } from "@banda/ui/pane"
import { type Stand, standOf, wokeAt } from "@banda/ui/status"

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
function placedOf(listed: Listed, now: number): Placed {
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

/** A row's key: its Project's and its own, as Alt+U and the counts walk
 * them. */
export function rowKey(row: Row): string {
  return `${row.project.id}:${row.listed.id}`
}

/** A card's key in the list: its machine's and its Thread's, so it stays
 * the same node, with its Mark, from one part to another, and to another
 * Project. */
export function itemKey(row: Row): string {
  return keyOf(row.host, row.listed.id)
}

/** The key of `thread` on `host`; none for this machine. */
export function keyOf(host: string | undefined, thread: string): string {
  return `${host ?? ""}:${thread}`
}
