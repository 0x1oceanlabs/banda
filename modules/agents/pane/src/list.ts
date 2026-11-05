/**
 * A Space's Threads, as the sidebar holds them: the list it read, then
 * each fact applied. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, SpaceId } from "@banda/contract"
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
  space: SpaceId
): Promise<ThreadList> {
  return engine.call("agents.threads", {}, { space })
}

/**
 * The facts the list follows: which Threads there are, in what order, and
 * where each one's work stands. A streaming reply never reaches it.
 */
export const THREADS_FILTER = {
  module: "agents",
  kinds: [
    "thread.started",
    "message.posted",
    "turn.started",
    "turn.ended",
    "thread.rewound",
    "question.asked",
    "question.answered",
    "question.closed",
    "thread.snoozed",
    "thread.woke",
  ] satisfies Fact["kind"][],
} satisfies EventFilter

/** A Space's Threads, read and then followed. Keep it in `useMemo`. */
export function threadsSource(
  engine: Engine,
  space: SpaceId
): Source<ThreadList> {
  return {
    read: () => readThreads(engine, space),
    filter: THREADS_FILTER,
    apply: (state, event) =>
      rewound(state, event) ? READ_AGAIN : applyThreads(state, event),
  }
}

/**
 * Whether a Thread of the list went back to before a message (ADR 0027):
 * its latest turn and message are then earlier ones, which only the
 * engine knows, so the list is read again. It seldom happens.
 */
export function rewound(state: ThreadList, event: Event): boolean {
  const fact = decodeFact(event)
  return (
    fact?.kind === "thread.rewound" &&
    state.threads.some((thread) => thread.id === fact.payload.thread)
  )
}

/**
 * The list after one fact. A new Thread joins it at the top, and a Thread
 * that heard a message or ended a turn moves there. Each Thread keeps its
 * latest turn that began, its Questions that wait, the start of its
 * latest message and its snooze, as the engine reads them.
 */
export function applyThreads(state: ThreadList, event: Event): ThreadList {
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
      const { turn, state: ended, reason, note } = fact.payload
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
          },
        }),
        true
      )
    }
    case "question.asked": {
      const { item, title } = fact.payload
      return change(state, event, (thread) =>
        thread.asking.some((asking) => asking.item === item)
          ? thread
          : { ...thread, asking: [...thread.asking, { item, title }] }
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
    default:
      return state
  }
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
