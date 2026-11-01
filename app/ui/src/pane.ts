/**
 * The Pane contract. A Pane is one tile of the Desk: the Desk places,
 * sizes and focuses it; the Pane shows one thing and reaches the engine
 * only through the API (docs/architecture.md, "Modules").
 *
 * A module offers its Panes as {@link PaneKind}s, and the window's registry
 * lists them. A Pane's `args` are its own small state; the Desk keeps them
 * with its layout, so a Pane comes back as it was.
 */
import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import type { Engine, JsonValue, SpaceId } from "@bandaso/contract"

/** What one tile shows: a kind of Pane and its args. */
export type PaneState = { kind: string; args: { [key: string]: JsonValue } }

/**
 * Where a Pane opens, from the Pane that opens it: in a new tile to its
 * right or below it, or in its own tile. Left out, the Desk shows the
 * Pane in the tile that last showed its kind, or to the right.
 */
export type Place = "right" | "below" | "here"

export type PaneProps<A> = {
  engine: Engine
  space: SpaceId
  args: A
  /** Whether this tile has the focus: keys go to it. */
  focused: boolean
  /** Opens a Pane; a Pane already on the desk gets the focus instead. */
  open: (pane: PaneState, place?: Place) => void
  /** Keeps new args for this Pane. */
  update: (args: A) => void
}

export type PaneKind<A extends { [key: string]: JsonValue }> = {
  /** Unique, with the module's name first: `agents.thread`. */
  kind: string
  /** The engine module the Pane needs; the Desk hides the Pane without it. */
  module?: string
  /** The words in its header. */
  title: (args: A) => string
  icon: LucideIcon
  /** When set, a Person can open the Pane from the menu with these args. */
  start?: A
  /** A list that sits beside other Panes: a tile split from it takes most of the room. */
  narrow?: boolean
  /**
   * What its module lets go of once the Pane leaves the Desk: the Person
   * closed it, or another Pane took its tile. A program in a terminal stops
   * then. A Pane drawn again, as when a split moves it, has not left.
   */
  closed?: (left: { engine: Engine; space: SpaceId; args: A }) => void
  Pane: ComponentType<PaneProps<A>>
}

/** Declares a kind of Pane; keeps its args' type checked inside. */
export function definePane<A extends { [key: string]: JsonValue }>(
  kind: PaneKind<A>
): PaneKind<A> {
  return kind
}

/** A Pane's state, made from its kind. */
export function paneOf<A extends { [key: string]: JsonValue }>(
  kind: PaneKind<A>,
  args: A
): PaneState {
  return { kind: kind.kind, args }
}
