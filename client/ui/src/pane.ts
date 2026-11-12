/**
 * The Pane contract. A Pane is one tile of a workspace: the window places,
 * sizes and focuses it; the Pane shows one thing of one Project and reaches
 * the engine only through the API (docs/architecture.md, "Modules").
 *
 * A module offers its Panes as {@link PaneKind}s, and the window's registry
 * lists them. A Pane's `args` are its own small state; the window keeps
 * them with its workspaces, so a Pane comes back as it was.
 */
import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import type { Engine, JsonValue, ProjectId } from "@banda/contract"
import type { ChangedLines, Doing } from "@banda/contract/agents"
import {
  type Device,
  paneHost,
  type PaneState,
  type Place,
  type ProjectFile,
} from "@banda/core"
import type { MarkState } from "./components/banda-mark"
import type { Chip } from "./module"
import type { Chime } from "./sound/families"

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

/** Calls `take` with the place that holds a page in the layer as the page
 * takes the keys. It takes them as an iframe does, with no focus event of
 * its own: the focus leaves for it, or the window blurs as it takes it.
 * Returns what stops it. */
export function onPage(take: (holder: Element) => void): () => void {
  const reach = (element: Element | null) => {
    const holder = holderOf(element)
    if (holder) take(holder)
  }
  const onLeave = (event: FocusEvent) =>
    reach(event.relatedTarget instanceof Element ? event.relatedTarget : null)
  const onBlur = () => reach(document.activeElement)
  document.addEventListener("focusout", onLeave, true)
  window.addEventListener("blur", onBlur)
  return () => {
    document.removeEventListener("focusout", onLeave, true)
    window.removeEventListener("blur", onBlur)
  }
}

/** The focused Pane's tile, which the window marks `data-focused`; while
 * the Sheet shows, the Sheet, which has the keys (ADR 0102, decision 5).
 * Each workspace keeps a tile focused: the one live, not `inert`, as a
 * workspace out of view is, is the one the focus can go to. */
export function focusedTile(): HTMLElement | null {
  const tiles = document.querySelectorAll<HTMLElement>(
    "[data-tile][data-focused=true]"
  )
  return (
    document.querySelector<HTMLElement>("[data-sheet]") ??
    [...tiles].find((tile) => !tile.closest("[inert]")) ??
    null
  )
}

/** Whether `element` is in `tile`, or in the layer and held by it. */
export function within(tile: Element, element: Element | null): boolean {
  return (
    element != null &&
    (tile.contains(element) || tile.contains(holderOf(element)))
  )
}

/** What one tile shows, the host an arrangement written before named for
 * a Pane, and where a Pane opens: the core's (ADR 0089), named here too
 * for the modules that take them from here, until L3 splits this
 * package. No App writes a Pane's host: the directory says which machine
 * has each Project (ADR 0106, decision 1). */
export { paneHost, type PaneState, type Place }

/** Whether something runs from a Pane, as the router answers it (ADR
 * 0106, law 6): it does, or why not, in the Person's words, "Not on arc
 * yet". */
export type Runs = { runs: true } | { runs: false; why: string }

/**
 * What a Pane draws. A part of it that keeps its own Esc, as a list of
 * suggestions, stops the press there: what holds the Pane, as the drawer,
 * takes an Esc that comes out of it as its own, and a text field's always
 * has its default prevented.
 */
/** What a Pane says it shows now (`PaneProps.label`). */
export type Label = {
  title: string
  detail: string | null
  /** Its file has work not saved yet, a dot by the title; or was saved a
   * moment ago, a quiet "Saved" (ADR 0073, decision 8). */
  edits?: "unsaved" | "saved"
}

