/** What every entry's view is given (ADR 0091, decision 2). */
import type {
  Body,
  Item,
  ListedThread,
  Subagent,
  TurnView,
} from "@banda/contract/agents"
import type { ComponentType } from "react"
import type { RowSaid } from "../thread/subagents"
import type { Asker } from "./parts/Brief"

/** An entry whose body is of kind `K`. */
export type EntryOf<K extends Body["kind"]> = Item & {
  body: Extract<Body, { kind: K }>
}

/** The facts its Thread knows about an entry, as data: the view calls the
 * Thread's acts itself (`useThreadAround`). */
export type EntryFacts = {
  /** How its turn stands, if it has one. */
  turn?: TurnView["state"]
  /** It is a call that waits for its Person's answer. */
  asks: boolean
  /** How long it took, in ms, when it is a thought and that is known. */
  took?: number
  /** Whether the Agent is still writing it. */
  live: boolean
  /** The other Thread whose Agent wrote it, if one did. */
  writer?: ListedThread | "gone"
  /** A reply's turn, to fork at its end; null when it may not yet. */
  forks?: TurnView | null
  /** A Person's message's first turn, to edit it from; null when it may
   * not. */
  edits?: TurnView | null
  /** The sub-agent an anchor names, as its row shows it; none for any
   * other entry, or one the Thread no longer has. */
  subagentRow?: SubagentRow
  /** A Person's message's sub-agents by their labels, for the chips that
   * name them (ADR 0103, decision 25); none for one that names none. */
  about?: ReadonlyMap<string, Subagent>
  /** What was written to a sub-agent after its brief, where it was sent:
   * the label of the one it went to, if the Thread still has it. */
  to?: string
  /** The same in that sub-agent's own Pane: who wrote it, over its
   * bubble. */
  wrote?: Asker
}

/** A sub-agent where it started (ADR 0103, decision 15): the same object
 * until its row says something else, so only that row draws again. */
export type SubagentRow = {
  lane: Subagent
  /** What its row says, as its Thread words it. */
  said: RowSaid
  /** Who set it to work, as its brief says: its Harness, "Claude". */
  asker: string
}

export type EntryProps<K extends Body["kind"]> = EntryFacts & {
  item: EntryOf<K>
}

/** How one kind of entry is drawn. */
export type EntryView<K extends Body["kind"]> = ComponentType<EntryProps<K>>
