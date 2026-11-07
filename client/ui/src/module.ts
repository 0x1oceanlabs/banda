/**
 * A module's window part, as it declares itself (ADR 0022, decision 1):
 * its one id, and what it offers the window. The window builds its
 * registries from these and names the modules in one list alone; what a
 * module's engine part offers, its `methods!` table says.
 */
import type { ComponentType, ReactNode } from "react"
import type {
  Engine,
  JsonValue,
  ProjectId,
  ProjectSummary,
} from "@banda/contract"
import type { Details } from "./components/thread-details"
import type { Key } from "./lib/keys"
import { ZOOM_KEYS, zoomId } from "./lib/zoom"
import type { Notify } from "@banda/contract/look"
import type { Lists, PaneKind, PaneState, Watch } from "./pane"
import type { SoundSettings } from "./sound/settings"
import { actInScope } from "./hooks/use-scope"

export {
  type Bytes,
  definePreviewer,
  type Magic,
  type Match,
  type PreviewFile,
  type Previewer,
  type PreviewProps,
} from "./previewer"
import type { Previewer } from "./previewer"

/**
 * Where the Person's eyes are, for a thing that calls (ADR 0011): on its
 * Pane, with the window in front; on the window, its Pane on screen or
 * not; or elsewhere.
 */
export type Sight = "looking" | "on-screen" | "in-window" | "away"

/** A thing, as a Pane shows it and the lists name it. */
export type Thing = { project: ProjectId; about: string }

/**
 * What an App puts into a Thread's message (ADR 0073, decision 14; ADR
 * 0034, decision 9): a file, as `@` names one; some of its lines; and the
 * Person's words on them. The composer writes the path from its Project's
 * folder when it is inside, as `@` does.
 */
export type Chip = {
  /** The file's whole path; a folder's ends with `/`. */
  path: string
  /** The lines it is about, the first and the last, from 1. */
  lines?: readonly [from: number, to: number]
  /** What the Person says of them. */
  comment?: string
  /** The lines as they read when picked, which the message quotes. */
  text?: string
}

/** A Pane's args, and what an action is run with besides the window: the
 * Banda menu's words, a Project. Plain data, as `keys.toml` and the CLI will
 * give it. */
export type Args = { [key: string]: JsonValue }

/** What a registry holds of a kind of Pane: its args' type forgotten. */
export type AnyPaneKind = PaneKind<Args>

/**
 * What a module's action may ask of the window (ADR 0022, decision 3).
 * What a module needs that this lacks is added here, not reached around.
 */