export type PaneProps<A> = {
  engine: Engine
  project: ProjectId
  args: A
  /** Whether this tile has the focus: keys go to it. */
  focused: boolean
  /** Looks selected while the overview owns the keys; defaults to focused. */
  selected?: boolean
  /**
   * Opens a Pane of this Pane's Project, or of `project` when it is given; a
   * Pane already shown only gets the focus, unless it opens `instead` of
   * the opener.
   */
  open: (pane: PaneState, place?: Place, project?: ProjectId) => void
  /** Keeps new args for this Pane. */
  update: (args: A) => void
  /** Closes this Pane, as one that finished its job does. */
  close: () => void
  /**
   * Says what the Pane shows now, for its header, tabs and the overview,
   * over its kind's title and detail; `null` takes them back. Kept while
   * the window runs, not in its layout: a terminal's title changes as
   * often as what runs in it. None where nothing names the Pane, as in a
   * dialog of the settings.
   */
  label?: (label: Label | null) => void
  /** Runs an action by its id, as `WindowApi.run` does: "Add Project" from
   * a Project picker. None where no window runs actions, as in a test of a
   * part; a dialog of the settings runs only what it says it does. */
  run?: (action: string, args?: { [key: string]: JsonValue }) => void
  /**
   * Whether an action runs from this Pane, as `run` would run it with
   * `args`, or a Pane opens from it: the router asks whether the act's
   * App is on the owner's machine and its values can go there (ADR 0106,
   * law 6). A Pane asks what can run, never where it is. None where no
   * window routes, as in a dialog of the settings: then everything does.
   */
  runs?: (what: string | PaneState, args?: { [key: string]: JsonValue }) => Runs
  /** The device the Person is at (ADR 0106, law 1): what it can do, and
   * whether a file is one of this computer's. None where no window gives
   * it. */
  device?: Device
  /** The file at `path`, stamped with this Pane's Project (ADR 0106, law
   * 2): what a file crosses a boundary as, to a drag, the clipboard, the
   * Message box. None where no window gives it. */
  file?: (path: string) => ProjectFile
  /**
   * Says the Pane has a composer, and how it takes what an App puts in a
   * message (`WindowApi.attach`); `null` takes it back. A Thread says so.
   * None where nothing attaches, as in a dialog of the settings.
   */
  composer?: (take: ((chips: readonly Chip[]) => void) | null) => void
  /**
   * It is drawn in the tile that floats over the desk (`WindowApi.peek`),
   * in no workspace: the focus stays where it was, and the tile opens it
   * as a Pane of its own. Quick Look is `files.file` drawn so (ADR 0073,
   * decision 7).
   */
  peek?: boolean
  /**
   * Nothing can be drawn beside this Pane now, so what it would open beside
   * itself, it shows over itself (ADR 0103, decision 21): a narrow window,
   * which hides the sidebar, the drawer, and Quick Look. A Thread shows its
   * sub-agent as a screen on top. None, or false, where a Pane can open
   * beside it.
   */
  alone?: boolean
}

