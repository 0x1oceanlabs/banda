/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the modules' own and the window's (ADR 0022, decision 3). The keys,
 * the Banda menu, its key sheet and `keys.toml` read the same list.
 */
import type { SpaceId } from "@banda/contract"
import type { Action, Args, WindowApi } from "@banda/ui/module"
import { type PaneState, paneOf } from "@banda/ui/pane"
import { RESET_KEY } from "../actions/actions"
import { showing } from "../calls/sight"
import { columnsOf } from "../look"
import { type At, MENU_KEY } from "../menu/menu"
import { modules } from "../modules"
import { launcher, minOf, showsOf, widthOf } from "../registry"
import { settingsPane } from "../settings/pane"
import {
  columnMoved,
  moved,
  opened,
  type Plan,
  resized,
  workspaceMoved,
} from "../workspaces/arrange"
import { floorOf, roomLeft } from "../workspaces/layout"
import {
  across,
  bring,
  carry,
  consume,
  current,
  type Direction,
  edge,
  entries,
  even,
  fill,
  focusEntry,
  focused,
  fresh,
  go,
  heighten,
  maximize,
  move,
  open,
  type Opening,
  samePane,
  send,
  shift,
  step,
  tabs,
  toEdge,
  widen,
  type Workspaces,
} from "../workspaces/model"

/**
 * What a change of the workspaces comes to: the view alone, as the
 * workspaces the window shows next, or a plan for the engine, which
 * arranges them (ADR 0025, decision 1); nothing when nothing changes.
 */
export type Step = Workspaces | Plan | undefined

/** What the window's own actions can change: its parts, more than a
 * module's get (`WindowApi`). */
export type Shell = WindowApi & {
  /** Changes the workspaces. */
  change: (how: (workspaces: Workspaces) => Step) => void
  toggleSidebar: () => void
  toggleOverview: () => void
  /** Drops the drawer, or lifts it (ADR 0025, decision 8). */
  drawer: () => void
  /** Shows the focused Pane over the whole window, or brings it back. */
  zoom: () => void
  /** Opens the focused Pane in a window of its own, or brings it back to
   * its place (ADR 0025, decision 9). */
  popOut: () => void
  /** Brings the focused column to the middle of the screen, once. */
  center: () => void
  /** Goes to what calls the Person first (ADR 0011, decision 5). */
  answer: () => void
  /** Settles what the Person looks at, or brings it back (ADR 0008). */
  settle: () => void
  /** Opens the Banda menu, or closes it when it is open (ADR 0017). */
  menu: (at: At) => void
  /** Opens the Banda menu at a route, or the settings at theirs, as
   * `banda menu ROUTE` does (ADR 0017, decision 7). */
  route: (route: string) => void
  /** The window's own keys again, until keys.toml changes; the settings
   * open at Keys to mend it (ADR 0005, decision 11). */
  ownKeys: () => void
  /** Opens the settings at `link`, a section and a row (ADR 0016). */
  settings: (link?: string) => void
}

const ARROWS: Record<Direction, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
}
const DIRECTIONS = Object.keys(ARROWS) as Direction[]
/**
 * Up and down, past a column's end the arrows go on to the workspace
 * there, as niri's `focus-window-or-workspace-down`; held, they stop at
 * the end. The ones that stay in the column are kept with no key, for
 * that and for `keys.toml`.
 */
const PAST: Partial<Record<Direction, string>> = { up: "above", down: "below" }
const UPRIGHT = ["up", "down"] as const
const PAGES = { up: "PageUp", down: "PageDown" } as const
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const EDGES = [
  { side: "first", code: "Home" },
  { side: "last", code: "End" },
] as const

/**
 * Steps the focused column's width through the look's presets, by what
 * the window shows: a preset its `min` hides is passed over.
 */
function resize(shell: Shell, by: 1 | -1, wrap = false) {
  shell.change((w) => {
    const workspace = current(w)
    const column = workspace.columns[workspace.focus]
    if (!column) return undefined
    const look = columnsOf()
    const floor = floorOf(workspace.id, minOf(column, look.min))
    return resized(w, widen(w, by, look, { floor, wrap }))
  })
}

/** Steps the focused Pane's height through the look's `heights`. */
function heightening(shell: Shell, by: 1 | -1, wrap = false) {
  shell.change((w) => resized(w, heighten(w, by, columnsOf(), { wrap })))
}

