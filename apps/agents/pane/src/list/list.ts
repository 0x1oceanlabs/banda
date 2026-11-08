/**
 * A Project's Threads, as the sidebar holds them: the list it read, then
 * each fact applied. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, ProjectId } from "@banda/contract"
import {
  decodeFact,
  type Fact,
  type ListedThread,
  type ThreadList,
} from "@banda/contract/agents"
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
    "thread.renamed",
    "question.asked",
    "question.answered",
    "question.closed",
    "thread.snoozed",
    "thread.woke",
    "thread.switched",
    "thread.seen",
    "thread.unseen",
    "thread.archived",
    "thread.unarchived",
    "marks.moved",
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
 * now. Both seldom happen:
 * - a Thread of the list went back to before a message (ADR 0027): its
 *   latest turn and message are then earlier ones, and a seen that named
 *   a turn taken out names none (ADR 0096, decision 2);
 * - a window moved its marks to the host, all in one fact (ADR 0096,
 *   decision 9).
 */
export function readsAgain(state: ThreadList, event: Event): boolean {
  const fact = decodeFact(event)
  if (fact?.kind === "marks.moved") return true
  return (
    fact?.kind === "thread.rewound" &&
    state.threads.some((thread) => thread.id === fact.payload.thread)
  )
}

/**
 * The list after one fact. A new Thread joins it at the top, and a Thread
 * that heard a message or ended a turn moves there. Each Thread keeps its
 * latest turn that began, its Questions that wait, the start of its
 * latest message, its snooze and the Person's marks, as the engine reads
 * them. A mark moves no Thread (ADR 0096, decision 6). A list the fact
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
      const started = { id, harness, title, agent, updated_at: at, asking: [] }
      return { ...state, threads: [started, ...state.threads] }
    }
    case "message.posted": {
      const message = fact.payload.text.slice(0, LISTED_MESSAGE)
      return change(state, event, (thread) => ({ ...thread, message }), true)
    }
    case "turn.started": {
      const { turn } = fact.payload
      return change(state, event, (thread) => ({
        ...thread,
        latest: { turn, state: "running", began: event.at },
      }))
    }
    case "turn.ended": {
      const { turn, state: ended, reason, note, failure } = fact.payload
      // A turn a Person took back never began, so it is no one's latest.
      if (ended === "withdrawn") return state
      return change(
        state,
        event,
        (thread) => ({
          ...thread,
          latest: {
            turn,
            state: ended,
            began:
              thread.latest?.turn === turn ? thread.latest.began : event.at,
            ...(reason ? { reason } : {}),
            ...(note ? { note } : {}),
            ...(failure ? { failure } : {}),
          },
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
      const { item, title, choices, form, plan } = fact.payload
      // A click answers one with no form and no plan, as the engine lists
      // it (ADR 0056, decision 3).
      const asking =
        form === undefined && plan === undefined && choices.length > 0
          ? { item, title, choices }
          : { item, title }
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
    case "thread.snoozed": {
      const snooze = {
        at: event.at,
        by: event.author,
        until: fact.payload.until,
      }
      return change(state, event, (thread) => ({ ...thread, snooze }))
    }
    case "thread.woke": {
      const woke = { at: event.at, by: fact.payload.by }
      return change(state, event, (thread) =>
        thread.snooze
          ? { ...thread, snooze: { ...thread.snooze, woke } }
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
    default:
      return state
  }
}

/** Whether `thread`'s archive holds, as its host's rule has it: nothing
 * happened in it since, by the host's own times (ADR 0096, decisions 4
 * and 7). */
export const archiveHolds = ({ archived, updated_at }: ListedThread) =>
  archived !== undefined && updated_at <= archived.at

/** `thread` with no `mark`: the same Thread when it had none. */
export function without(
  thread: ListedThread,
  mark: "seen" | "archived"
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
