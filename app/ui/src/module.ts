/**
 * A module's window part, as it declares itself (ADR 0022, decision 1):
 * its one id, and what it offers the window. The window builds its
 * registries from these and names the modules in one list alone; what a
 * module's engine part offers, its `methods!` table says.
 */
import type { ComponentType, ReactNode } from "react"
import type { Engine, JsonValue, SpaceId, SpaceSummary } from "@banda/contract"
import type { Key } from "./lib/keys"
import type { Lists, PaneKind, PaneState, Watch } from "./pane"

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
  /** Shows a new Pane right of the focused one, with its width, and
   * focuses it: in `space`, else in the focused Pane's Space. It is a new
   * tile each time, as a browser's new window, even when another shows
   * the same Pane. With `focus: false` the focus stays where it is, as
   * for a tab an Agent opened. With `beside`, an Agent's ID, it shows
   * right of the Pane of the thing that Agent works in, where a
   * workspace shows one (`beside`).
   */
  open: (
    pane: PaneState,
    space?: SpaceId,
    how?: { focus?: boolean; beside?: string }
  ) => void
  /** Where the thing `agent` works in is, as a Thread its Agent's (ADR
   * 0029, decision 4); none when no module lists one. */
  beside: (agent: string) => Beside | null
  /** What every module lists now, as the sidebar shows it (ADR 0008). */
  lists: () => Lists
  /** Calls `listener` on each change of `lists`; returns how to stop. */
  watchLists: (listener: () => void) => () => void
  /** Runs an action by its id, a module's or the window's, as its key
   * would: how one module asks another for what it does. */
  run: (action: string, args?: Args) => void
}

/** What `WindowApi.beside` finds: the thing's Space, and the Panes of
 * the column right of its Pane, from the top; none when no workspace
 * shows its Pane. */
export type Beside = {
  space: SpaceId
  right: readonly PaneState[] | null
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
  /** What its key runs instead while held down, repeating, by id: an
   * arrow that goes on past an edge stops there until pressed again. */
  whenHeld?: string
  /** Run by its id alone, with the args another module gives: the Banda
   * menu and its key sheet leave it out. */
  unlisted?: true
  run: (context: Context, args?: Args) => void
}

/** One thing `Tab` lists for a row of the Banda menu. Its `key` there,
 * as `Enter` for the row's first, does it too. */
export type MenuAct = {
  title: string
  key?: Key
  run: (window: WindowApi) => void
}

/** A row a module's source gives the Banda menu (ADR 0022, decision 4). */
export type MenuRow = {
  /** Dotted, its module's id first (`agents.file.<space>.<path>`): what
   * the menu counts as chosen often and lately. */
  id: string
  title: string
  /** After the title, dimmer: where it is, what it is on. */
  detail?: string
  /** Before the title. */
  icon?: ReactNode
  /** What `Enter` does. */
  run: (window: WindowApi) => void
  /** What `Tab` lists: what `Enter` does among them, if it says so. */
  acts?: readonly MenuAct[]
}

/** Where the Banda menu looks: the focused Space, or the one the Person
 * went into (`entered`). */
export type Here = {
  engine: Engine
  space: SpaceId
  /** The Space's folder, where it has one. */
  folder?: string
  entered: boolean
}

export type FindProps = {
  /** What the Person typed, trimmed. */
  words: string
  here: Here
  /** Says the rows that fit, now or later; each call replaces the last.
   * Said in a layout effect, they show with the words they fit. */
  found: (rows: readonly MenuRow[]) => void
}

/**
 * Where the Banda menu finds a module's rows (ADR 0022, decision 4), as
 * a Watch: the window draws its `Find` while the menu may show it and
 * the engine runs the module. The menu keeps what is its own: the field,
 * the keys, the groups' order and the ranking.
 */
export type Source = {
  /** Dotted, its module's id first: `agents.files`. */
  id: string
  /** The heading its rows go under; none for the rows after every group,
   * as New Thread with the words. */
  label: string
  Find: ComponentType<FindProps>
}

/** What the window gives a widget on the bar, as it gives a Watch. */
export type WidgetProps = {
  engine: Engine
  spaces: readonly SpaceSummary[]
  /** The focused Pane's Space. */
  space: SpaceId
  window: WindowApi
}

/**
 * A module's item on the bar (ADR 0024, decision 3): an icon, maybe a
 * number, in the bar's muted text. It draws nothing while it has nothing
 * to say. Where it stands is the look's `[bar]`.
 */
export type Widget = {
  /** Unique, its module's id first: `harnesses.limits`. */
  id: string
  Widget: ComponentType<WidgetProps>
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
  /** What it gives the Banda menu to find. */
  sources: readonly Source[]
  /** What it shows on the bar, where the look's `[bar]` puts it. */
  bar: readonly Widget[]
  /**
   * Runs once the window is up, with what a module may ask of it; what
   * it returns runs when the window goes. How a module that hears the
   * desktop acts on the window, as the browser opens a Pane for a tab an
   * Agent asked for when none shows one.
   */
  start?: (window: WindowApi) => () => void
}

/** Declares a module's window part; each Pane keeps its args' type. */
export function defineModule<const P extends readonly Args[]>(module: {
  id: string
  engine: boolean
  panes?: { readonly [K in keyof P]: PaneKind<P[K]> }
  watches?: readonly Watch[]
  actions?: readonly Action[]
  sources?: readonly Source[]
  bar?: readonly Widget[]
  start?: (window: WindowApi) => () => void
}): Module {
  return {
    id: module.id,
    engine: module.engine,
    // Each kind checks its own args; the window hands it only the args it
    // kept for it.
    panes: (module.panes ?? []) as unknown as readonly AnyPaneKind[],
    watches: module.watches ?? [],
    actions: module.actions ?? [],
    sources: module.sources ?? [],
    bar: module.bar ?? [],
    start: module.start,
  }
}
