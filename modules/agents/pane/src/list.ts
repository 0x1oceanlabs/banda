/**
 * A Space's Threads, as the sidebar holds them: the list it read, then
 * each fact applied. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, SpaceId } from "@bandaso/contract"
import {
  decodeFact,
  type Fact,
  type ThreadList,
} from "@bandaso/contract/agents"

export async function readThreads(
  engine: Engine,
  space: SpaceId
): Promise<ThreadList> {
  return engine.call<ThreadList>("agents.threads", {}, { space })
}

/** The facts the list shows: a streaming reply never reaches it. */
export const THREADS_FILTER = {
  module: "agents",
  kinds: [
    "thread.started",
    "message.posted",
    "turn.ended",
  ] satisfies Fact["kind"][],
} satisfies EventFilter

/** The list after one fact: a new Thread joins it at the top, and a
 * Thread that heard a message moves there. */
export function applyThreads(state: ThreadList, event: Event): ThreadList {
  const fact = decodeFact(event)
  if (!fact) return state
  switch (fact.kind) {
    case "thread.started": {
      const { thread: id, title, harness = "" } = fact.payload
      if (state.threads.some((thread) => thread.id === id)) return state
      const started = { id, harness, title, updated_at: event.at }
      return { ...state, threads: [started, ...state.threads] }
    }
    case "message.posted":
    case "turn.ended": {
      const found = state.threads.find((thread) => thread.id === event.subject)
      if (!found) return state
      const moved = { ...found, updated_at: event.at }
      const others = state.threads.filter((thread) => thread !== found)
      return { ...state, threads: [moved, ...others] }
    }
    default:
      return state
  }
}
