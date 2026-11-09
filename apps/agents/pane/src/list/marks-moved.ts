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
 * One mark the old keys cannot say: from step 2a, a Thread's Pane told
 * its host what the Person saw, but "Mark as unread" took the mark back
 * from this window's storage alone. The move takes those back on the host
 * too (`unreadOf`), so a Thread the Person kept to come back to still
 * calls them.
 *
 * The rules here are frozen copies of the window's old seen and
 * `sidebar/archived.ts` as they were, so the move reads what the window
 * showed whatever those became. They only read the old keys, named here
 * again, which stay for one stable release, as ADR 0069 (decision 3) kept
 * its old names; nothing else names them (architecture.test.ts). The move
 * is the agents module's: it asks its own engine part, so the window
 * names none of it.
 *
 * The module's start moves them once (`Move.start`), on this machine's
 * engine alone, and the Threads lists read their host's once it is over
 * (`Move.over`), so the first list the Person sees has the marks moved.
 * A Project the start did not move, as one missing then and located
 * since, moves alone as its list first reads.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type {
  ImportMarks,
  ListedThread,
  ThreadId,
} from "@banda/contract/agents"
import { openProjects } from "@banda/ui/lib/projects"
import { DAY } from "@banda/ui/lib/words"
import { mark } from "./sent"

/** Where the window's seen kept the turn of each Thread its Person saw. */
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
  /** Whether the window kept a seen at all, as one that saw a Thread did. */
  seenKept: boolean
  /** What the Person said of each row. */
  says: Record<string, Say>
  /** The cutoff: 0, archiving nothing, with none. */
  before: number
}

/**
 * The cutoff as `sidebar/archived.ts` wrote it as the window started
 * (`cutoff`, frozen), kept in `storage` where it is not yet, so a Project
 * moved at a later start reads the same moment. A window from before it,
 * with marks kept, takes three quiet days before `now`, as that one did
 * at its first start (ADR 0069, decision 5). Narrowed to the old marks'
 * keys: a window now writes keys of its own before the move, which the
 * old rule would have taken for a window that had the three days.
 */
export function holdCutoff(storage: Storage, now: number): void {
  try {
    if (storage.getItem(CUTOFF) !== null) return
    const older =
      storage.getItem(SEEN) !== null || storage.getItem(ARCHIVED) !== null
    storage.setItem(CUTOFF, String(older ? now - 3 * DAY : 0))
  } catch {
    // Its storage fails: nothing was kept either.
  }
}

/**
 * The old keys, read only, and only the values the old rules took. The
 * cutoff is as `holdCutoff` keeps it.
 */
export function oldMarks(storage: Storage): OldMarks {
  let before = 0
  let seenKept = false
  try {
    before = Number(storage.getItem(CUTOFF)) || 0
    seenKept = storage.getItem(SEEN) !== null
  } catch {
    // Its storage fails: nothing was kept either.
  }
  return {
    seen: record(storage, SEEN, isId),
    seenKept,
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

/**
 * The Threads of `threads` whose host keeps them seen, settled, though
 * this window keeps no seen of them: those its Person marked unread here
 * after step 2a's Pane had told the host what they saw, as "Mark as
 * unread" then took the mark back from this window's storage alone. The
 * move takes the host's back too, so each calls its Person as this window
 * showed it. One seen on another machine alone calls again too, once: a
 * Done that comes back, never a reminder lost. None from a window that
 * never kept a seen.
 */
export function unreadOf(
  threads: readonly ListedThread[],
  { seen, seenKept }: OldMarks
): ThreadId[] {
  if (!seenKept) return []
  return threads
    .filter(
      (thread) =>
        seen[thread.id] === undefined &&
        thread.seen !== undefined &&
        thread.seen === thread.latest?.turn
    )
    .map(({ id }) => id as ThreadId)
}

/** The Projects whose marks moved already. */
function movedOf(storage: Storage): Set<string> {
  const value = parsed(storage, MOVED)
  return new Set(
    Array.isArray(value) ? value.filter((id) => typeof id === "string") : []
  )
}

/**
 * The old marks, the cutoff held first (`holdCutoff`); none from a window
 * that kept nothing, as a new one, which has nothing to read for.
 */
function keptOf(storage: Storage): OldMarks | undefined {
  holdCutoff(storage, Date.now())
  const old = oldMarks(storage)
  const kept =
    old.seenKept || Object.keys(old.says).length > 0 || old.before > 0
  return kept ? old : undefined
}

/**
 * Moves `old`, the marks this window kept, of `project` to its host,
 * `engine`, and keeps the Project in `banda.marks.moved` once its move
 * went. The seen this window took back go after the import, as a Thread
 * marked unread takes no archive from it (#898). Resolves how many marks
 * moved; throws when the Project could not be read, its host refused, or
 * the storage would not keep it.
 */
async function moveProject(
  engine: Engine,
  project: ProjectId,
  old: OldMarks,
  storage: Storage
): Promise<number> {
  let count = 0
  const { threads } = await engine.call("agents.threads", {}, { project })
  const marks = marksOf(threads, old)
  if (Object.keys(marks.seen).length > 0 || marks.archived.length > 0)
    count += (await engine.command("agents.import_marks", marks, project)).count
  const unread = unreadOf(threads, old)
  const took = await Promise.all(
    unread.map((thread) =>
      mark(engine, project, thread, { seen: null }, { quiet: true })
    )
  )
  count += took.filter(Boolean).length
  // One the host did not take goes again.
  if (took.includes(false)) return count
  // Read again, as another Project's move may have kept its own since.
  const moved = movedOf(storage)
  moved.add(project)
  storage.setItem(MOVED, JSON.stringify([...moved]))
  return count
}

/**
 * Moves the old marks of each Project of this machine, `engine`'s, to it,
 * once: a Project whose move went is kept in `banda.marks.moved`, and one
 * that did not goes again, alone as its list first reads (`Move.over`) and
 * at the next start. A Project whose marks went before is left alone; the
 * host skips a Thread its Person changed since too, so one sent twice
 * undoes nothing. Resolves how many marks moved.
 */
export async function moveMarks(
  engine: Engine,
  storage: Storage = localStorage
): Promise<number> {
  const old = keptOf(storage)
  if (!old) return 0
  let projects: ProjectId[]
  try {
    // A missing one moves once the Person locates it, as its list first
    // reads (`Move.over`).
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
      count += await moveProject(engine, project, old, storage)
    } catch {
      // Its Project could not be read, or its host refused: it goes again,
      // as `banda.marks.moved` does not keep it.
    }
  }
  return count
}

/** How long a list waits for the move before it reads all the same: a
 * move that takes longer, or one that never starts, holds none up past
 * it. */
export const MOVE_WAIT = 3_000

/** Whether `promise` settled within `ms`. */
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), ms)
    const settled = () => {
      clearTimeout(timer)
      done(true)
    }
    promise.then(settled, settled)
  })
}

