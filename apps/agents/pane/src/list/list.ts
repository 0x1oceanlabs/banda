/**
 * A Project's Threads, as the sidebar holds them: the list it read, then
 * each fact applied, and what each one at work does as `agents.doing` says
 * it. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, ProjectId } from "@banda/contract"
import {
  decodeFact,
  type DoingNow,
  type Fact,
  type ListedThread,
  type ThreadList,
  type ThreadsDoing,
} from "@banda/contract/agents"
import { sameData } from "@banda/core/react"
import { READ_AGAIN, type Source } from "@banda/ui/hooks/use-live"

/** How much of a message the list keeps, as the engine does. */
export const LISTED_MESSAGE = 200

export async function readThreads(
  engine: Engine,
  project: ProjectId
): Promise<ThreadList> {
  return engine.call("agents.threads", {}, { project })
}

/**
 * The facts the list follows: which Threads there are, in what order, what
 * each is called, where each one's work stands, and the Person's marks on
 * it, which its host keeps (ADR 0096). A streaming reply never reaches it.
 */
export const THREADS_FILTER = {
  module: "agents",
  kinds: [
    "thread.started",
    "message.posted",
    "turn.started",
    "turn.ended",
    "thread.rewound",
    "thread.deleted",
    "thread.renamed",
    "question.asked",
    "question.answered",
    "question.closed",
    "thread.later",
    "thread.woke",
    "thread.woke_seen",
    "thread.switched",
    "thread.seen",
    "thread.unseen",
    "thread.archived",
    "thread.unarchived",
    "marks.moved",
    "thread.left",
    "thread.arrived",
    "subagent.started",
    "subagent.changed",
    "subagent.ended",
    "crew.started",
    "crew.progressed",
    "crew.ended",
  ] satisfies Fact["kind"][],
} satisfies EventFilter

/** A Project's Threads, read and then followed. Keep it in `useMemo`. */
export function threadsSource(
  engine: Engine,
  project: ProjectId
): Source<ThreadList> {
  return {
    read: () => readThreads(engine, project),
    filter: THREADS_FILTER,
    apply: (state, event) =>
      readsAgain(state, event) ? READ_AGAIN : applyThreads(state, event),
  }
}

/**
 * Whether the list is read again, as only the engine knows what it is
 * now. Each seldom happens:
 * - a Thread of the list went back to before a message (ADR 0027): its
 *   latest turn and message are then earlier ones, and a seen that named
 *   a turn taken out names none (ADR 0096, decision 2);
 * - a window moved its marks to the host, all in one fact (ADR 0096,
 *   decision 9);
 * - a Thread came, whole, from another Project (ADR 0098, decision 14).
 */
export function readsAgain(state: ThreadList, event: Event): boolean {
  const fact = decodeFact(event)
  if (fact?.kind === "marks.moved" || fact?.kind === "thread.arrived")
    return true
  if (fact && movesSubagents(fact))
    return state.threads.some((thread) => thread.id === event.subject)
  return (
    fact?.kind === "thread.rewound" &&
    state.threads.some((thread) => thread.id === fact.payload.thread)
  )
}

/**
 * Whether `fact` may change how many of a Thread's direct sub-agents work
 * or failed, and which one works (ADR 0103, decision 10): one started, one
 * ended, or one's state changed; or what its Crew at work says, its phase
 * and count (step 4). Only the engine knows its lanes and Crews, so the
 * list is read again.
 */
function movesSubagents(fact: Fact): boolean {
  switch (fact.kind) {
    case "subagent.started":
      return fact.payload.subagent.parent === undefined
    case "subagent.changed":
      return fact.payload.state !== undefined
    case "subagent.ended":
    case "crew.started":
    case "crew.ended":
      return true
    case "crew.progressed":
      return (fact.payload.agents ?? []).length > 0
    default:
      return false
  }
}

/**
 * The list after one fact. A new Thread joins it at the top, and a Thread
 * that heard a message or ended a turn moves there; one its Person deleted
 * leaves it (ADR 0098, decision 14). Each Thread keeps its latest turn
 * that began, how many lines its latest that ended changed, its Questions
 * that wait, the start of its latest message, its Later and the Person's
 * marks, as the engine reads them. A mark moves no Thread (ADR 0096,
 * decision 6). A list the fact
 * changed stands at the fact's place in the log, which a mark the Person
 * sent waits for (`./sent.ts`); one it left as it was stays where it was.
 */
export function applyThreads(state: ThreadList, event: Event): ThreadList {
  const next = applied(state, event)
  return next === state ? state : { ...next, at: event.seq }
}