export type PaneKind<A extends { [key: string]: JsonValue }> = {
  /** Unique, with its module's id first: `agents.thread`. The window
   * hides it while the engine does not run that module (`Module`). */
  kind: string
  /** The words in its header. */
  title: (args: A) => string
  /** Quieter words after the title in its header, as a terminal's folder. */
  detail?: (args: A) => string | null
  icon: LucideIcon
  /** When set, a Person can open the Pane from the menu with these args. */
  start?: A
  /** The letter that opens it from the launcher, after Alt+N (ADR 0025,
   * decision 4): `T`. */
  letter?: string
  /** A list that sits beside other Panes: it opens a third of the screen wide. */
  narrow?: boolean
  /** Whether it opens last on its Project's workspace, as an Agent's Thread
   * does where `agents.toml` says so (ADR 0065, decision 9). */
  home?: () => boolean
  /** Whether it opens as a Group of its own when no Group takes it in, as
   * an Agent's Thread does, so the Panes its Agent opens join a Group
   * already there (ADR 0065, decision 7). The engine reads it too, from its
   * App's `window.json`. */
  grouped?: true
  /** It opens for a Project of another host of `hosts.toml` too, on that
   * host's engine, which it reaches only through the API, as a Thread
   * does (ADR 0081, decision 4). Another kind there says it is not on
   * that host yet: it would reach this machine's files. */
  elsewhere?: true
  /** It comes as the Sheet, in from the right edge over the tiles, not as
   * a tile, as Settings and Usage do (ADR 0102, decision 5). */
  sheet?: true
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
   * What makes it this one Pane where its args also hold what changes as
   * it is used, as a Diff's scope: one Diff per Project. Args that change
   * but keep it are the same Pane, which has not left (`closed`). All its
   * args, by default.
   */
  identity?: (args: A) => JsonValue
  /**
   * What its module lets go of once the Pane leaves every workspace: it
   * closed, or its place shows another Pane or the same with other args. A
   * program in a terminal stops then. A Pane drawn again, as when it moves
   * to another column or workspace, has not left. What it answers, its
   * act, the Window watches: one its machine could not hear, as it was
   * away, waits for that machine and goes once it is back (ADR 0106,
   * decision 4).
   */
  closed?: (left: {
    engine: Engine
    project: ProjectId
    args: A
  }) => Promise<unknown> | void
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
 * What the Threads call their Person for, all together: the loudest
 * state, as Banda's mark shows it, and how many are the Person's turn.
 * The bar shows it (`status.ts`, `attentionOf`).
 */
export type Attention = { mark: MarkState; waiting: number }

/** Nothing calls for the Person. */
export const QUIET: Attention = { mark: "rest", waiting: 0 }

/** What a failed turn calls with when its Harness gave no reason: a card
 * then says only "Failed". */
export const NO_REASON = "The turn failed"

/**
 * One thing a module lists in the sidebar for a Project: a Thread, for the
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
  /** What the work that runs now does, and since when (ADR 0099,
   * decision 11): a tool call of its kind and what it works on, a
   * thought, or its reply. None while none runs. */
  doing?: Doing
  /** When the work that runs now last said anything, in milliseconds
   * since the epoch: long ago, it is stuck. */
  stepped?: number
  /** Its Harness compacts the context now. */
  compacting?: true
  /** When a usage limit the work that runs now waits on lets it go on,
   * in milliseconds since the epoch. */
  limitUntil?: number
  /** How many lines its last work that ended added and removed in files,
   * which its card shows as "+38 −9" (ADR 0098, decision 8). None when
   * that work changed no line. */
  changedLines?: ChangedLines
  /** Its direct sub-agents while it works (ADR 0103, decisions 13 and
   * 32): how many work and how many failed since its turn began, the
   * Mark's satellites, and what its card's line 2 says of those at work,
   * "3 sub-agents at work". */
  subagents?: ListedSubagents
  /** Its Crew at work, the latest started (ADR 0103, step 4): its title,
   * the phase it is in, and how many of that phase's agents are done of
   * those called so far. None while no Crew of it works. */
  crew?: ListedCrew
  /**
   * What calls the Person, in a few words: what it asks, why it failed.
   * A toast or a system notification says it too.
   */
  calls?: string
  /** What names the sub-agent whose Question calls, its first one's (ADR
   * 0103, decision 33); none for the Agent's own. */
  asker?: string
  /** What it was last asked to do; its first line shows when nothing calls. */
  said?: string
  /** Who does the work: a Harness's name. */
  by?: string
  /** That Harness's id, which picks its logo where Banda has one. */
  harness?: string
  /** The Agent that works in it, as a Thread's own: what it opens, as a
   * tab, opens beside its Pane (ADR 0029, decision 4). */
  agent?: string
  /** The Thread whose Agent started it through Banda, by its id: it is
   * that Thread's child (ADR 0098, decision 24). None for one its Person
   * started, and for a fork. */
  parent?: string
  /** The Agent whose Thread it is about, when another module lists it:
   * the sidebar draws it on that Thread's row, not on a row of its own,
   * and the window tells its Person of it as of any (ADR 0029, decision
   * 6). */
  on?: string
  /** Its title before the Person last renamed it, which "Previous title"
   * brings back (ADR 0077); none before a rename. */
  was?: string
  /** Whether the Person has seen what it last finished: false while that
   * calls them, true once seen, which "Mark as unread" takes back (ADR
   * 0077, decision 6). None while it has nothing finished to see. */
  seen?: boolean
  /** The Person archived it, as its host keeps the mark (ADR 0096): it
   * neither works nor asks, and nothing happened in it since. Archive's
   * shelf holds it. */
  archived?: true
  /** When its Person archived it, by its host's clock as `changed` is:
   * the Archive counts from it (ADR 0098, decision 5). */
  archivedAt?: number
  /** What a click on it opens. */
  pane: PaneState
  /** The other machine of `hosts.toml` that lists it, by its key, as the
   * Window marks what each machine lists (ADR 0081, decision 4); none for
   * this machine's. Its App never says it. What opens it, or acts on it,
   * goes to its Project's machine by its Project alone (ADR 0106,
   * decision 1); a notice and the Banda menu name that machine by it (ADR
   * 0095, decision 8). */
  host?: string
  /** Its latest Later (ADR 0074): the sidebar puts it away while it
   * sleeps. */
  later?: ListedLater
  /**
   * What answers its call there and then, as buttons on its toast (ADR
   * 0056, decision 3): each an action by its id and args, Allow and Deny
   * of a Question, Try again of a failed turn.
   */
  answers?: readonly Answering[]
}

