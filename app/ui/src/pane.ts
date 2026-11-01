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
import type { MarkState } from "./components/banda-mark"
import type { Chime } from "./sound"

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

/**
 * What a module's work in one Space calls its Person for: the loudest
 * state, as Banda's mark shows it, and how many things wait for the Person
 * to act. The bar shows the loudest of every Space's.
 */
export type Attention = { mark: MarkState; waiting: number }

/** Nothing calls for the Person. */
export const QUIET: Attention = { mark: "rest", waiting: 0 }

/**
 * Something that calls for the Person now, such as a Thread that finished
 * while they were away: the window may play its sound (ADR 0009). `about`
 * names what calls, for the words around it.
 */
export type Call = { chime: Chime; about: string }

export type WatchProps = {
  engine: Engine
  space: SpaceId
  /** Says what the Space calls for now; called again on each change. */
  report: (attention: Attention) => void
  /**
   * Calls for the Person once, when something changes now: never for what
   * already was when the Watch began, nor for what they are looking at.
   */
  call: (call: Call) => void
}

/**
 * How a module tells the window what its work in a Space calls the Person
 * for, and when something calls them now, while none of its Panes may
 * show. The window draws one per Space for as long as the engine runs the
 * module; it draws nothing itself.
 */
export type Watch = {
  /** The engine module it follows; the window draws it only with it. */
  module: string
  Watch: ComponentType<WatchProps>
}
