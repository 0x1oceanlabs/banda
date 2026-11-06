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
import type { MarkState } from "./components/banda-mark"
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
 * right, below it in its column, in its own place, or in its Group, in
 * the Deck right of it, as what a Thread opens goes; or last on its
 * Project's workspace, as an Agent's Thread does (ADR 0065). Left out, the
 * window shows the Pane where its workspace shows one of its kind, or to
 * the right.
 */
export type Place = "right" | "below" | "here" | "group" | "project"

/**
 * What a Pane draws. A part of it that keeps its own Esc, as a list of
 * suggestions, stops the press there: what holds the Pane, as the drawer,
 * takes an Esc that comes out of it as its own, and a text field's always
 * has its default prevented.
 */
/** What a Pane says it shows now (`PaneProps.label`). */
export type Label = { title: string; detail: string | null }

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
   * Pane already shown gets the focus instead, unless it opens `here`.
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
   * a Project picker. None where no window runs actions, as in a dialog of
   * the settings. */
  run?: (action: string, args?: { [key: string]: JsonValue }) => void
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
   * to another column or workspace, has not left.
   */
  closed?: (left: { engine: Engine; project: ProjectId; args: A }) => void
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
 * What a module's work in one Project calls its Person for: the loudest
 * state, as Banda's mark shows it, and how many things wait for the Person
 * to act. The bar shows the loudest of every Project's.
 */
export type Attention = { mark: MarkState; waiting: number }

/** Nothing calls for the Person. */
export const QUIET: Attention = { mark: "rest", waiting: 0 }

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
  /** The Agent that works in it, as a Thread's own: what it opens, as a
   * tab, opens beside its Pane (ADR 0029, decision 4). */
  agent?: string
  /** The Agent whose Thread it is about, when another module lists it:
   * the sidebar draws it on that Thread's row, not on a row of its own,
   * and the window tells its Person of it as of any (ADR 0029, decision
   * 6). */
  on?: string
  /** What a click on it opens. */
  pane: PaneState
  /** Its latest snooze (ADR 0074): the sidebar puts it away while it
   * sleeps. */
  snooze?: ListedSnooze
}

/**
 * A Thread put away until a time, or until its turn ends, as its module
 * keeps it (ADR 0074). It sleeps until `until`, unless `woke` says what
 * woke it first.
 */
export type ListedSnooze = {
  /** When it was snoozed, in ms since the epoch. */
  at: number
  /** When it wakes; none: when its turn ends. */
  until?: number
  /** Its own Agent snoozed it, not its Person. */
  byAgent?: boolean
  /** What woke it before its time, and when. */
  woke?: {
    at: number
    by: "question" | "failure" | "message" | "done" | "woken"
  }
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
  /** What answering the call opens. */
  pane: PaneState
  /** When it last changed, in ms since the epoch. */
  since: number
}

/** The marks that call for the Person, and their calls. */
const CHIMES: Partial<Record<MarkState, Chime>> = {
  done: "done",
  asking: "asking",
  failed: "failed",
}

/** Whether `listed` sleeps at `now`: nothing woke it, and its time has
 * not come (ADR 0074). */
export function asleep(listed: Listed, now: number): boolean {
  const { snooze } = listed
  if (!snooze || snooze.woke) return false
  return snooze.until === undefined || snooze.until > now
}

/** The things in the lists that call their Person now. One snoozed calls
 * no one while it sleeps (ADR 0074). */
export function callsOf(lists: Lists, now = Date.now()): Call[] {
  return Object.entries(lists).flatMap(([project, listed]) =>
    (listed ?? []).flatMap((thing): Call[] => {
      const chime = CHIMES[thing.mark]
      if (!chime || asleep(thing, now)) return []
      const detail = thing.calls ?? thing.said
      return [
        {
          key: `${project}:${thing.id}`,
          project: project as ProjectId,
          about: thing.id,
          chime,
          title: thing.title,
          ...(detail ? { detail } : {}),
          pane: thing.pane,
          since: thing.changed,
        },
      ]
    })
  )
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

/** What a Watch says about one Project: what calls the Person, and its list. */
export type Report = Attention & { listed: readonly Listed[] }

export type WatchProps = {
  engine: Engine
  project: ProjectId
  /**
   * Says what the Project calls for now and lists; called on each change,
   * first once the module has read its list. What calls in the first
   * report already was, and is no news (ADR 0011, decision 6).
   */
  report: (report: Report) => void
}

/**
 * How a module tells the window what its work in a Project calls the Person
 * for and what the sidebar lists, while none of its Panes may show. The
 * window draws one per Project for as long as the engine runs the module; it
 * draws nothing itself.
 */
export type Watch = {
  Watch: ComponentType<WatchProps>
}
