/**
 * The Agents of a Space and their Threads, as the Agents Pane holds them:
 * the lists it read, then each fact applied. Pure, so plain tests cover it.
 */
import type { Engine, Event, EventFilter, SpaceId } from "@bandaso/contract"
import {
  type AgentView,
  decodeFact,
  type Fact,
  type ThreadList,
  type ThreadSummary,
} from "@bandaso/contract/agents"
import { DEFAULT_SETTINGS } from "./thread"

export type AgentsState = {
  at: number
  agents: AgentView[]
  threads: ThreadSummary[]
}

/**
 * Reads both lists. The Threads come first: their `at` is where following
 * starts, so an Agent made between the two reads is in the list or comes
 * as a fact, and never neither.
 */
export async function readAgents(
  engine: Engine,
  space: SpaceId
): Promise<AgentsState> {
  const list = await engine.call<ThreadList>("agents.threads", {}, { space })
  const agents = await engine.call<AgentView[]>("agents.list", {}, { space })
  return { at: list.at, agents, threads: list.threads }
}

/** The facts the list shows: a streaming reply never reaches it. */
export const AGENTS_FILTER = {
  module: "agents",
  kinds: [
    "agent.created",
    "thread.started",
    "message.posted",
    "turn.ended",
  ] satisfies Fact["kind"][],
} satisfies EventFilter

export function applyAgents(state: AgentsState, event: Event): AgentsState {
  const fact = decodeFact(event)
  if (!fact) return state
  switch (fact.kind) {
    case "agent.created": {
      const { agent: id, name, harness } = fact.payload
      if (state.agents.some((agent) => agent.id === id)) return state
      // A new Agent's file names no settings of its own.
      const made = { id, name, harness, settings: DEFAULT_SETTINGS }
      return { ...state, agents: [...state.agents, made] }
    }
    case "thread.started": {
      const { thread: id, agent, title } = fact.payload
      if (state.threads.some((thread) => thread.id === id)) return state
      const started = { id, agent, title, updated_at: event.at }
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

/** An Agent's Threads, the one changed last first. */
export function threadsOf(state: AgentsState, agent: string): ThreadSummary[] {
  return state.threads.filter((thread) => thread.agent === agent)
}
