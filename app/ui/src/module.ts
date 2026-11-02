/**
 * A module's window part, as it declares itself (ADR 0022, decision 1):
 * its one id, and what it offers the window. The window builds its
 * registries from these and names the modules in one list alone; what a
 * module's engine part offers, its `methods!` table says.
 */
import type { JsonValue, SpaceId } from "@banda/contract"
import type { Key } from "./lib/keys"
import type { PaneKind, PaneState, Watch } from "./pane"

/** A Pane's args, and what an action is run with besides the window: the
 * Banda menu's words, a Space. Plain data, as `keys.toml` and the CLI will
 * give it. */
export type Args = { [key: string]: JsonValue }

/** What a registry holds of a kind of Pane: its args' type forgotten. */
export type AnyPaneKind = PaneKind<Args>

/**
 * What a module's action may ask of the window (ADR 0022, decision 3).
 * What a module needs that this lacks is added here, not reached around.
 */
export type WindowApi = {
  /** The Space a new Thread starts in. */
  home: SpaceId
  /** Shows a Pane right of the focused one, with its width, and focuses
   * it: in `space`, else in the focused Pane's Space. */
  open: (pane: PaneState, space?: SpaceId) => void
}

/**
 * One thing the Person can do (ADR 0005, decision 2): keys, buttons, the
 * Banda menu and its key sheet run the same actions. A module's run on
 * the `WindowApi`; the window's own on more of the window.
 */
export type Action<Context = WindowApi> = {
  /** Unique, with its owner first: `workspace.close`. */
  id: string
  /** The words a menu, a tooltip and the palette show. */
  title: string
  /** The key sheet's section that lists it: `Threads`, `Panes`. */
  section: string
  /** The keys that run it: its own, then the Person's (`keys.toml`). */
  keys?: readonly Key[]
  /** The family it is one of, as the key sheet folds them: the
   * family's title, `Focus a Pane` for left, right, up and down. */
  family?: string
  /** Its key works while a dialog is open, as the Banda menu's own do;
   * any other key there is the dialog's. */
  overDialogs?: true
  run: (context: Context, args?: Args) => void
}

export type Module = {
  /**
   * The module's one id: its engine module's name, its `module.toml`'s
   * id, and the first word of its Panes' kinds (ADR 0022, decision 5).
   */
  id: string
  /**
   * Whether the engine runs a part of it. Its Panes and Watches then show
   * only while the engine runs it; a module with no engine part, as the
   * browser, is always on.
   */
  engine: boolean
  /** Its kinds of Pane, in the order the launcher offers them. */
  panes: readonly AnyPaneKind[]
  /** What it tells the bar and the sidebar about each Space. */
  watches: readonly Watch[]
  /** What the Person can do with it, by a key or the Banda menu. */
  actions: readonly Action[]
}

/** Declares a module's window part; each Pane keeps its args' type. */
export function defineModule<const P extends readonly Args[]>(module: {
  id: string
  engine: boolean
  panes?: { readonly [K in keyof P]: PaneKind<P[K]> }
  watches?: readonly Watch[]
  actions?: readonly Action[]
}): Module {
  return {
    id: module.id,
    engine: module.engine,
    // Each kind checks its own args; the window hands it only the args it
    // kept for it.
    panes: (module.panes ?? []) as unknown as readonly AnyPaneKind[],
    watches: module.watches ?? [],
    actions: module.actions ?? [],
  }
}