/**
 * One window's move: started once, by the agents module's start, on this
 * machine's engine and never another host's, which brings its own marks
 * (decision 9); a popped-out Pane's window starts none. A Threads list
 * waits for it before it reads (`over`), so it shows the marks moved, not
 * a flash of what the host had before.
 */
export class Move {
  readonly #storage: () => Storage
  readonly #wait: number
  #move: { engine: Engine; over: Promise<unknown> } | undefined
  readonly #starts = new Set<() => void>()
  /** No move started within the wait: a list waits one tick for one, not
   * the whole wait again. */
  #none = false
  /** The Projects the start did not move, each moving alone, once. */
  readonly #alone = new Map<ProjectId, Promise<unknown>>()

  constructor(storage: () => Storage, wait = MOVE_WAIT) {
    this.#storage = storage
    this.#wait = wait
  }

  /** Moves the marks to `engine`, this machine's; again, nothing. */
  start(engine: Engine): void {
    if (this.#move) return
    this.#move = { engine, over: moveMarks(engine, this.#storage()) }
    for (const start of this.#starts) start()
    this.#starts.clear()
  }

  /**
   * Resolves once `project` of `engine` may be read: at once for another
   * host's, by its name in `hosts.toml`, and for a Project whose marks
   * moved; for another engine's once the move started; else once the
   * move is over, as it went, and the Project moved alone if the move did
   * not take it. It waits for the move to start, then for it to end, then
   * for the Project's own, at most `MOVE_WAIT` each.
   */
  async over(engine: Engine, project: ProjectId, host?: string): Promise<void> {
    // Another host's marks are its own window's to move (decision 9).
    if (host !== undefined) return
    if (movedOf(this.#storage()).has(project)) return
    if (!this.#move && this.#none) {
      // The module's start may come in the commit this list reads in, as
      // the window's effect runs after its children's: one tick for it.
      await Promise.resolve()
    } else if (!this.#move) {
      let start = () => {}
      const started = new Promise<void>((done) => (start = done))
      this.#starts.add(start)
      if (!(await within(started, this.#wait))) {
        this.#starts.delete(start)
        this.#none = !this.#move
      }
    }
    const move = this.#move
    if (move?.engine !== engine) return
    if (!(await within(move.over, this.#wait))) return
    const storage = this.#storage()
    if (movedOf(storage).has(project)) return
    // One the move did not take, as one missing at the start and located
    // since, or one whose move failed: once, as a failure goes again at
    // the next start, not in a loop.
    let alone = this.#alone.get(project)
    if (!alone) {
      const old = keptOf(storage)
      alone = old
        ? moveProject(engine, project, old, storage).catch(() => 0)
        : Promise.resolve(0)
      this.#alone.set(project, alone)
    }
    await within(alone, this.#wait)
  }
}

/** This window's move. */
export const move = new Move(() => localStorage)
