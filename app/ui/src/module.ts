/**
 * A module's window part, as it declares itself (ADR 0022, decision 1):
 * its one id, and what it offers the window. The window builds its
 * registries from these and names the modules in one list alone; what a
 * module's engine part offers, its `methods!` table says.
 */
import type { JsonValue } from "@banda/contract"
import type { PaneKind, Watch } from "./pane"

type Args = { [key: string]: JsonValue }

/** What a registry holds of a kind of Pane: its args' type forgotten. */
export type AnyPaneKind = PaneKind<Args>

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
}

/** Declares a module's window part; each Pane keeps its args' type. */
export function defineModule<const P extends readonly Args[]>(module: {
  id: string
  engine: boolean
  panes?: { readonly [K in keyof P]: PaneKind<P[K]> }
  watches?: readonly Watch[]
}): Module {
  return {
    id: module.id,
    engine: module.engine,
    // Each kind checks its own args; the window hands it only the args it
    // kept for it.
    panes: (module.panes ?? []) as unknown as readonly AnyPaneKind[],
    watches: module.watches ?? [],
  }
}
