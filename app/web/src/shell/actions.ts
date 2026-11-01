/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the keys run them now; the palette, the key sheet and `keys.toml`
 * read the same list later.
 */
import type { SpaceId } from "@bandaso/contract"
import { agentsPane } from "@bandaso/agents-pane"
import { type PaneState, paneOf, type Place } from "@bandaso/ui/pane"
import type { Action } from "../actions/actions"
import { launcher, widthOf } from "../registry"
import {
  close,
  type Direction,
  focused,
  go,
  move,
  open,
  send,
  shift,
  step,
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
}

const ARROWS: Record<Direction, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
}
const DIRECTIONS = Object.keys(ARROWS) as Direction[]
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

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

/**
 * A new Thread in a Space, in a new column. Until a Thread needs no Agent
 * (ADR 0006), it starts at the Space's Agents.
 */
export function newThread(workspaces: Workspaces, space: SpaceId): Workspaces {
  const agents = paneOf(agentsPane, {})
  return opening(workspaces, space, agents, undefined, "right")
}

export const ACTIONS: readonly Action<Shell>[] = [
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    title: `Focus the Pane ${direction}`,
    key: { code: ARROWS[direction], alt: true },
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    title: `Move the Pane ${direction}`,
    key: { code: ARROWS[direction], alt: true, shift: true },
    run: (shell: Shell) => shell.change((w) => shift(w, direction)),
  })),
  {
    id: "column.wider",
    title: "Make the column wider",
    key: { code: "ArrowRight", alt: true, ctrl: true },
    run: (shell) => shell.change((w) => widen(w, 1)),
  },
  {
    id: "column.narrower",
    title: "Make the column narrower",
    key: { code: "ArrowLeft", alt: true, ctrl: true },
    run: (shell) => shell.change((w) => widen(w, -1)),
  },
  {
    id: "thread.new",
    title: "New Thread",
    key: { code: "Enter", alt: true },
    run: (shell) => shell.change((w) => newThread(w, shell.home)),
  },
  {
    id: "pane.new",
    title: "New Pane",
    key: { code: "KeyN", alt: true },
    // Of the focused Pane's Space, right of it.
    run: (shell) =>
      shell.change((w) =>
        opening(
          w,
          focused(w)?.space ?? shell.home,
          paneOf(launcher, {}),
          undefined,
          "right"
        )
      ),
  },
  {
    id: "pane.close",
    title: "Close the Pane",
    key: { code: "KeyW", alt: true },
    run: (shell) =>
      shell.change((w) => {
        const entry = focused(w)
        return entry ? close(w, entry.id) : w
      }),
  },
  {
    id: "overview.toggle",
    title: "Overview of every window",
    key: { code: "KeyO", alt: true },
    run: (shell) => shell.toggleOverview(),
  },
  {
    id: "workspace.up",
    title: "The workspace above",
    key: { code: "PageUp", alt: true },
    run: (shell) => shell.change((w) => step(w, -1)),
  },
  {
    id: "workspace.down",
    title: "The workspace below",
    key: { code: "PageDown", alt: true },
    run: (shell) => shell.change((w) => step(w, 1)),
  },
  {
    id: "sidebar.toggle",
    title: "Show or hide the sidebar",
    key: { code: "KeyA", alt: true },
    run: (shell) => shell.toggleSidebar(),
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    title: `Go to workspace ${n}`,
    key: { code: `Digit${n}`, alt: true },
    run: (shell: Shell) => shell.change((w) => go(w, n - 1)),
  })),
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    title: `Move the Pane to workspace ${n}`,
    key: { code: `Digit${n}`, alt: true, shift: true },
    run: (shell: Shell) => shell.change((w) => send(w, n - 1)),
  })),
]