function applied(state: ThreadList, event: Event): ThreadList {
  const fact = decodeFact(event)
  if (!fact) return state
  switch (fact.kind) {
    case "thread.started": {
      const { thread: id, title, harness = "", agent = "" } = fact.payload
      if (state.threads.some((thread) => thread.id === id)) return state
      const at = event.at
      // Its parent, the Thread whose Agent started it, is said only here
      // (ADR 0098, decision 24).
      const { parent } = fact.payload
      const started = {
        id,
        harness,
        title,
        agent,
        ...(parent ? { parent } : {}),
        updated_at: at,
        asking: [],
      }
      return { ...state, threads: [started, ...state.threads] }
    }
    case "message.posted": {
      const message = fact.payload.text.slice(0, LISTED_MESSAGE)
      return change(state, event, (thread) => ({ ...thread, message }), true)
    }
    case "turn.started": {
      const { turn } = fact.payload
      return change(state, event, (thread) => ({
        // What failed in the turn before is no longer counted.
        ...subagentsKept(thread, true),
        latest: { turn, state: "running", began: event.at },
      }))
    }
    case "turn.ended": {
      const { turn, state: ended, reason, note, failure } = fact.payload
      const { changed_lines } = fact.payload
      // A turn a Person took back never began, so it is no one's latest.
      if (ended === "withdrawn") return state
      return change(
        state,
        event,
        (thread) => ({
          // What the turn before changed goes: this one says its own.
          ...without(subagentsKept(thread, false), "changed_lines"),
          latest: {
            turn,
            state: ended,
            began:
              thread.latest?.turn === turn ? thread.latest.began : event.at,
            ...(reason ? { reason } : {}),
            ...(note ? { note } : {}),
            ...(failure ? { failure } : {}),
          },
          ...(changed_lines ? { changed_lines } : {}),
        }),
        true
      )
    }
    case "thread.renamed": {
      // A new title moves nothing: nothing happened in the Thread.
      const { title, was } = fact.payload
      return change(state, event, (thread) => ({ ...thread, title, was }))
    }
    case "question.asked": {
      const { item, title, choices, form, plan, asker } = fact.payload
      // A click answers one with no form and no plan, as the engine lists
      // it (ADR 0056, decision 3); a sub-agent's says who asks.
      const asking = {
        item,
        title,
        ...(form === undefined && plan === undefined && choices.length > 0
          ? { choices }
          : {}),
        ...(asker ? { asker } : {}),
      }
      return change(state, event, (thread) =>
        thread.asking.some((asking) => asking.item === item)
          ? thread
          : { ...thread, asking: [...thread.asking, asking] }
      )
    }
    case "question.answered":
    case "question.closed": {
      const { item } = fact.payload
      return change(state, event, (thread) =>
        thread.asking.some((asking) => asking.item === item)
          ? {
              ...thread,
              asking: thread.asking.filter((asking) => asking.item !== item),
            }
          : thread
      )
    }
    case "thread.later": {
      const later = {
        at: event.at,
        by: event.author,
        until: fact.payload.until,
        someday: fact.payload.someday,
      }
      return change(state, event, (thread) => ({ ...thread, later }))
    }
    case "thread.woke": {
      const woke = { at: fact.payload.at ?? event.at, by: fact.payload.by }
      return change(state, event, (thread) =>
        thread.later ? { ...thread, later: { ...thread.later, woke } } : thread
      )
    }
    case "thread.woke_seen": {
      const { seen } = fact.payload
      return change(state, event, (thread) =>
        thread.later
          ? { ...thread, later: { ...thread.later, woke_seen: seen } }
          : thread
      )
    }
    case "thread.switched": {
      // Another account of its Harness, from its next turn (ADR 0078).
      const { harness } = fact.payload
      return change(state, event, (thread) => ({ ...thread, harness }))
    }
    case "thread.seen": {
      const { turn } = fact.payload
      return change(state, event, (thread) => ({ ...thread, seen: turn }))
    }
    case "thread.unseen":
      return change(state, event, (thread) => without(thread, "seen"))
    case "thread.archived": {
      // In the host's time, the event's own, as its `updated_at` is.
      const archived = { at: event.at }
      return change(state, event, (thread) => ({ ...thread, archived }))
    }
    case "thread.unarchived":
      return change(state, event, (thread) => without(thread, "archived"))
    // Deleted, or moved to another Project, whose list has it now.
    case "thread.deleted":
    case "thread.left": {
      const { thread: id } = fact.payload
      const threads = state.threads.filter((thread) => thread.id !== id)
      return threads.length === state.threads.length
        ? state
        : { ...state, threads }
    }
    default:
      return state
  }
}

/** Whether `thread`'s archive holds, as its host's rule has it: nothing
 * happened in it since, by the host's own times (ADR 0096, decisions 4
 * and 7). */
export const archiveHolds = ({ archived, updated_at }: ListedThread) =>
  archived !== undefined && updated_at <= archived.at

