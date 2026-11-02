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
 * still work there; everything else is the program's, and the window
 * hands it a key Banda takes when Ctrl is added: Ctrl+Alt+W reaches the
 * program as Alt+W. Spread it on the element: `<div {...PROGRAM_KEYS} />`.
 */
export const PROGRAM_KEYS = { "data-keys": "program" } as const

/** Where a program reads the keys, as a selector. */
export const IN_PROGRAM = "[data-keys=program]"

/**
 * The window keeps one element with this attribute over its workspaces. It
 * never moves, so what a Pane puts there is never drawn again: a browser's
 * page lives there and follows its Pane's slot (ADR 0013, decision 1).
 */
export const PANE_LAYER = "data-pane-layer"

/** The window's layer over its workspaces; none outside the window. */
export function paneLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${PANE_LAYER}]`)
}

/**
 * Ties what a Pane draws in the layer to its place in the tile: the place
 * carries `HOLDS`, the thing in the layer `HELD_BY`, both with one ID.
 * The window then counts the focus there as the tile's. The look's CSS
 * (styles/globals.css) names both: a tile that holds leaves its background
 * clear, and the thing held takes the tile's opacity on glass.
 */
export const HOLDS = "data-holds"
export const HELD_BY = "data-held-by"

/** The place in a tile that holds `element`, when it is in the layer. */
export function holderOf(element: Element | null): Element | null {
  const id = element?.closest(`[${HELD_BY}]`)?.getAttribute(HELD_BY)
  return id == null
    ? null
    : document.querySelector(`[${HOLDS}="${CSS.escape(id)}"]`)
}

/** Whether `element` is in `tile`, or in the layer and held by it. */
export function within(tile: Element, element: Element | null): boolean {
  return (
    element != null &&
    (tile.contains(element) || tile.contains(holderOf(element)))
  )
}

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
   * Pane already shown gets the focus instead, unless it opens `here`.
   */
  open: (pane: PaneState, place?: Place, space?: SpaceId) => void
  /** Keeps new args for this Pane. */
  update: (args: A) => void
  /** Closes this Pane, as one that finished its job does. */
  close: () => void
  /** Runs an action by its id, as `WindowApi.run` does: "Add Space" from
   * a Space picker. None where no window runs actions, as in a dialog of
   * the settings. */
  run?: (action: string, args?: { [key: string]: JsonValue }) => void
}

export type PaneKind<A extends { [key: string]: JsonValue }> = {
  /** Unique, with its module's id first: `agents.thread`. The window
   * hides it while the engine does not run that module (`Module`). */
  kind: string
  /** The words in its header. */
  title: (args: A) => string
  icon: LucideIcon
  /** When set, a Person can open the Pane from the menu with these args. */
  start?: A
  /** The letter that opens it from the launcher, after Alt+N (ADR 0025,
   * decision 4): `T`. */
  letter?: string
  /** A list that sits beside other Panes: it opens a third of the screen wide. */
  narrow?: boolean
  /**
   * False when the Pane draws its own header, as the browser's row of tabs
   * and address: the frame then draws none (`PaneHeader` draws one).
   * `"bare"` when the frame's header has no line under it, as a Thread's,
   * whose messages fade out under it instead (ADR 0031).
   */
  header?: false | "bare"
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
  /** That Harness's id, which picks its logo where Banda has one. */
  harness?: string
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
  Watch: ComponentType<WatchProps>
}
