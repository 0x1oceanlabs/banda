/**
 * The one move of this window's old marks to their host (ADR 0096,
 * decision 9). Before it, the window kept which turn of each Thread its
 * Person saw, and which Threads they archived, in its own storage, by the
 * Thread's ID alone. Now each Thread's host keeps them. Each Project of
 * this machine gets one `agents.import_marks`: its Threads' seen, and the
 * Threads the old rules show archived now, by ID. Marks kept for another
 * machine's Threads are dropped, as that machine's own window brings
 * them (#854 is the idea of sending them too).
 *
 * The rules here are frozen copies of `./seen.ts` and the window's
 * `sidebar/archived.ts` as they were, so the move reads what the window
 * showed whatever those become. They only read the old keys, named here
 * again, which stay for one stable release, as ADR 0069 (decision 3) kept
 * its old names. The move is the agents module's: it asks its own engine
 * part, so the window names none of it.
 *
 * Not called yet: the flip (step 2b) calls it once, from the module's
 * index.ts, after the first list load.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type { ImportMarks, ListedThread } from "@banda/contract/agents"
import { openProjects } from "@banda/ui/lib/projects"

/** Where `./seen.ts` kept the turn of each Thread its Person saw. */
const SEEN = "banda.agents.seen"

/** Where the window's sidebar kept what the Person said of each row. */
const ARCHIVED = "banda.sidebar.archived"

/** Where it kept the moment the three quiet days left (ADR 0069). */
const CUTOFF = "banda.sidebar.archived-before"

/** The Projects whose marks moved already. */
const MOVED = "banda.marks.moved"

/** What the Person said of a row, and when, by the window's clock. */
type Say = { archived: boolean; at: number }

/**
 * An ID as Banda writes one: a UUID with hyphens. Anything else in the
 * old storage is dropped, as one the engine cannot read refuses the whole
 * move, which would then go again at each start.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isId = (id: unknown): id is string =>
  typeof id === "string" && ID.test(id)

const isSay = (say: unknown): say is Say =>
  typeof say === "object" &&
  say !== null &&
  typeof (say as Say).archived === "boolean" &&
  typeof (say as Say).at === "number"

/** What is kept at `key`, parsed; none when it is not JSON. */
function parsed(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null")
  } catch {
    return undefined
  }
}

/** The record kept at `key`, with only the values `is` takes. */
function record<V>(
  storage: Storage,
  key: string,
  is: (value: unknown) => value is V
): Record<string, V> {
  const value = parsed(storage, key)
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(
    Object.entries(value).filter((pair): pair is [string, V] => is(pair[1]))
  )
}

/** The marks the window kept, as the old keys hold them. */
export type OldMarks = {
  /** The turn of each Thread its Person saw. */
  seen: Record<string, string>
  /** What the Person said of each row. */
  says: Record<string, Say>
  /** The cutoff: 0, archiving nothing, with none. */
  before: number
}

/**
 * The old keys, read only, and only the values the old rules took. The
 * cutoff is as `sidebar/archived.ts` wrote it as the window started.
 */
export function oldMarks(storage: Storage): OldMarks {
  let before = 0
  try {
    before = Number(storage.getItem(CUTOFF)) || 0
  } catch {
    // Its storage fails: nothing was kept either.
  }
  return {
    seen: record(storage, SEEN, isId),
    says: record(storage, ARCHIVED, isSay),
    before,
  }
}

/**
 * Whether the old rule shows `thread` archived (`isArchived`, frozen):
 * one that works or asks never is; a snooze after what the Person said
 * takes it out; what they said holds until something new happens in it;
 * without that, it is archived if nothing happened in it since `before`.
 */
function shownArchived(
  thread: ListedThread,
  say: Say | undefined,
  before: number
): boolean {
  if (thread.asking.length > 0 || thread.latest?.state === "running")
    return false
  if ((thread.snooze?.at ?? -Infinity) > (say?.at ?? before)) return false
  if (say && thread.updated_at <= say.at) return say.archived
  return thread.updated_at <= before
}

/**
 * What one Project's move sends: of its `threads`, each one's seen turn,
 * and the ones the old rules show archived, by valid IDs only. Marks of a
 * Thread it does not list, as another machine's, stay behind.
 */
export function marksOf(
  threads: readonly ListedThread[],
  { seen, says, before }: OldMarks
): Required<ImportMarks> {
  const marks: Required<ImportMarks> = { seen: {}, archived: [] }
  // By the host's own IDs: a kept key that names none of them, a bad one
  // too, stays behind.
  for (const thread of threads) {
    const turn = seen[thread.id]
    if (turn !== undefined) marks.seen[thread.id] = turn
    if (shownArchived(thread, says[thread.id], before))
      marks.archived.push(thread.id)
  }
  return marks
}

/** The Projects whose marks moved already. */
function movedOf(storage: Storage): Set<string> {
  const value = parsed(storage, MOVED)
  return new Set(
    Array.isArray(value) ? value.filter((id) => typeof id === "string") : []
  )
}

/**
 * Moves the old marks of each Project of this machine, `engine`'s, to it,
 * once: a Project whose move went is kept in `banda.marks.moved`, and one
 * that did not goes again at the next start. A Project whose marks went
 * before is left alone; the host skips a Thread its Person changed since
 * too, so one sent twice undoes nothing. Resolves how many marks moved.
 */
export async function moveMarks(
  engine: Engine,
  storage: Storage = localStorage
): Promise<number> {
  const old = oldMarks(storage)
  // A window that kept nothing, as a new one, has nothing to read for.
  const kept =
    Object.keys(old.seen).length > 0 ||
    Object.keys(old.says).length > 0 ||
    old.before > 0
  if (!kept) return 0
  let projects: ProjectId[]
  try {
    // A missing one is read once the Person locates it.
    const listed = await engine.call("projects.list", {})
    projects = openProjects(listed).map(({ id }) => id)
  } catch {
    return 0
  }
  const moved = movedOf(storage)
  let count = 0
  for (const project of projects) {
    if (moved.has(project)) continue
    try {
      const { threads } = await engine.call("agents.threads", {}, { project })
      const marks = marksOf(threads, old)
      if (Object.keys(marks.seen).length > 0 || marks.archived.length > 0)
        count += (await engine.command("agents.import_marks", marks, project))
          .count
      moved.add(project)
      storage.setItem(MOVED, JSON.stringify([...moved]))
    } catch {
      // Its Project could not be read, or its host refused: it goes again
      // at the next start, which the flag above leaves it to.
    }
  }
  return count
}