/** Moves the focused Pane as `how` would: sideways its whole column. */
function shifting(w: Workspaces, direction: Direction): Step {
  const workspace = current(w)
  const column = workspace.columns[workspace.focus]
  const entry = focused(w)
  const next = shift(w, direction)
  if (!column || !entry || next === w) return undefined
  return direction === "left" || direction === "right"
    ? columnMoved(next, column.id)
    : moved(next, entry.id)
}

/** Moves the focused column to the first or the last place. */
function movedTo(w: Workspaces, side: "first" | "last"): Step {
  const workspace = current(w)
  const column = workspace.columns[workspace.focus]
  const next = toEdge(w, side)
  return column && next !== w ? columnMoved(next, column.id) : undefined
}

/** Moves the focused Pane where `how` puts it, and follows it. */
function moving(w: Workspaces, how: (w: Workspaces) => Workspaces): Step {
  const entry = focused(w)
  const next = how(w)
  return entry && next !== w ? moved(next, entry.id) : undefined
}

/** Shows a Pane of a Space and focuses it, as `how` says; a new column
 * takes its width. */
export function opening(
  workspaces: Workspaces,
  space: SpaceId,
  pane: PaneState,
  how: Omit<Opening, "width"> = {}
): Step {
  const next = open(workspaces, space, pane, { ...how, width: widthOf(pane) })
  const plan = opened(workspaces, next)
  if (!plan) return next
  return how.focus === false ? { ...plan, focus: false } : plan
}

/** Shows a Pane here, right of the focused one, with its width; one
 * another workspace shows moves here. */
export function bringing(
  workspaces: Workspaces,
  space: SpaceId,
  pane: PaneState
): Step {
  const next = bring(workspaces, space, pane, {
    place: "right",
    width: widthOf(pane),
  })
  const away = entries(workspaces).find(
    (entry) =>
      samePane(entry, { space, pane }) &&
      !current(workspaces).columns.some((c) => c.entries.includes(entry))
  )
  // The one that moved here shows anew in `next`, under another ID.
  const was = new Set(entries(workspaces).map((entry) => entry.id))
  const here = entries(next).find((entry) => !was.has(entry.id))
  if (away && here) return moved(next, away.id, here.id)
  return opened(workspaces, next) ?? next
}

/**
 * Goes to a thing that calls: to the Pane that shows it, on any
 * workspace, or to a new column that does.
 */
export function answering(
  workspaces: Workspaces,
  thing: { space: SpaceId; about: string; pane: PaneState }
): Step {
  const entry = showing(workspaces, thing, showsOf)
  return entry
    ? focusEntry(workspaces, entry.id)
    : opening(workspaces, thing.space, thing.pane, { place: "right" })
}

/**
 * Opens the settings Pane at `link` in `space`, or goes to the one a
 * workspace shows, there when a link is given: one at a time.
 */
export function settingsAt(
  workspaces: Workspaces,
  space: SpaceId,
  link = ""
): Step {
  const pane = paneOf(settingsPane, { link })
  const shown = entries(workspaces).find(
    (entry) => entry.pane.kind === settingsPane.kind
  )
  if (!shown) return opening(workspaces, space, pane, { place: "right" })
  if (!link || link === shown.pane.args.link) {
    return focusEntry(workspaces, shown.id)
  }
  return {
    command: {
      method: "workspaces.update",
      params: { pane: shown.id, args: pane.args },
    },
    want: shown.id,
  }
}

/** Closes a Pane; its neighbour takes the focus. */
export function closing(pane: string): Plan {
  return { command: { method: "workspaces.close", params: { pane } } }
}

