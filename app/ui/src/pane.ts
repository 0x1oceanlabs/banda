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
import type { Engine, JsonValue, SpaceId } from "@banda/contract"
import type { MarkState } from "./components/banda-mark"

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
   * The one thing the Pane shows, such as its Thread, by the ID its
   * module lists it with (`Listed.id`): a Person who looks at the Pane sees
   * that thing, so it need not call them (ADR 0011). None for a Pane of no
   * one thing, as a list, or of one not yet made.
   */
  shows?: (args: A) => string | null
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
 * One thing a module lists in the sidebar for a Space: a Thread, for the
 * agents module (ADR 0008). The module says what each one is; the window
 * arranges them as the Person's sidebar settings say. One whose mark is
 * `done`, `asking` or `failed` calls its Person: the window tells them
 * where they will notice it (ADR 0011).
 */
export type Listed = {
  id: string
  title: string
  mark: MarkState
  /** When it last changed, in milliseconds since the epoch. */
  changed: number
  /** When the work that runs now began; a timer counts from it. */
  began?: number
  /**
   * What calls the Person, in a few words: what it asks, why it failed.
   * A toast or a system notification says it too.
   */
  calls?: string
  /** What it was last asked to do; its first line shows when nothing calls. */
  said?: string
  /** Who does the work: a Harness's name. */
  by?: string
  /** What a click on it opens. */
  pane: PaneState
}

/** What a Watch says about one Space: what calls the Person, and its list. */
export type Report = Attention & { listed: readonly Listed[] }

export type WatchProps = {
  engine: Engine
  space: SpaceId
  /**
   * Says what the Space calls for now and lists; called on each change,
   * first once the module has read its list. What calls in the first
   * report already was, and is no news (ADR 0011, decision 6).
   */
  report: (report: Report) => void
}

/**
 * How a module tells the window what its work in a Space calls the Person
 * for and what the sidebar lists, while none of its Panes may show. The
 * window draws one per Space for as long as the engine runs the module; it
 * draws nothing itself.
 */
export type Watch = {
  /** The engine module it follows; the window draws it only with it. */
  module: string
  Watch: ComponentType<WatchProps>
}
