/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the modules' own and the window's (ADR 0022, decision 3). The keys,
 * the Banda menu, its key sheet and `keys.toml` read the same list.
 */
import type { ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import type { Action, Args, WindowApi } from "@banda/ui/module"
import { type PaneState, paneOf, type Place } from "@banda/ui/pane"
import { RESET_KEY } from "../actions/actions"
import { showing } from "../calls/sight"
import { columnsOf } from "../look"
import type { At } from "../menu/menu"
import { modules } from "../modules"
import { identityOf, launcher, minOf, showsOf, widthOf } from "../registry"
import { settingsPane } from "../settings/pane"
import {
  columnMoved,
  moved,
  opened,
  type Plan,
  resized,
  workspaceMoved,
} from "../workspaces/arrange"
import {
  filling,
  grouping,
  regrouping,
  shiftingInside,
} from "../workspaces/groups"
import { floorOf, roomLeft } from "../workspaces/layout"
import {
  across,
  bring,
  carry,
  consume,
  current,
  deck,
  type Direction,
  edge,
  entries,
  even,
  fill,
  focusEntry,
  focused,
  focusedColumn,
  fresh,
  go,
  heighten,
  heightTo,
  maximize,
  move,
  open,
  type Opening,
  samePane,
  send,
  share,
  shift,
  step,
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
  /** Shows the sidebar, as a notice of many calls asks (ADR 0011). */
  showSidebar: () => void
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
  /** Archives what the Person looks at, or brings it back (ADR 0069). */
  archive: () => void
  /** Opens the snooze's picker for the Thread the Person looks at (ADR
   * 0074). */
  snooze: () => void
  /** Wakes the snoozed Thread the Person looks at. */
  wake: () => void
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
  /** Asks an Agent to look into a Problem, in a new Thread (ADR 0039). */
  lookInto: (fingerprint: string) => void
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

/** Moves the focused Pane as `how` would: sideways its whole column, or
 * its whole Group (ADR 0065). */
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

/** Moves the focused column, or its whole Group, to the first or the last
 * place. */
function movedTo(w: Workspaces, side: "first" | "last"): Step {
  const workspace = current(w)
  const column = workspace.columns[workspace.focus]
  const next = toEdge(w, side)
  return column && next !== w ? columnMoved(next, column.id) : undefined
}

/** Moves the focused Pane where `how` puts it, and follows it; one in a
 * Group that `how` sends to another workspace takes its Group, as one
 * window (ADR 0065). */
function moving(w: Workspaces, how: (w: Workspaces) => Workspaces): Step {
  const { workspace, column } = focusedColumn(w)
  const entry = focused(w)
  const next = how(w)
  if (!entry || next === w) return undefined
  if (column?.group !== undefined && current(next).id !== workspace.id) {
    const plan = columnMoved(next, column.id)
    return plan && { ...plan, want: entry.id }
  }
  return moved(next, entry.id)
}

/** Shows a Pane of a Project and focuses it, as `how` says; a new column
 * takes its width. A Pane is the one shown as its kind names it, so a
 * Project has one Diff. */
export function opening(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState,
  how: Omit<Opening, "width"> = {}
): Step {
  const next = open(workspaces, project, pane, {
    identity: identityOf,
    ...how,
    width: widthOf(pane),
  })
  // In a Group: the Group of the Pane it opens from; on a Project's
  // workspace: its Project's (ADR 0065).
  const from = how.from ?? focused(workspaces)?.id
  const plan = opened(
    workspaces,
    next,
    how.place === "group" && from
      ? { to: "group", pane: from }
      : how.place === "project"
        ? { to: "project", project }
        : undefined
  )
  if (!plan) return next
  return how.focus === false ? { ...plan, focus: false } : plan
}

/** Shows a Pane here, right of the focused one, with its width; one
 * another workspace shows moves here. */
export function bringing(
  workspaces: Workspaces,
  project: ProjectId,
  pane: PaneState
): Step {
  const next = bring(workspaces, project, pane, {
    place: "right",
    width: widthOf(pane),
    identity: identityOf,
  })
  const away = entries(workspaces).find(
    (entry) =>
      samePane(entry, { project, pane }, identityOf) &&
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
  thing: { project: ProjectId; about: string; pane: PaneState },
  place: Place = "right"
): Step {
  const entry = showing(workspaces, thing, showsOf)
  return entry
    ? focusEntry(workspaces, entry.id)
    : opening(workspaces, thing.project, thing.pane, { place })
}

/**
 * Opens the settings Pane at `link` in `project`, or goes to the one a
 * workspace shows, there when a link is given: one at a time.
 */
export function settingsAt(
  workspaces: Workspaces,
  project: ProjectId,
  link = ""
): Step {
  const pane = paneOf(settingsPane, { link })
  const shown = entries(workspaces).find(
    (entry) => entry.pane.kind === settingsPane.kind
  )
  if (!shown) return opening(workspaces, project, pane, { place: "right" })
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

/**
 * Closes a Pane that shows the thing, on any workspace, as a Thread the
 * Person archives leaves them (ADR 0008, decision 4); nothing when none
 * shows it.
 */
export function closingShown(
  workspaces: Workspaces,
  thing: { project: ProjectId; about: string }
): Plan | undefined {
  const entry = showing(workspaces, thing, showsOf)
  return entry && closing(entry.id)
}

/** Every action: the modules' (`modules.ts`), then the window's own. */
/**
 * Does `then` with the file `args` name, if it is there still; a toast
 * says when it has gone since its link was drawn (ADR 0063, decision 2).
 */
function present(args: Args | undefined, then: (file: string) => void) {
  const file = args?.file
  if (typeof file !== "string") return
  void window.banda?.files.exists(file).then((there) => {
    if (there) then(file)
    else toast.warning(`No such file: ${file}`)
  })
}

export const ACTIONS: readonly Action<Shell>[] = [
  ...modules.flatMap((module) => module.actions),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    section: "Panes",
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: PAST[direction] ? [] : [{ code: ARROWS[direction], mod: true }],
    run: (shell: Shell) => shell.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    section: "Panes",
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: PAST[direction]
      ? []
      : [{ code: ARROWS[direction], mod: true, shift: true }],
    run: (shell: Shell) => shell.change((w) => shifting(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.focus-${direction}-or-workspace`,
    section: "Panes",
    family: "Focus a Pane, or the workspace past it",
    title: `Focus the Pane ${direction}, or the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true }],
    whenHeld: `pane.focus-${direction}`,
    run: (shell: Shell) => shell.change((w) => across(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.move-${direction}-or-to-workspace`,
    section: "Panes",
    family: "Move the Pane, or to the workspace past it",
    title: `Move the Pane ${direction}, or to the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true, shift: true }],
    whenHeld: `pane.move-${direction}`,
    run: (shell: Shell) =>
      shell.change((w) => moving(w, (w) => carry(w, direction))),
  })),
  {
    id: "column.wider",
    section: "Columns",
    title: "Make the column wider",
    keys: [{ code: "ArrowRight", mod: true, more: true }],
    run: (shell) => resize(shell, 1),
  },
  {
    id: "column.narrower",
    section: "Columns",
    title: "Make the column narrower",
    keys: [{ code: "ArrowLeft", mod: true, more: true }],
    run: (shell) => resize(shell, -1),
  },
  {
    id: "column.next-width",
    section: "Columns",
    title: "The column's next width, round",
    // As niri's Mod+R and Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true }],
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
    keys: [{ code: "KeyF", mod: true, more: true }],
    run: (shell) =>
      shell.change((w) => {
        const width = roomLeft(current(w))
        return width === undefined ? undefined : resized(w, fill(w, width))
      }),
  },
  {
    id: "column.width",
    section: "Columns",
    title: "The column as wide as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ width: "1/2" }`.
    unlisted: true,
    run: (shell, args) => {
      const width = args?.width
      if (typeof width !== "string" || share(width) === undefined) return
      shell.change((w) => resized(w, fill(w, width)))
    },
  },
  {
    id: "column.center",
    section: "Columns",
    title: "The column in the middle of the screen",
    // As niri's Mod+C.
    keys: [{ code: "KeyC", mod: true }],
    run: (shell) => shell.center(),
  },
  // As niri's Mod+Home and End, and Mod+Ctrl+Home and End.
  ...EDGES.flatMap(({ side, code }) => [
    {
      id: `column.${side}`,
      section: "Columns",
      title: `Focus the ${side} column`,
      keys: [{ code, mod: true }],
      run: (shell: Shell) => shell.change((w) => edge(w, side)),
    },
    {
      id: `column.move-${side}`,
      section: "Columns",
      title: `Move the column to the ${side} place`,
      keys: [{ code, mod: true, shift: true }],
      run: (shell: Shell) => shell.change((w) => movedTo(w, side)),
    },
  ]),
  {
    id: "pane.next-height",
    section: "Panes",
    title: "The Pane's next height in its column, round",
    // As niri's Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true, shift: true }],
    run: (shell) => heightening(shell, 1, true),
  },
  {
    id: "pane.taller",
    section: "Panes",
    title: "Make the Pane taller",
    keys: [{ code: "ArrowDown", mod: true, more: true }],
    run: (shell) => heightening(shell, 1),
  },
  {
    id: "pane.shorter",
    section: "Panes",
    title: "Make the Pane shorter",
    keys: [{ code: "ArrowUp", mod: true, more: true }],
    run: (shell) => heightening(shell, -1),
  },
  {
    id: "pane.height",
    section: "Panes",
    title: "The Pane as high in its column as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ height: "1/3" }`.
    unlisted: true,
    run: (shell, args) => {
      const height = args?.height
      if (typeof height !== "string") return
      shell.change((w) => resized(w, heightTo(w, height, columnsOf())))
    },
  },
  {
    id: "column.even",
    section: "Columns",
    title: "Every Pane of the column as high as the others",
    // As niri's Mod+Ctrl+R.
    keys: [{ code: "KeyR", mod: true, more: true }],
    run: (shell) => shell.change((w) => resized(w, even(w))),
  },
  {
    id: "pane.zoom",
    section: "Panes",
    title: "The Pane over the whole window, or back",
    // As niri's Mod+Shift+F, fullscreen in the window.
    keys: [{ code: "KeyF", mod: true, shift: true }],
    run: (shell) => shell.zoom(),
  },
  {
    id: "column.tabs",
    section: "Columns",
    title: "The column as a Deck, one Pane at a time, or one above another",
    // niri's Mod+W; Alt+G starts a Group (ADR 0065).
    keys: [{ code: "KeyT", mod: true }],
    run: (shell) => shell.change((w) => resized(w, deck(w, columnsOf()))),
  },
  // Groups: columns held together, which move and look as one (ADR 0065).
  {
    id: "group.new",
    section: "Groups",
    title: "A Group of the column, for others to join",
    keys: [{ code: "KeyG", mod: true }],
    run: (shell) => shell.change(grouping),
  },
  ...(["left", "right"] as const).flatMap((side) => [
    {
      id: `group.join-${side}`,
      section: "Groups",
      title: `The column into the Group on the ${side}, or out of its own that way`,
      keys: [
        {
          code: side === "left" ? "BracketLeft" : "BracketRight",
          mod: true,
          shift: true,
        },
      ],
      run: (shell: Shell) => shell.change((w) => regrouping(w, side)),
    },
    {
      id: `group.column-${side}`,
      section: "Groups",
      title: `Move the column ${side} inside its Group`,
      keys: [{ code: ARROWS[side], mod: true, more: true, shift: true }],
      run: (shell: Shell) => shell.change((w) => shiftingInside(w, side)),
    },
  ]),
  {
    id: "group.maximize",
    section: "Groups",
    title: "The Group the whole screen wide, or back",
    keys: [{ code: "KeyM", mod: true }],
    run: (shell) => shell.change(filling),
  },
  {
    id: "pane.consume-left",
    section: "Panes",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", mod: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "left"))),
  },
  {
    id: "pane.consume-right",
    section: "Panes",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", mod: true }],
    run: (shell) => shell.change((w) => moving(w, (w) => consume(w, "right"))),
  },
  {
    id: "column.maximize",
    section: "Columns",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", mod: true }],
    run: (shell) => shell.change((w) => resized(w, maximize(w))),
  },
  {
    id: "pane.new",
    section: "Panes",
    title: "New Pane",
    keys: [{ code: "KeyN", mod: true }],
    run: (shell) => shell.open(paneOf(launcher, {})),
  },
  {
    id: "pane.close",
    section: "Panes",
    title: "Close the Pane",
    keys: [{ code: "KeyW", mod: true }],
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
    keys: [{ code: "Backquote", mod: true }],
    overDialogs: true,
    run: (shell) => shell.drawer(),
  },
  {
    id: "overview.toggle",
    section: "Workspaces",
    title: "Overview of every window",
    keys: [{ code: "KeyO", mod: true }],
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
        keys: [{ code, mod: true }],
        run: (shell) => shell.change((w) => step(w, by)),
      },
      {
        id: `workspace.move-${direction}`,
        section: "Workspaces",
        title: `Move the workspace ${direction}`,
        keys: [{ code, mod: true, shift: true }],
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
    keys: [{ code: "KeyU", mod: true }],
    run: (shell) => shell.answer(),
  },
  {
    id: "sidebar.archive",
    section: "Threads",
    title: "Archive the Thread you look at, or bring it back",
    keys: [{ code: "KeyS", mod: true }],
    run: (shell) => shell.archive(),
  },
  {
    id: "thread.snooze",
    section: "Threads",
    title: "Snooze the Thread you look at, or wake it",
    keys: [{ code: "KeyZ", mod: true }],
    run: (shell) => shell.snooze(),
  },
  {
    id: "thread.wake",
    section: "Threads",
    title: "Wake the snoozed Thread you look at",
    run: (shell) => shell.wake(),
  },
  {
    id: "menu.open",
    section: "Banda",
    title: "Banda menu",
    keys: [{ code: "Space", mod: true }],
    overDialogs: true,
    run: (shell) => shell.menu("root"),
  },
  {
    id: "menu.keys",
    section: "Banda",
    title: "Every action and its key",
    keys: [{ code: "KeyK", mod: true }],
    overDialogs: true,
    run: (shell) => shell.menu("actions"),
  },
  {
    // A file a Pane's link names, as a terminal's path or a reply's
    // (ADR 0063): in a browser's tab, until Files shows it.
    id: "file.open",
    section: "Banda",
    title: "Open a file in Banda",
    unlisted: true,
    run: (shell, args) =>
      present(args, (file) =>
        shell.run("browser.open", { file, project: args?.project ?? null })
      ),
  },
  {
    // A file a Pane's link names, as a terminal's path with Ctrl.
    id: "file.outside",
    section: "Banda",
    title: "Open a file in its app",
    unlisted: true,
    run: (_, args) =>
      present(args, (file) => window.banda?.files.outside(file)),
  },
  {
    // A Thread menu's "Show in folder", for a path in a reply.
    id: "file.folder",
    section: "Banda",
    title: "Show a file in its folder",
    unlisted: true,
    run: (_, args) => present(args, (file) => window.banda?.files.show(file)),
  },
  {
    // The menu's Paste, as a terminal's: the focused field takes it.
    id: "edit.paste",
    section: "Banda",
    title: "Paste",
    unlisted: true,
    run: () => window.banda?.edit.paste(),
  },
  {
    // The composer menu's "Paste as plain text".
    id: "edit.paste-plain",
    section: "Banda",
    title: "Paste as plain text",
    unlisted: true,
    run: () => window.banda?.edit.pastePlain(),
  },
  {
    // A Thread menu's "Copy image": the image at a point of the page.
    id: "edit.copy-image",
    section: "Banda",
    title: "Copy image",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.x === "number" && typeof args.y === "number")
        window.banda?.edit.copyImageAt(args.x, args.y)
    },
  },
  {
    id: "project.add",
    section: "Banda",
    title: "Add Project",
    // The menu lists "Add Project" as its own branch; this opens it there.
    unlisted: true,
    run: (shell) => shell.route("project.add"),
  },
  {
    id: "settings.open",
    section: "Banda",
    title: "Open the settings",
    keys: [{ code: "Comma", mod: true }],
    // A Problem's toast opens it there: its `link` (ADR 0039).
    run: (shell, args) =>
      shell.settings(typeof args?.link === "string" ? args.link : undefined),
  },
  {
    id: "problems.look-into",
    section: "Banda",
    title: "Look into a Problem",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.fingerprint === "string")
        shell.lookInto(args.fingerprint)
    },
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
    keys: [{ code: "KeyA", mod: true }],
    run: (shell) => shell.toggleSidebar(),
  },
  {
    id: "sidebar.show",
    section: "Threads",
    title: "Show the sidebar",
    // The notice of many calls shows it, which lists them all.
    unlisted: true,
    run: (shell) => shell.showSidebar(),
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    section: "Workspaces",
    family: "Go to a workspace",
    title: `Go to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true }],
    run: (shell: Shell) => shell.change((w) => go(w, n - 1)),
  })),
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    section: "Panes",
    family: "Move the Pane to a workspace",
    title: `Move the Pane to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true, shift: true }],
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