/** Every action: the modules' (`modules.ts`), then the window's own. */
export const ACTIONS: readonly Action<Shell>[] = [
  ...modules.flatMap((module) => module.actions),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    section: "Panes",
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: PAST[direction] ? [] : [{ code: ARROWS[direction], alt: true }],
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    section: "Panes",
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: PAST[direction]
      ? []
      : [{ code: ARROWS[direction], alt: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => shifting(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.focus-${direction}-or-workspace`,
    section: "Panes",
    family: "Focus a Pane, or the workspace past it",
    title: `Focus the Pane ${direction}, or the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], alt: true }],
    whenHeld: `pane.focus-${direction}`,
    run: (shell: Shell) => shell.change((w) => across(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.move-${direction}-or-to-workspace`,
    section: "Panes",
    family: "Move the Pane, or to the workspace past it",
    title: `Move the Pane ${direction}, or to the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], alt: true, shift: true }],
    whenHeld: `pane.move-${direction}`,
    run: (shell: Shell) =>
      shell.change((w) => moving(w, (w) => carry(w, direction))),
  })),
  {
    id: "column.wider",
    section: "Columns",
    title: "Make the column wider",
    keys: [{ code: "ArrowRight", alt: true, ctrl: true }],
    run: (shell) => resize(shell, 1),
  },
  {
    id: "column.narrower",
    section: "Columns",
    title: "Make the column narrower",
    keys: [{ code: "ArrowLeft", alt: true, ctrl: true }],
    run: (shell) => resize(shell, -1),
  },
  {
    id: "column.next-width",
    section: "Columns",
    title: "The column's next width, round",
    // As niri's Mod+R and Mod+Shift+R.
    keys: [{ code: "KeyR", alt: true }],
    run: (shell) => resize(shell, 1, true),
  },
  {
    id: "column.previous-width",
    section: "Columns",
    title: "The column's previous width, round",
    // Alt+Shift+R is the height now, as niri's; Alt+Ctrl+Left steps back.
    run: (shell) => resize(shell, -1, true),
  },
  {
    id: "column.fill",
    section: "Columns",
    title: "The column as wide as the room the others leave",
    // As niri's Mod+Ctrl+F.
    keys: [{ code: "KeyF", alt: true, ctrl: true }],
    run: (shell) =>
      shell.change((w) => {
        const width = roomLeft(current(w))
        return width === undefined ? undefined : resized(w, fill(w, width))
      }),
  },
  {
    id: "column.center",
    section: "Columns",
    title: "The column in the middle of the screen",
    // As niri's Mod+C.
    keys: [{ code: "KeyC", alt: true }],
    run: (shell) => shell.center(),
  },
  // As niri's Mod+Home and End, and Mod+Ctrl+Home and End.
  ...EDGES.flatMap(({ side, code }) => [
    {
      id: `column.${side}`,
      section: "Columns",
      title: `Focus the ${side} column`,
      keys: [{ code, alt: true }],
      run: (shell: Shell) => shell.change((w) => edge(w, side)),
    },
    {
      id: `column.move-${side}`,
      section: "Columns",
      title: `Move the column to the ${side} place`,
      keys: [{ code, alt: true, shift: true }],
      run: (shell: Shell) => shell.change((w) => movedTo(w, side)),
    },
  ]),
  {
    id: "pane.next-height",
    section: "Panes",
    title: "The Pane's next height in its column, round",
    // As niri's Mod+Shift+R.
    keys: [{ code: "KeyR", alt: true, shift: true }],
    run: (shell) => heightening(shell, 1, true),
  },
  {
    id: "pane.taller",
    section: "Panes",
    title: "Make the Pane taller",
    keys: [{ code: "ArrowDown", alt: true, ctrl: true }],
    run: (shell) => heightening(shell, 1),
  },
  {
    id: "pane.shorter",
    section: "Panes",
    title: "Make the Pane shorter",
    keys: [{ code: "ArrowUp", alt: true, ctrl: true }],
    run: (shell) => heightening(shell, -1),
  },
  {
    id: "column.even",
    section: "Columns",
    title: "Every Pane of the column as high as the others",
    // As niri's Mod+Ctrl+R.
    keys: [{ code: "KeyR", alt: true, ctrl: true }],
    run: (shell) => shell.change((w) => resized(w, even(w))),
  },
  {
    id: "pane.zoom",
    section: "Panes",
    title: "The Pane over the whole window, or back",
    // As niri's Mod+Shift+F, fullscreen in the window.
    keys: [{ code: "KeyF", alt: true, shift: true }],
    run: (shell) => shell.zoom(),
  },
  {
    id: "column.tabs",
    section: "Columns",
    title: "The column's Panes as tabs, or one above another",
    // As Omarchy's Super+G, a group; niri's Mod+W.
    keys: [{ code: "KeyG", alt: true }],
    run: (shell) => shell.change((w) => resized(w, tabs(w, columnsOf()))),
  },
  {
    id: "pane.consume-left",
    section: "Panes",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", alt: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "left"))),
  },
  {
    id: "pane.consume-right",
    section: "Panes",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", alt: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "right"))),
  },
  {
    id: "column.maximize",
    section: "Columns",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", alt: true }],
    run: (shell) => shell.change((w) => resized(w, maximize(w))),
  },
  {
    id: "pane.new",
    section: "Panes",
    title: "New Pane",
    keys: [{ code: "KeyN", alt: true }],
    run: (shell) => shell.open(paneOf(launcher, {})),
  },
  {
    id: "pane.close",
    section: "Panes",
    title: "Close the Pane",
    keys: [{ code: "KeyW", alt: true }],
    run: (shell) =>
      shell.change((w) => {
        const entry = focused(w)
        return entry && closing(entry.id)
      }),
  },
  {
    id: "pane.pop-out",
    section: "Panes",
    title: "The Pane in a window of its own, and back",
    run: (shell) => shell.popOut(),
  },
  {
    id: "drawer.toggle",
    section: "Threads",
    title: "The drawer: a quick Thread over the workspace",
    // As a terminal that drops down is: the key under Esc.
    keys: [{ code: "Backquote", alt: true }],
    overDialogs: true,
    run: (shell) => shell.drawer(),
  },
  {
    id: "overview.toggle",
    section: "Workspaces",
    title: "Overview of every window",
    keys: [{ code: "KeyO", alt: true }],
    run: (shell) => shell.toggleOverview(),
  },
  ...UPRIGHT.flatMap((direction): Action<Shell>[] => {
    const code = PAGES[direction]
    const by = direction === "up" ? -1 : 1
    return [
      {
        id: `workspace.${direction}`,
        section: "Workspaces",
        title: `The workspace ${PAST[direction]}`,
        keys: [{ code, alt: true }],
        run: (shell) => shell.change((w) => step(w, by)),
      },
      {
        id: `workspace.move-${direction}`,
        section: "Workspaces",
        title: `Move the workspace ${direction}`,
        keys: [{ code, alt: true, shift: true }],
        run: (shell) => shell.change((w) => workspaceMoved(w, by)),
      },
    ]
  }),
  {
    id: "workspace.new",
    section: "Workspaces",
    title: "A new workspace: the empty one at the bottom",
    run: (shell) => shell.change(fresh),
  },
  {
    id: "calls.answer",
    section: "Threads",
    title: "Go to what calls you",
    keys: [{ code: "KeyU", alt: true }],
    run: (shell) => shell.answer(),
  },
  {
    id: "sidebar.settle",
    section: "Threads",
    title: "Settle the Thread you look at, or bring it back",
    keys: [{ code: "KeyS", alt: true }],
    run: (shell) => shell.settle(),
  },
  {
    id: "menu.open",
    section: "Banda",
    title: "Banda menu",
    keys: [MENU_KEY],
    overDialogs: true,
    run: (shell) => shell.menu("root"),
  },
  {
    id: "menu.keys",
    section: "Banda",
    title: "Every action and its key",
    keys: [{ code: "KeyK", alt: true }],
    overDialogs: true,
    run: (shell) => shell.menu("actions"),
  },
  {
    id: "space.add",
    section: "Banda",
    title: "Add Space",
    // The menu lists "Add Space" as its own branch; this opens it there.
    unlisted: true,
    run: (shell) => shell.route("space.add"),
  },
  {
    id: "settings.open",
    section: "Banda",
    title: "Open the settings",
    keys: [{ code: "Comma", alt: true }],
    run: (shell) => shell.settings(),
  },
  {
    id: "update.check",
    section: "Banda",
    title: "Check for updates",
    run: () => window.banda?.update.check(),
  },
  {
    id: "update.restart",
    section: "Banda",
    title: "Restart Banda to install its update",
    // The bar's update runs it; with no version ready it does nothing
    // (ADR 0041, decision 2).
    unlisted: true,
    run: () => window.banda?.update.restart(),
  },
  {
    id: "keys.reset",
    section: "Banda",
    title: "Banda's own keys, until keys.toml changes",
    // No file binds it, so keys bound away can always be mended.
    keys: [RESET_KEY],
    overDialogs: true,
    run: (shell) => shell.ownKeys(),
  },
  {
    id: "sidebar.toggle",
    section: "Threads",
    title: "Show or hide the sidebar",
    keys: [{ code: "KeyA", alt: true }],
    run: (shell) => shell.toggleSidebar(),
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    section: "Workspaces",
    family: "Go to a workspace",
    title: `Go to workspace ${n}`,
    keys: [{ code: `Digit${n}`, alt: true }],
    run: (shell: Shell) => shell.change((w) => go(w, n - 1)),
  })),
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    section: "Panes",
    family: "Move the Pane to a workspace",
    title: `Move the Pane to workspace ${n}`,
    keys: [{ code: `Digit${n}`, alt: true, shift: true }],
    run: (shell: Shell) =>
      shell.change((w) => moving(w, (w) => send(w, n - 1))),
  })),
]

/** Runs the action `id` as its key would, with `args`. */
export function runAction(shell: Shell, id: string, args?: Args): void {
  const action = ACTIONS.find((action) => action.id === id)
  if (!action) throw new Error(`Banda has no action ${id}`)
  action.run(shell, args)
}