/** One way to answer a call: an action, by its id, with its args. */
export type Answering = {
  label: string
  action: string
  args?: { [key: string]: JsonValue }
}

/**
 * A Thread put away until a time, until its turn ends, or Someday, as its
 * module keeps it (ADR 0074; ADR 0098, decision 12). It sleeps until
 * `until`, unless `woke` says what woke it first.
 */
/** A listed Thread's direct sub-agents (`Listed.subagents`). */
export type ListedSubagents = { working: number; failed: number; said?: string }

/** A listed Thread's Crew at work (`Listed.crew`). */
export type ListedCrew = {
  title: string
  phase: string
  done: number
  of: number
}

export type ListedLater = {
  /** When it was put off, in ms since the epoch. */
  at: number
  /** When it wakes; none: when its turn ends, or never by itself with
   * `someday`. */
  until?: number
  /** Put off with no time: it sleeps until something wakes it (ADR 0098, decision 12). */
  someday?: true
  /** Its own Agent put it off, not its Person. */
  byAgent?: boolean
  /** What woke it, and when: its time, or what came first. */
  woke?: {
    at: number
    by: "question" | "failure" | "message" | "done" | "woken" | "time"
  }
  /** Its Person saw it wake by itself, as its host keeps the mark. */
  wokeSeen?: true
}

/** What every module lists for each Project, for the sidebar. */
export type Lists = Readonly<Record<ProjectId, readonly Listed[]>>

/**
 * One thing that calls its Person now, as the lists say it (ADR 0011):
 * of a Project, by a key that stays the thing's.
 */
export type Call = {
  /** `project:about`, one per thing. */
  key: string
  project: ProjectId
  /** The thing, as its Pane names it (`PaneKind.shows`). */
  about: string
  chime: Chime
  title: string
  /** What it said, in a line: what it asks, why it failed, its task. */
  detail?: string
  /** What names the sub-agent that asks (`Listed.asker`). */
  asker?: string
  /** What answering the call opens. */
  pane: PaneState
  /** The other machine it is on, by its key in `hosts.toml`, as the Window
   * marked it (`Listed.host`); none for this machine's. */
  host?: string
  /** When it last changed, in ms since the epoch. */
  since: number
  /** What answers it there and then (`Listed.answers`). */
  answers?: readonly Answering[]
}

/** The thing `agent` works in, as a Thread its Agent's, and its Project;
 * none when no module lists one. */
export function listedOf(
  lists: Lists,
  agent: string
): { project: ProjectId; listed: Listed } | null {
  for (const [project, listed] of Object.entries(lists)) {
    const found = listed.find((each) => each.agent === agent)
    if (found) return { project: project as ProjectId, listed: found }
  }
  return null
}

/** What a Watch says about one Project: its list, from which the window
 * reads what calls the Person (`status.ts`). */
export type Report = { listed: readonly Listed[] }

export type WatchProps = {
  engine: Engine
  project: ProjectId
  /** The other host of `hosts.toml` whose engine it is, by its name
   * (ADR 0081, decision 4); none for this machine's. */
  host?: string
  /**
   * Says what the Project lists now; called on each change, first once
   * the module has read its list. What calls in the first
   * report already was, and is no news (ADR 0011, decision 6).
   */
  report: (report: Report) => void
}

/**
 * How a module tells the window what the sidebar lists of its work in a
 * Project, and so what calls the Person, while none of its Panes may show. The
 * window draws one per Project for as long as the engine runs the module; it
 * draws nothing itself.
 */
export type Watch = {
  Watch: ComponentType<WatchProps>
}
