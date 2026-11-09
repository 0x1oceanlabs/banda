/** What every line's view is given (ADR 0091, decision 3). */
import type { ComponentType } from "react"
import type { Item, Later, TurnState } from "@banda/contract/agents"
import type { EntryFacts } from "../entries/types"
import type { Moves } from "../thread/moves"
import type { Line } from "../thread/timeline"

/** What the Thread knows that its lines show, the same for a line and
 * the lines it holds. */
export type LineFacts = {
  /** What the Thread knows of one entry. */
  of: (item: Item) => EntryFacts
  /** How a turn stands, by its id, if known. */
  turnState: (turn: string | undefined) => TurnState | undefined
  /** What the Person looks for, if anything. */
  finding: string
  /** The Agent's name. */
  name: string
  /** The account the Thread runs on, by its entry's ID. */
  harness: string
  /** Whether a command is on its way. */
  answering: boolean
  /** The Thread's Later, if it sleeps. */
  later?: Later
  /** Where the Thread may move, for a limit's card (ADR 0078). */
  moves?: Moves
}

export type LineProps<K extends Line["kind"]> = {
  line: Extract<Line, { kind: K }>
  facts: LineFacts
}

/** How one kind of line is drawn. */
export type LineView<K extends Line["kind"]> = ComponentType<LineProps<K>>
