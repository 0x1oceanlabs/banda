/**
 * A sub-agent as its row opened in place follows it (ADR 0103, decision
 * 15): read once with `agents.subagent`, then each of its Thread's facts
 * that are of its lane. Its fold is the engine's view of it, as a
 * Thread's is (ADR 0014, decision 3), and the checkpoints keep the two
 * equal.
 */
import { useMemo } from "react"
import type { Engine, Event, ProjectId } from "@banda/contract"
import {
  decodeFact,
  knownItem,
  type Item,
  type Subagent,
  type SubagentId,
  type SubagentView,
  type ThreadId,
  type TurnState,
} from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { isWorkKind } from "../entries/kinds"
import {
  changedIn,
  changeOne,
  entryOf,
  grown,
  laneChanged,
  laneEnded,
  subOf,
} from "./facts"
import { type Did, did } from "./timeline"

/** A sub-agent as its row opened in place holds it. */
export type LaneState = {
  /** The last position in the Project's log this state includes. */
  at: number
  /** The Thread it works in. */
  thread: ThreadId
  subagent: Subagent
  /** Its own entries, and the Questions it asked, in the order they came. */
  items: Item[]
  /** The sub-agents it started, in the order they started. */
  subagents: Subagent[]
}

/** The sub-agent `view` holds, but for its entries of a kind this window
 * does not know (ADR 0103, decision 10). */
export function fromSubagentView(view: SubagentView): LaneState {
  const { at, thread, subagent, items, subagents } = view
  return { at, thread, subagent, items: items.filter(knownItem), subagents }
}

/**
 * The state after `event`: its lane's entries start and change as a
 * Thread's do, through the same reducers; a Question it asks comes too;
 * the sub-agents it starts come with their anchors. A fact of its Thread
 * or of another lane changes nothing. Pure, so plain tests cover it.
 */
export function applyLane(state: LaneState, event: Event): LaneState {
  if (event.seq <= state.at) return state
  const next = { ...state, at: event.seq }
  const fact = decodeFact(event)
  if (!fact) return next
  const own = state.subagent.id
  switch (fact.kind) {
    case "subagent.started": {
      const { item, subagent } = fact.payload
      if (subagent.parent !== own) return next
      const body = { kind: "subagent", subagent: subagent.id } as const
      return {
        ...next,
        items: [...state.items, entryOf(event, item, body, subagent.turn)],
        subagents: [...state.subagents, subagent],
      }
    }
    case "subagent.changed": {
      const { subagent: id, ...change } = fact.payload
      return changeLane(next, id, (lane) => laneChanged(lane, change))
    }
    case "subagent.ended":
      return changeLane(next, fact.payload.subagent, (lane) =>
        laneEnded(lane, fact.payload)
      )
  }
  const sub = subOf(fact)
  // Its own entries, and a Question it asks, which is its Thread's.
  if (sub !== undefined)
    return sub === own
      ? { ...next, items: grown(state.items, fact, event) }
      : next
  // A change by ID, of a call, a plan or a Question it holds.
  const items = changedIn(state.items, fact)
  return items === state.items ? next : { ...next, items }
}

/** `state` with sub-agent `id` changed by `change`: itself, or one it
 * started. */
function changeLane(
  state: LaneState,
  id: SubagentId,
  change: (lane: Subagent) => Subagent
): LaneState {
  if (state.subagent.id === id)
    return { ...state, subagent: change(state.subagent) }
  if (!state.subagents.some((lane) => lane.id === id)) return state
  return { ...state, subagents: changeOne(state.subagents, id, change) }
}

/** How a sub-agent's work stands as a turn's would: at work, it runs; a
 * lost one was cut short. */
export function turnStateOf(lane: Subagent): TurnState {
  switch (lane.state) {
    case "running":
    case "asks":
    case "queued":
      return "running"
    case "lost":
      return "interrupted"
    default:
      return lane.state
  }
}

/** Its work: its calls and thoughts, in the order they came. */
export function workOfLane(state: LaneState): Item[] {
  return state.items.filter((item) => isWorkKind(item.body.kind))
}

/** What its work line says, counted from its own entries as a turn's is
 * (ADR 0058, decision 4): "Read 12 files, ran 2 commands". While it works
 * a call counts once it has ended. */
export function laneDid(state: LaneState): Did {
  return did(workOfLane(state), turnStateOf(state.subagent))
}

/** Sub-agent `sub` as its engine has it now. */
export async function readSubagent(
  engine: Engine,
  project: ProjectId,
  sub: SubagentId
): Promise<LaneState> {
  const view = await engine.call(
    "agents.subagent",
    { subagent: sub },
    { project }
  )
  return fromSubagentView(view)
}

/** Sub-agent `sub` of Thread `thread`, live, as its row opened in place
 * reads it; none to follow without one. Shaped as `useThread`. */
export function useSubagent(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  sub: SubagentId | null
) {
  const source = useMemo(
    () =>
      sub === null
        ? null
        : {
            read: () => readSubagent(engine, project, sub),
            // A lane's facts have its Thread as their subject.
            filter: { module: "agents", subject: thread },
            apply: applyLane,
          },
    [engine, project, thread, sub]
  )
  return useLive(engine, project, source)
}
