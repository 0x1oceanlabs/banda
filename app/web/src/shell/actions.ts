/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the keys run them now; the palette, the key sheet and `keys.toml`
 * read the same list later.
 */
import type { SpaceId } from "@banda/contract"
import { NEW_THREAD, threadPane } from "@banda/agents-pane"
import { browserPane, NEW_BROWSER } from "@banda/browser-pane"
import { type PaneState, paneOf, type Place } from "@banda/ui/pane"
import type { Action } from "../actions/actions"
import { showing } from "../calls/sight"
import { columnsOf } from "../look"
import { type At, MENU_KEY } from "../menu/menu"
import { launcher, minOf, showsOf, widthOf } from "../registry"
import { floorOf } from "../workspaces/layout"
import {
  bring,
  close,
  consume,
  current,
  type Direction,
  focusEntry,
  focused,
  go,
  maximize,
  move,
  open,
  send,
  shift,
  step,
  tabs,
  widen,
  type Workspaces,
} from "../workspaces/model"

/** What an action can change: the window's parts. */
export type Shell = {
  /** Changes the workspaces. */
  change: (how: (workspaces: Workspaces) => Workspaces) => void
  /** The Space a new Thread starts in. */
  home: SpaceId
  toggleSidebar: () => void
  toggleOverview: () => void
  /** Goes to what calls the Person first (ADR 0011, decision 5). */
  answer: () => void
  /** Settles what the Person looks at, or brings it back (ADR 0008). */
  settle: () => void
  /** Opens the Banda menu, or closes it when it is open (ADR 0017). */
  menu: (at: At) => void
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
 * A new Thread in a Space, in a new column, on this computer's first
 * Harness (ADR 0006). One not yet started there gets the focus instead.
 * With `ask`, it starts at once with those words, and with `harness` on
 * that Harness: the Banda menu's "New Thread" (ADR 0017, decision 6).
 */
export function newThread(
  workspaces: Workspaces,
  space: SpaceId,
  ask?: string,
  harness?: string
): Workspaces {
  const thread = paneOf(threadPane, {
    ...NEW_THREAD,
    ...(ask && { ask }),
    ...(harness && { harness }),
  })
  return opening(workspaces, space, thread, undefined, "right")
}

/** Opens a Pane in the focused Pane's Space, right of it. */
function beside(shell: Shell, pane: PaneState): void {
  shell.change((w) =>
    opening(w, focused(w)?.space ?? shell.home, pane, undefined, "right")
  )
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

export const ACTIONS: readonly Action<Shell>[] = [
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: [{ code: ARROWS[direction], alt: true }],
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: [{ code: ARROWS[direction], alt: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => shift(w, direction)),
  })),
  {
    id: "column.wider",
    title: "Make the column wider",
    keys: [{ code: "ArrowRight", alt: true, ctrl: true }],
    run: (shell) => resize(shell, 1),
  },
  {
    id: "column.narrower",
    title: "Make the column narrower",
    keys: [{ code: "ArrowLeft", alt: true, ctrl: true }],
    run: (shell) => resize(shell, -1),
  },
  {
    id: "column.next-width",
    title: "The column's next width, round",
    // As niri's Mod+R and Mod+Shift+R.
    keys: [{ code: "KeyR", alt: true }],
    run: (shell) => resize(shell, 1, true),
  },
  {
    id: "column.previous-width",
    title: "The column's previous width, round",
    keys: [{ code: "KeyR", alt: true, shift: true }],
    run: (shell) => resize(shell, -1, true),
  },
  {
    id: "column.tabs",
    title: "The column's Panes as tabs, or one above another",
    // As Omarchy's Super+G, a group; niri's Mod+W.
    keys: [{ code: "KeyG", alt: true }],
    run: (shell) => shell.change((w) => tabs(w, columnsOf())),
  },
  {
    id: "pane.consume-left",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", alt: true }],
    run: (shell) => shell.change((w) => consume(w, "left")),
  },
  {
    id: "pane.consume-right",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", alt: true }],
    run: (shell) => shell.change((w) => consume(w, "right")),
  },
  {
    id: "column.maximize",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", alt: true }],
    run: (shell) => shell.change(maximize),
  },
  {
    id: "thread.new",
    title: "New Thread",
    keys: [{ code: "Enter", alt: true }],
    run: (shell) => shell.change((w) => newThread(w, shell.home)),
  },
  {
    id: "pane.new",
    title: "New Pane",
    keys: [{ code: "KeyN", alt: true }],
    run: (shell) => beside(shell, paneOf(launcher, {})),
  },
  {
    id: "browser.new",
    title: "New browser",
    // As Omarchy's Super+Shift+Return.
    keys: [{ code: "Enter", alt: true, shift: true }],
    run: (shell) => beside(shell, paneOf(browserPane, NEW_BROWSER)),
  },
  {
    id: "pane.close",
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
    title: "Overview of every window",
    keys: [{ code: "KeyO", alt: true }],
    run: (shell) => shell.toggleOverview(),
  },
  {
    id: "workspace.up",
    title: "The workspace above",
    keys: [{ code: "PageUp", alt: true }],
    run: (shell) => shell.change((w) => step(w, -1)),
  },
  {
    id: "workspace.down",
    title: "The workspace below",
    keys: [{ code: "PageDown", alt: true }],
    run: (shell) => shell.change((w) => step(w, 1)),
  },
  {
    id: "calls.answer",
    title: "Go to what calls you",
    keys: [{ code: "KeyU", alt: true }],
    run: (shell) => shell.answer(),
  },
  {
    id: "sidebar.settle",
    title: "Settle the Thread you look at, or bring it back",
    keys: [{ code: "KeyS", alt: true }],
    run: (shell) => shell.settle(),
  },
  {
    id: "menu.open",
    title: "Banda menu",
    keys: [MENU_KEY],
    overDialogs: true,
    run: (shell) => shell.menu("root"),
  },
  {
    id: "menu.keys",
    title: "Every action and its key",
    keys: [{ code: "KeyK", alt: true }],
    overDialogs: true,
    run: (shell) => shell.menu("actions"),
  },
  {
    id: "settings.open",
    title: "Open the settings",
    keys: [{ code: "Comma", alt: true }],
    run: () => window.banda?.settings.open(),
  },
  {
    id: "sidebar.toggle",
    title: "Show or hide the sidebar",
    keys: [{ code: "KeyA", alt: true }],
    run: (shell) => shell.toggleSidebar(),
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    family: "Go to a workspace",
    title: `Go to workspace ${n}`,
    keys: [{ code: `Digit${n}`, alt: true }],
    run: (shell: Shell) => shell.change((w) => go(w, n - 1)),
  })),
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    family: "Move the Pane to a workspace",
    title: `Move the Pane to workspace ${n}`,
    keys: [{ code: `Digit${n}`, alt: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => send(w, n - 1)),
  })),
]
