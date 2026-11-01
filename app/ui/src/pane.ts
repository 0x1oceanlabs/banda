/**
 * The Pane contract. A Pane is one tile of a workspace: the window places,
 * sizes and focuses it; the Pane shows one thing of one Space and reaches
 * the engine only through the API (docs/architecture.md, "Modules").
 *
 * A module offers its Panes as {@link PaneKind}s, and the window's registry
 * lists them. A Pane's `args` are its own small state; the window keeps
 * them with its workspaces, so a Pane comes back as it was.
 */
import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import type { Engine, JsonValue, SpaceId } from "@bandaso/contract"

/**
 * Marks where a program reads the keys, as in a terminal. Banda's Alt keys
 * still work there; everything else is the program's. Spread it on the
 * element: `<div {...PROGRAM_KEYS} />`.
 */
export const PROGRAM_KEYS = { "data-keys": "program" } as const

/** What one tile shows: a kind of Pane and its args. */
export type PaneState = { kind: string; args: { [key: string]: JsonValue } }

/**
 * Where a Pane opens, from the Pane that opens it: in a new column to its
 * right, below it in its column, or in its own place. Left out, the window
 * shows the Pane where its workspace shows one of its kind, or to the right.
 */
export type Place = "right" | "below" | "here"

export type PaneProps<A> = {
  engine: Engine
  space: SpaceId
  args: A
  /** Whether this tile has the focus: keys go to it. */
  focused: boolean
  /**
   * Opens a Pane of this Pane's Space, or of `space` when it is given; a
   * Pane already shown gets the focus instead.
   */
  open: (pane: PaneState, place?: Place, space?: SpaceId) => void
  /** Keeps new args for this Pane. */
  update: (args: A) => void
  /** Closes this Pane, as one that finished its job does. */
  close: () => void
}

export type PaneKind<A extends { [key: string]: JsonValue }> = {
  /** Unique, with the module's name first: `agents.thread`. */
  kind: string
  /** The engine module the Pane needs; the window hides the Pane without it. */
  module?: string
  /** The words in its header. */
  title: (args: A) => string
  icon: LucideIcon
  /** When set, a Person can open the Pane from the menu with these args. */
  start?: A
  /** A list that sits beside other Panes: it opens a third of the screen wide. */
  narrow?: boolean
  /**
   * What its module lets go of once the Pane leaves every workspace: it
   * closed, or its place shows another Pane or the same with other args. A
   * program in a terminal stops then. A Pane drawn again, as when it moves
   * to another column or workspace, has not left.
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
