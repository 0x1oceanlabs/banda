/** What every entry's view is given (ADR 0091, decision 2). */
import type { Body, Item, ListedThread, TurnView } from "@banda/contract/agents"
import type { ComponentType } from "react"

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
}

export type EntryProps<K extends Body["kind"]> = EntryFacts & {
  item: EntryOf<K>
}

/** How one kind of entry is drawn. */
export type EntryView<K extends Body["kind"]> = ComponentType<EntryProps<K>>
