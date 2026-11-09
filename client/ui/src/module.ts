/**
 * A module's window part, as it declares itself (ADR 0022, decision 1):
 * its one id, and what it offers the window. The window builds its
 * registries from these and names the modules in one list alone; what a
 * module's engine part offers, its `methods!` table says.
 */
import type { ComponentType, ReactNode } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Args, HereStore, Readable } from "@banda/core"
import type { Key } from "./lib/keys"
import { ZOOM_KEYS, zoomId } from "./lib/zoom"
import type { Notify } from "@banda/contract/look"
import type { Listed, Lists, PaneKind, PaneState, Watch } from "./pane"
import type { SoundSettings } from "./sound/settings"
import type { Filler } from "./slots"
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
 * Pane, with the window in front; on the window, its Pane on screen, at
 * least half of its Tile in view (ADR 0087, decision 9), or not; or
 * elsewhere.
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
 * core's (ADR 0089), named here too for the modules that take it from
 * here, until L3 splits this package. */
export type { Args }

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
   * names. With `toggle`, the Pane in focus closes instead when it is
   * this one, as its kind names it: Mod+D's Diff. One whose kind says
   * `home` opens on its Project's workspace (ADR 0065). With `drawer` it
   * is the drawer's Pane instead, dropped, in place of any the drawer
   * held (ADR 0025, decision 8).
   */
  open: (
    pane: PaneState,
    project?: ProjectId,
    how?: {
      focus?: boolean
      beside?: string
      again?: false
      update?: true
      toggle?: true
      drawer?: true
    }
  ) => void
  /** Here (ADR 0087, decision 4): where the Person is in this Window. An
   * act reads it as it runs (`here.get()`), the Tiling's last change in
   * it, so keys pressed faster than the window draws each act where the
   * last one left the Person; what runs outside React follows it. A
   * widget reads it by selector (`useHere`). */
  here: HereStore
  /** Where the thing `agent` works in is, as a Thread its Agent's (ADR
   * 0029, decision 4); none when no module lists one. */
  beside: (agent: string) => Beside | null
  /** What every module lists now, as the sidebar shows it (ADR 0008):
   * the Window's items (ADR 0088, decision 7), for what runs outside
   * React. Its listeners hear each change, and a snoozed Thread waking,
   * which changes what calls (ADR 0074). */
  items: Readable<Lists>
  /** Runs an action by its id, a module's or the window's, as its key
   * would: how one module asks another for what it does, and how it goes
   * to a Pane, by the Window's `pane.pick` (ADR 0087, decision 7). */
  run: (action: string, args?: Args) => void
  /** The engine a Project is on, or `pane` of it, which may name its host
   * (ADR 0081): its host's, never this machine's in its place, else this
   * machine's. The hosts router's answer for an App's own commands, as an
   * item action's on an Item another host lists; H5's `sessionOf`, given
   * the Pane until the router knows every host's Projects. */
  sessionOf: (project: ProjectId, pane?: PaneState) => Engine
  /** Where the Person looks for `thing` (ADR 0056, decision 1), as the
   * calls part works it out (`sightOf`): from Here and what the Tiles of
   * the workspace on screen show, measured as it is asked (ADR 0087,
   * decision 9); for none, whether at the Window or away. Only for the
   * part that tells the Person, a counted case until who is told moves
   * to the host (E9): any other part reads Here. */
  sight: (thing?: Thing) => Sight
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
    [name: string]: {
      type: "string" | "number" | "boolean"
      description: string
    }
  }
  required?: readonly string[]
  additionalProperties: false
}

/** What one arg is: a string, by what it says; else a number, or a flag,
 * true or false. */
type Takes = string | { number: string } | { flag: string }

/** An action's args (ADR 0071, decision 2): each by its name and what it
 * is, a string unless it says it is a number or a flag; `required` it
 * must have. */
export function takes(
  properties: { [name: string]: Takes },
  required?: readonly string[]
): ArgsSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, about]) => [
        name,
        typeof about === "string"
          ? { type: "string", description: about }
          : "number" in about
            ? { type: "number", description: about.number }
            : { type: "boolean", description: about.flag },
      ])
    ),
    ...(required && { required }),
    additionalProperties: false,
  }
}

/**
 * An action that takes one Item (ADR 0087, decision 12), as renaming or
 * snoozing a Thread: its App's, or Banda's own, as archiving it. Its args
 * name the Item by its `project` and its id, `item`; with none, it takes
 * the one the Pane in focus shows (`itemOf`). The Thread menu lists the
 * row of each that applies, the App's first, at a Thread's title and at
 * its row; the Pane menu and the Banda menu's Tab list those offered
 * there. Its owner is found by the first word of its Item's Pane kind
 * (ADR 0022, decision 5).
 */