/**
 * `thread`'s sub-agents as its turn starts (`started`) or ends, while the
 * list is not read again (ADR 0103, decision 10): a new turn counts none
 * failed; a Thread none of whose sub-agents works then works no more, so
 * the list says none. The same Thread when nothing changes.
 */
export function subagentsKept(
  thread: ListedThread,
  started: boolean
): ListedThread {
  const { subagents } = thread
  if (!subagents) return thread
  if (subagents.working === 0) return without(thread, "subagents")
  if (!started || subagents.failed === 0) return thread
  return { ...thread, subagents: { ...subagents, failed: 0 } }
}

/** `thread` with no `mark`, no lines its last turn changed, or no
 * sub-agents: the same Thread when it had none. */
export function without(
  thread: ListedThread,
  mark: "seen" | "archived" | "changed_lines" | "subagents"
): ListedThread {
  if (thread[mark] === undefined) return thread
  const unmarked = { ...thread }
  delete unmarked[mark]
  return unmarked
}

/**
 * The list with the event's Thread changed by `how`; with `moves`, that
 * Thread goes to the top, changed at the event's time. The same list when
 * nothing changed.
 */
function change(
  state: ThreadList,
  event: Event,
  how: (thread: ListedThread) => ListedThread,
  moves = false
): ThreadList {
  const found = state.threads.find((thread) => thread.id === event.subject)
  if (!found) return state
  const changed = how(found)
  if (!moves) {
    if (changed === found) return state
    const threads = state.threads.map((t) => (t === found ? changed : t))
    return { ...state, threads }
  }
  const moved = { ...changed, updated_at: event.at }
  const others = state.threads.filter((thread) => thread !== found)
  return { ...state, threads: [moved, ...others] }
}

/**
 * What `agents.doing` said last of a Project's Threads at work (ADR 0099,
 * decision 11), by Thread: what its running turn does, when it last said
 * anything, whether its Harness compacts the context, and when a usage
 * limit lets it go on.
 */
export type Doings = ReadonlyMap<string, DoingNow>

/** No Thread is known to do anything. */
const NOTHING_DOING: Doings = new Map()

/** Every field of `DoingNow`, which the stream says of a Thread whole: one
 * it gains is named here, or the types refuse it, so a Thread whose turn
 * ended never keeps it. */
const DOING = Object.keys({
  doing: true,
  stepped: true,
  compacting: true,
  limit_until: true,
} satisfies Record<keyof DoingNow, true>) as (keyof DoingNow)[]

/**
 * What the Threads at work do after one piece of `agents.doing`. The
 * first piece names all of them, again after each reconnect, so any other
 * held is let go; each later one names only the Threads that changed, and
 * a Thread whose turn ended with nothing but its ID.
 */
function heardDoing(held: Doings, piece: ThreadsDoing): Doings {
  const next = new Map(piece.all ? [] : held)
  for (const { thread, ...now } of piece.threads) {
    if (DOING.every((key) => now[key] === undefined)) next.delete(thread)
    else next.set(thread, now)
  }
  return next
}

/**
 * Hears what `project`'s Threads at work do (`agents.doing`) on `engine`,
 * the session of the machine whose Project it is, and tells `tell` all of
 * it after each piece. A reconnect hears it again from its first piece.
 * Once the engine refuses it, as one older than the stream does, or ends
 * it, no Thread is known to do anything. Returns how to stop.
 */
export function hearDoing(
  engine: Engine,
  project: ProjectId,
  tell: (doings: Doings) => void
): () => void {
  let held = NOTHING_DOING
  return engine.stream(
    project,
    "agents.doing",
    {},
    (piece) => tell((held = heardDoing(held, piece))),
    () => tell((held = NOTHING_DOING))
  )
}

/**
 * `threads` with what each one at work does, merged in as the stream says
 * it, so the list is not read again for it: what `doings` holds once the
 * stream said anything, else what the list read. Only a Thread whose
 * latest turn runs does anything, as the stream may hear a turn end before
 * or after the list does. The same list where nothing changed, and the
 * same Thread where what it does is the same.
 */
export function withDoing(
  threads: readonly ListedThread[],
  doings: Doings | undefined
): readonly ListedThread[] {
  let changed = false
  const merged = threads.map((thread) => {
    const now =
      thread.latest?.state !== "running"
        ? undefined
        : doings
          ? doings.get(thread.id)
          : thread
    const next = doingIn(thread, now)
    changed ||= next !== thread
    return next
  })
  return changed ? merged : threads
}

/** `thread` doing `now`, and nothing more of `DoingNow`'s: the same
 * Thread when it does that already. */
function doingIn(thread: ListedThread, now: DoingNow = {}): ListedThread {
  if (DOING.every((key) => sameData(thread[key], now[key]))) return thread
  const next: Record<string, unknown> = { ...thread }
  for (const key of DOING) {
    if (now[key] === undefined) delete next[key]
    else next[key] = now[key]
  }
  return next as ListedThread
}