export type WindowApi = {
  /** The engine, as a module's action asks it: to answer a Question
   * from its toast. */
  engine: Engine
  /** The Project a new Thread starts in. */
  home: ProjectId
  /** Shows a new Pane right of the focused one, with its width, and
   * focuses it: in `project`, else in the Project the Person is in, the
   * focused Pane's or, on an empty workspace, the workspace's. It is a new
   * tile each time, as a browser's new window, even when another shows
   * the same Pane. With `focus: false` the focus stays where it is, as
   * for a tab an Agent opened. With `beside`, an Agent's ID, it shows
   * right of the Pane of the thing that Agent works in, where a
   * workspace shows one (`beside`). With `again: false` a Pane already
   * shown gets the focus instead, as a Pane's own `open`: one its kind
   * names the same (`PaneKind.identity`), as the Project's one Diff; with
   * `update` too, it shows these args, as a file's Pane the line a link
   * names. One whose kind says `home` opens on its Project's workspace
   * (ADR 0065).
   */
  open: (
    pane: PaneState,
    project?: ProjectId,
    how?: { focus?: boolean; beside?: string; again?: false; update?: true }
  ) => void
  /** The focused Pane and its Project, and the one thing it shows, as its
   * kind says (`PaneKind.shows`): a Thread's ID for a Thread. None while
   * no Pane has the focus. */
  focused: () => {
    project: ProjectId
    pane: PaneState
    shows?: string
  } | null
  /** Where the thing `agent` works in is, as a Thread its Agent's (ADR
   * 0029, decision 4); none when no module lists one. */
  beside: (agent: string) => Beside | null
  /** What every module lists now, as the sidebar shows it (ADR 0008). */
  lists: () => Lists
  /** Calls `listener` on each change of `lists`, and as a snoozed Thread
   * wakes, which changes what calls (ADR 0074); returns how to stop. */
  watchLists: (listener: () => void) => () => void
  /** Runs an action by its id, a module's or the window's, as its key
   * would: how one module asks another for what it does. */
  run: (action: string, args?: Args) => void
  /** Where the Person looks, for `thing` (ADR 0056, decision 1); for
   * none, whether at the window or away. */
  sight: (thing?: Thing) => Sight
  /** Calls `listener` when where the Person looks may have changed: the
   * workspaces, or the window in front or behind. Returns how to stop. */
  watchSight: (listener: () => void) => () => void
  /** Goes to `thing`: to the Pane that shows it, on any workspace, else
   * opens `pane` for it. */
  goTo: (thing: Thing & { pane: PaneState }) => void
  /** The Projects open in the window. */
  projects: () => readonly ProjectSummary[]
  /** How the look says to tell and to sound: `[notify]` and `[sound]`. */
  look: () => { notify: Notify; sound: SoundSettings }
  /** Sets `key` in the settings' file `file` (ADR 0016), as `limits.look`
   * in `harnesses.toml`, to `value`, written in TOML (`tomlOf`); what was
   * wrong, if refused. The file is the one source: what reads it hears
   * the change as any other. */
  writeSetting: (file: string, key: string, value: string) => Promise<string[]>
  /**
   * Puts `chips` into a Thread's message (ADR 0073, decision 14), and goes
   * to that Thread: the focused Pane's, if it has a composer; else the one
   * that had the focus last in the focused Pane's Project. With none, a
   * toast says so.
   */
  attach: (chips: Chip | readonly Chip[]) => void
  /**
   * Shows `pane` of `project` in a tile that floats over the desk and
   * leaves the tiling as it is (ADR 0073, decision 7): Quick Look, one per
   * window. A Pane of the same kind there already takes these args and is
   * not drawn again; the Pane is told it peeks (`PaneProps.peek`). Its tile
   * opens it in the workspace, and Esc closes it; `null` closes it too.
   */
  peek: (pane: PaneState | null, project?: ProjectId) => void
}

/** What `WindowApi.beside` finds: the thing's Project, and the Panes of
 * the column right of its Pane, from the top; none when no workspace
 * shows its Pane. */
export type Beside = {
  project: ProjectId
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
  /** Where its key works (ADR 0071, decision 1): a scope's id, as the
   * composer's; none for the window's, everywhere. `scoped` makes one. */
  scope?: string
  /** What it takes (ADR 0071, decision 2): what a line of keys.toml,
   * the key sheet and an Agent may give it, as a JSON Schema, as the
   * engine's tools give theirs; `takes` writes one. */
  args?: ArgsSchema
  /** Its key acts as the Person: it sends words to an Agent, or runs or
   * opens something outside Banda (ADR 0083, decision 3). Only the Person
   * binds it so: `true` whatever it is given, or the args that make it
   * so, as `thread.new`'s `ask`. */
  runsAsPerson?: true | readonly string[]
  /** Whether its key is its own now. While it is not, the key goes on to
   * the Pane, as `F2` to a terminal's program while no Thread has the
   * focus. Its key is always its own, by default. */
  when?: (context: Context) => boolean
  run: (context: Context, args?: Args) => void
}

/**
 * Where a key works besides the whole window (ADR 0071, decision 1): a
 * kind of Pane, or a field in one, where a key that types is the field's.
 * Its element is `useScope`'s.
 */
export type Scope = {
  id: string
  /** Its name in the key sheet: `Composer`. */
  title: string
  field?: true
  /** Its keys work with the mod still held too, when no key of the
   * window's takes the press: the launcher's letters after Alt+N (ADR
   * 0025, decision 4). */
  modHeld?: true
}

/** An action of a scope: its key works while the focus is in the scope,
 * whose element runs it (`useScope`); the Banda menu runs it there too. */
export function scoped(
  scope: string,
  action: Omit<Action, "scope" | "run">
): Action {
  return {
    ...action,
    scope,
    run: (_, args) => void actInScope(scope, action.id, args),
  }
}

/** A Pane's zoom as actions of its scope (ADR 0037, decision 6; ADR
 * 0071, decision 1): `prefix.zoom-in`, `-out` and `-reset`, Ctrl or ⌘
 * with + − 0, titled for `what`, as "the terminal". */
