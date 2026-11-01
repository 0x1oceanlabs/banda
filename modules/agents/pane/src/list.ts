/**
 * A Space's Threads, as the sidebar holds them: the list it read, then
 * each fact applied. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, SpaceId } from "@bandaso/contract"
import {
  decodeFact,
  type Fact,
  type ListedThread,
  type ThreadList,
} from "@bandaso/contract/agents"
import type { Source } from "@bandaso/ui/hooks/use-live"

export async function readThreads(
  engine: Engine,
  space: SpaceId
): Promise<ThreadList> {
  return engine.call<ThreadList>("agents.threads", {}, { space })
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
    "question.asked",
    "question.answered",
    "question.closed",
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
    apply: applyThreads,
  }
}

/**
 * The list after one fact. A new Thread joins it at the top, and a Thread
 * that heard a message or ended a turn moves there. Each Thread keeps its
 * latest turn that began and its Questions that wait, as the engine reads
 * them.
 */
export function applyThreads(state: ThreadList, event: Event): ThreadList {
  const fact = decodeFact(event)
  if (!fact) return state
  switch (fact.kind) {
    case "thread.started": {
      const { thread: id, title, harness = "" } = fact.payload
      if (state.threads.some((thread) => thread.id === id)) return state
      const started = { id, harness, title, updated_at: event.at, asking: [] }
      return { ...state, threads: [started, ...state.threads] }
    }
    case "message.posted":
      return change(state, event, (thread) => thread, true)
    case "turn.started": {
      const { turn } = fact.payload
      return change(state, event, (thread) => ({
        ...thread,
        latest: { turn, state: "running" },
      }))
    }
    case "turn.ended": {
      const { turn, state: ended } = fact.payload
      // A turn a Person took back never began, so it is no one's latest.
      if (ended === "withdrawn") return state
      return change(
        state,
        event,
        (thread) => ({ ...thread, latest: { turn, state: ended } }),
        true
      )
    }
    case "question.asked": {
      const { item } = fact.payload
      return change(state, event, (thread) =>
        thread.asking.includes(item)
          ? thread
          : { ...thread, asking: [...thread.asking, item] }
      )
    }
    case "question.answered":
    case "question.closed": {
      const { item } = fact.payload
      return change(state, event, (thread) =>
        thread.asking.includes(item)
          ? { ...thread, asking: thread.asking.filter((id) => id !== item) }
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
