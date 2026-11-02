/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the modules' own and the window's (ADR 0022, decision 3). The keys,
 * the Banda menu, its key sheet and `keys.toml` read the same list.
 */
import type { SpaceId } from "@banda/contract"
import type { Action, Args, WindowApi } from "@banda/ui/module"
import { type PaneState, paneOf, type Place } from "@banda/ui/pane"
import { RESET_KEY } from "../actions/actions"
import { showing } from "../calls/sight"
import { columnsOf } from "../look"
import { type At, MENU_KEY } from "../menu/menu"
import { modules } from "../modules"
import { launcher, minOf, showsOf, widthOf } from "../registry"
import { settingsPane } from "../settings/pane"
import { floorOf } from "../workspaces/layout"
import {
  bring,
  close,
  consume,
  current,
  type Direction,
  entries,
  focusEntry,
  focused,
  fresh,
  go,
  maximize,
  move,
  open,
  send,
  shift,
  step,
  tabs,
  update,
  widen,
  type Workspaces,
} from "../workspaces/model"

/** What the window's own actions can change: its parts, more than a
 * module's get (`WindowApi`). */
export type Shell = WindowApi & {
  /** Changes the workspaces. */
  change: (how: (workspaces: Workspaces) => Workspaces) => void
  toggleSidebar: () => void
  toggleOverview: () => void
  /** Goes to what calls the Person first (ADR 0011, decision 5). */
  answer: () => void
  /** Settles what the Person looks at, or brings it back (ADR 0008). */
  settle: () => void
  /** Opens the Banda menu, or closes it when it is open (ADR 0017). */
  menu: (at: At) => void
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
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * Steps the focused column's width through the look's presets, by what
 * the window shows: a preset its `min` hides is passed over.
 */
function resize(shell: Shell, by: 1 | -1, wrap = false) {
  shell.change((w) => {
    const workspace = current(w)
    const column = workspace.columns[workspace.focus]
    if (!column) return w
    const look = columnsOf()
    const floor = floorOf(workspace.id, minOf(column, look.min))
    return widen(w, by, look, { floor, wrap })
  })
}

/** Shows a Pane of a Space and focuses it; a new column takes its width. */
export function opening(
  workspaces: Workspaces,
  space: SpaceId,
  pane: PaneState,
  from?: string,
  place?: Place
): Workspaces {
  return open(workspaces, space, pane, { from, place, width: widthOf(pane) })
}

/** Shows a Pane here, right of the focused one, with its width; one
 * another workspace shows moves here. */
export function bringing(
  workspaces: Workspaces,
  space: SpaceId,
  pane: PaneState
): Workspaces {
  return bring(workspaces, space, pane, {
    place: "right",
    width: widthOf(pane),
  })
}

/**
 * Goes to a thing that calls: to the Pane that shows it, on any
 * workspace, or to a new column that does.
 */
export function answering(
  workspaces: Workspaces,
  thing: { space: SpaceId; about: string; pane: PaneState }
): Workspaces {
  const entry = showing(workspaces, thing, showsOf)
  return entry
    ? focusEntry(workspaces, entry.id)
    : opening(workspaces, thing.space, thing.pane, undefined, "right")
}

/**
 * Opens the settings Pane at `link` in `space`, or goes to the one a
 * workspace shows, there when a link is given: one at a time.
 */
export function settingsAt(
  workspaces: Workspaces,
  space: SpaceId,
  link = ""
): Workspaces {
  const pane = paneOf(settingsPane, { link })
  const shown = entries(workspaces).find(
    (entry) => entry.pane.kind === settingsPane.kind
  )
  if (!shown) return opening(workspaces, space, pane, undefined, "right")
  const moved = link && link !== shown.pane.args.link
  return focusEntry(
    moved ? update(workspaces, shown.id, pane) : workspaces,
    shown.id
  )
}

/** Every action: the modules' (`modules.ts`), then the window's own. */
export const ACTIONS: readonly Action<Shell>[] = [
  ...modules.flatMap((module) => module.actions),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    section: "Panes",
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: [{ code: ARROWS[direction], alt: true }],
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    section: "Panes",
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: [{ code: ARROWS[direction], alt: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => shift(w, direction)),
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
    keys: [{ code: "KeyR", alt: true, shift: true }],
    run: (shell) => resize(shell, -1, true),
  },
  {
    id: "column.tabs",
    section: "Columns",
    title: "The column's Panes as tabs, or one above another",
    // As Omarchy's Super+G, a group; niri's Mod+W.
    keys: [{ code: "KeyG", alt: true }],
    run: (shell) => shell.change((w) => tabs(w, columnsOf())),
  },
  {
    id: "pane.consume-left",
    section: "Panes",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", alt: true }],
    run: (shell) => shell.change((w) => consume(w, "left")),
  },
  {
    id: "pane.consume-right",
    section: "Panes",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", alt: true }],
    run: (shell) => shell.change((w) => consume(w, "right")),
  },
  {
    id: "column.maximize",
    section: "Columns",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", alt: true }],
    run: (shell) => shell.change(maximize),
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
        return entry ? close(w, entry.id) : w
      }),
  },
  {
    id: "overview.toggle",
    section: "Workspaces",
    title: "Overview of every window",
    keys: [{ code: "KeyO", alt: true }],
    run: (shell) => shell.toggleOverview(),
  },
  {
    id: "workspace.up",
    section: "Workspaces",
    title: "The workspace above",
    keys: [{ code: "PageUp", alt: true }],
    run: (shell) => shell.change((w) => step(w, -1)),
  },
  {
    id: "workspace.down",
    section: "Workspaces",
    title: "The workspace below",
    keys: [{ code: "PageDown", alt: true }],
    run: (shell) => shell.change((w) => step(w, 1)),
  },
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
    id: "settings.open",
    section: "Banda",
    title: "Open the settings",
    keys: [{ code: "Comma", alt: true }],
    run: (shell) => shell.settings(),
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
    run: (shell: Shell) => shell.change((w) => send(w, n - 1)),
  })),
]

/** Runs the action `id` as its key would, with `args`. */
export function runAction(shell: Shell, id: string, args?: Args): void {
  const action = ACTIONS.find((action) => action.id === id)
  if (!action) throw new Error(`Banda has no action ${id}`)
  action.run(shell, args)
}