export function zoomActions(
  scope: string,
  prefix: string,
  what: string,
  section: string
): Action[] {
  return ZOOM_KEYS.map(({ does, title, keys }) =>
    scoped(scope, {
      id: zoomId(prefix, does),
      title: title(what),
      section,
      keys,
    })
  )
}

/** What an action takes, as a JSON Schema: each arg by its name. */
export type ArgsSchema = {
  type: "object"
  properties: {
    [name: string]: { type: "string" | "number"; description: string }
  }
  required?: readonly string[]
  additionalProperties: false
}

/** An action's args (ADR 0071, decision 2): each by its name and what it
 * is, a string unless it says it is a number; `required` it must have. */
export function takes(
  properties: { [name: string]: string | { number: string } },
  required?: readonly string[]
): ArgsSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, about]) => [
        name,
        typeof about === "string"
          ? { type: "string", description: about }
          : { type: "number", description: about.number },
      ])
    ),
    ...(required && { required }),
    additionalProperties: false,
  }
}

/**
 * How the window acts on a thing a module lists (ADR 0077, decision 5):
 * the Thread menu, at its title and at its row, is the window's, and the
 * thing is the module's. The window finds the module by the first word of
 * the thing's Pane kind (ADR 0022, decision 5).
 */
export type Listing = {
  /** Names the thing `title`; with none, gives back the title it had by
   * itself, as a Thread's first message's. Refused, it says why. */
  rename: (
    engine: Engine,
    project: ProjectId,
    id: string,
    title: string | null
  ) => Promise<void>
  /** A title for it, from what it says lately; renames nothing. */
  suggest?: (engine: Engine, project: ProjectId, id: string) => Promise<string>
  /** Takes back the Person's "seen" of what it last finished, or with
   * `false` gives it again (`Listed.seen`). */
  unread?: (id: string, unread: boolean) => void
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
  /** Dotted, its module's id first (`agents.file.<project>.<path>`): what
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

/** Where the Banda menu looks: the Project the Person is in, or the one
 * they went into (`entered`). */
export type Here = {
  engine: Engine
  project: ProjectId
  /** The Project's folder, where it has one. */
  folder?: string
  entered: boolean
  /** The source the menu shows alone, by its id, as quick open shows the
   * Project's files: it may show rows before any word is typed. */
  only?: string
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
  /** Dotted, its module's id first: `files.find`. */
  id: string
  /** The heading its rows go under; none for the rows after every group,
   * as New Thread with the words. */
  label: string
  Find: ComponentType<FindProps>
}

/** What the window gives a widget on the bar, as it gives a Watch. */
export type WidgetProps = {
  engine: Engine
  projects: readonly ProjectSummary[]
  /** The Project the Person is in: the focused Pane's, else the
   * workspace's, else home. */
  project: ProjectId
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
  /** What it shows, in a line, as `banda modules` and the skill say it:
   * how the Person tells which id to write in `[bar]`. */
  about: string
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
  /** What it tells the bar and the sidebar about each Project. */
  watches: readonly Watch[]
  /** What the Person can do with it, by a key or the Banda menu. */
  actions: readonly Action[]
  /** The scopes its actions' keys work in (ADR 0071, decision 1). */
  scopes: readonly Scope[]
  /** What it gives the Banda menu to find. */
  sources: readonly Source[]
  /** What it shows on the bar, where the look's `[bar]` puts it. */
  bar: readonly Widget[]
  /** Its rows in a Thread's details card (ADR 0034, decision 4). */
  threadDetails: readonly Details[]
  /** How it draws kinds of file, wherever a file is shown (ADR 0073,
   * decision 6). */
  previewers: readonly Previewer[]
  /** How the window renames, suggests a title for and marks unread a
   * thing it lists; none where it lists nothing so. */
  listed?: Listing
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
  scopes?: readonly Scope[]
  sources?: readonly Source[]
  bar?: readonly Widget[]
  threadDetails?: readonly Details[]
  previewers?: readonly Previewer[]
  listed?: Listing
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
    scopes: module.scopes ?? [],
    sources: module.sources ?? [],
    bar: module.bar ?? [],
    threadDetails: module.threadDetails ?? [],
    previewers: module.previewers ?? [],
    listed: module.listed,
    start: module.start,
  }
}