export type ItemAction<Context = WindowApi> = Action<Context> & {
  /** Where the Thread menu lists it: with the rows that name the Item, or
   * after them. */
  group: "name" | "other"
  /** Its row for `item`, as it stands `at`; none where it does not apply
   * now. */
  row: (item: Listed, at: ItemAt) => ItemRow | null
  /** What Banda's own parts ask it for, as the title's field asks to
   * rename, and the snooze's picker to snooze: a stand-in for the intents
   * that take its place with B8 (#862), counted till then. The Banda
   * menu's recents count its rows by it. */
  does?: "rename" | "suggest" | "snooze" | "wake" | "archive"
  /** Where else its row is: the Pane menu, the Banda menu's Tab. Those
   * leave out a row that is off. */
  offered?: readonly ("pane" | "menu")[]
  /** It runs once the menu has gone, as what takes the focus must: a
   * field, a picker. */
  later?: true
  /** A Pane on another host runs it too (ADR 0081): it goes to its Item's
   * host. */
  elsewhere?: true
  /** Its args name the Item: `project` and `item`, then its own. */
  args: ArgsSchema
}

/** How an item action shows in a menu, for one Item. */
export type ItemRow = {
  title: string
  icon: ComponentType<{ className?: string }>
  /** There, but off, as Snooze for a Thread that asks. */
  off?: true
}

/** What the Window knows of an Item besides what its App lists, as a menu
 * shows its rows. */
export type ItemAt = {
  /** Its Project, where this machine has it. */
  project?: ProjectSummary
  /** The clock the menu reads it by. */
  now: number
  /** The Person archived it (ADR 0069). */
  archived: boolean
}

/** What an item action takes: its Item, as `itemOf` reads it, and
 * `more` of its own. */
export function itemArgs(more: { [name: string]: Takes } = {}): ArgsSchema {
  return takes({
    project: "the Project of the Item it acts on",
    item: "the Item's id in its Project, as a Thread's; none for the one in focus",
    ...more,
  })
}

/**
 * The Item `args` name, as a list holds it: by its `project` and its id,
 * `item`; with no id, the one the Pane in focus shows (Here). None when
 * no list holds it.
 */
export function itemOf(
  window: Pick<WindowApi, "here" | "items">,
  args?: Args
): { project: ProjectId; listed: Listed } | undefined {
  const named = args?.item
  const { pane } = window.here.get()
  const at =
    typeof named !== "string"
      ? pane?.subject && { project: pane.project, id: pane.subject }
      : typeof args?.project === "string"
        ? { project: args.project as ProjectId, id: named }
        : undefined
  if (!at) return undefined
  const listed = window.items.get()[at.project]?.find((one) => one.id === at.id)
  return listed && { project: at.project, listed }
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
 * they went into (`entered`). Not Here, where the Person is, which it
 * starts from. */
export type MenuAt = {
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
  at: MenuAt
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

/** What the window gives a widget on the bar, the same to each, the
 * window's own as a module's. Where the Person is, it reads from Here
 * (`useHere`); it acts by running an action (`useRun`), as a menu row
 * does. */
export type WidgetProps = {
  engine: Engine
  projects: readonly ProjectSummary[]
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
  /** It has a form that stays in a narrow Bar and in a phone's header
   * (ADR 0087, decision 11); a widget without it is reached there by its
   * action. Nothing reads it yet: the forms that do come with the phone
   * (W4). */
  compact?: true
}

export type Module = {
  /**
   * The module's one id: its engine module's name, its `app.toml`'s
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
  /** What it puts in the Slots of other Apps' things (ADR 0082, decision
   * 8): Git its rows in a Thread's details card, Threads a Thread's Mark
   * in its Pane's header. */
  slots: readonly Filler[]
  /** How it draws kinds of file, wherever a file is shown (ADR 0073,
   * decision 6). */
  previewers: readonly Previewer[]
  /** What the Person can do to one of the Items it lists (ADR 0087,
   * decision 12): its rows in the Thread menu, the Pane menu and the
   * Banda menu, in their order; actions all the same, by a key too. */
  items: readonly ItemAction[]
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
  slots?: readonly Filler[]
  previewers?: readonly Previewer[]
  items?: readonly ItemAction[]
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
    slots: module.slots ?? [],
    previewers: module.previewers ?? [],
    items: module.items ?? [],
    start: module.start,
  }
}
