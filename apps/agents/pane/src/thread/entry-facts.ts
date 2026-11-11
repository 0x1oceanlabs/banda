/** What a Thread knows of each of its entries, as data (ADR 0091,
 * decision 2). An entry is memoised on these, so a fact that changes
 * nothing of an entry hands it the same values and it is not drawn again
 * (ADR 0088, decision 9); `entry-facts.test.ts` holds that. Each fact goes only
 * to the entries that show it: one that went to all would draw them all
 * again each time it changed. */
import type { Item, SubagentId, TurnView } from "@banda/contract/agents"
import type { EntryFacts, SubagentRow } from "../entries/types"
import {
  isReply,
  type Listing,
  running,
  type ThreadState,
  writerOf,
  writing,
} from "./state"
import { awaiting, thoughtTimes } from "./timeline"

/** What the facts are read from: worked out once for each state, not
 * again when only the list of Threads changes. */
export type Known = ReturnType<typeof knownOf>

export function knownOf(state: ThreadState) {
  const turns = new Map(state.turns.map((one) => [one.id, one]))
  // Each Person's message's first turn, as `firstTurnOf` finds it.
  const firsts = new Map<string, TurnView>()
  for (const turn of state.turns) {
    if (turn.state !== "withdrawn" && !firsts.has(turn.message)) {
      firsts.set(turn.message, turn)
    }
  }
  return {
    asks: awaiting(state),
    thoughts: thoughtTimes(state),
    live: running(state) !== undefined ? writing(state) : undefined,
    turns,
    firsts,
    turnState: (id: string | undefined) =>
      id === undefined ? undefined : turns.get(id)?.state,
  }
}

/** The facts of one entry; `rows` the sub-agents' rows the Thread shows,
 * `about` what its messages say of sub-agents (ADR 0103, decision 25). */
export function factsOf(
  { asks, thoughts, live, turns, firsts, turnState }: Known,
  writers: Listing,
  rows: Map<SubagentId, SubagentRow> = new Map(),
  about: (item: Item) => Partial<EntryFacts> = () => ({})
): (item: Item) => EntryFacts {
  return (item) => ({
    // Only a call shows how its turn stands.
    turn: item.body.kind === "tool" ? turnState(item.turn) : undefined,
    asks: asks.has(item.id),
    took: thoughts.get(item.id),
    live: item === live,
    writer: writerOf(writers, item),
    forks: forkAt(turns, item),
    edits: editAt(firsts, item),
    subagentRow:
      item.body.kind === "subagent" ? rows.get(item.body.subagent) : undefined,
    ...about(item),
  })
}

/** A reply's turn, to fork the Thread at its end; null while it may not. */
function forkAt(turns: Map<string, TurnView>, item: Item) {
  if (!isReply(item)) return undefined
  const its = item.turn === undefined ? undefined : turns.get(item.turn)
  return its && (its.can.fork ? its : null)
}

/** The turn that ran a Person's message first, to edit it from; null while
 * it may not. */
function editAt(firsts: Map<string, TurnView>, item: Item) {
  if (item.author.kind !== "person") return undefined
  const its = firsts.get(item.id)
  return its && (its.can.rewind ? its : null)
}
