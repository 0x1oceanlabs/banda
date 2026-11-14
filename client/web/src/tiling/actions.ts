/**
 * The Tiling's actions (ADR 0087, decision 13; ADR 0005, decision 2): what
 * a key, the Banda menu, a widget, `banda act` and an Agent ask of the
 * middle, by id. The focus and a Pane's moves, a column's and a Pane's
 * sizes, the Groups, the workspaces, the Flow, Arrange by Project and the
 * overview are here, and what opens, closes, picks, brings and puts away
 * a Pane (`opening.ts`). The Pane in a window of its own is the Window's
 * still, by the device (`window/actions.ts`).
 *
 *   in    Tiling   what the actions take of the Window, and no more: the
 *                  change of the workspaces, how the Person works the
 *                  Panes, where they are, what lies over the Panes, and
 *                  the view's own turns
 *   gives `TILING_ACTIONS`, which the Window lists among its own and
 *         every App's, and `platform/workspaces/window.json` copies for
 *         the engine, so `banda keys` names the workspaces as their owner
 *         `arranging` and `targetsOf`, for what the Window asks of the
 *         workspaces itself
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { type Flow, TILING_FILE } from "@banda/contract/workspaces"
import { toast } from "@banda/ui/components/sonner"
import { fileNow } from "@banda/ui/lib/look"
import { type Action, takes, type WindowApi } from "@banda/ui/module"
import { type PaneState, paneOf } from "@banda/ui/pane"
import { launcher } from "../launcher"
import { columnsOf } from "../look"
import { leads, showsOf } from "../registry"
import { sayArranged, unarrange, undoesNow } from "./arranged"
import {
  type Change,
  closableAt,
  closingWorkspace,
  columnMoved,
  keptOf,
  moved,
  type Plan,
  refusable,
  resized,
  type Step,
  workspaceMoved,
} from "./arrange"
import { refusedTo } from "./arrangement"
import { isFlow, nextFlow } from "./flow"
import { filling, grouping, regrouping, shiftingInside } from "./groups"
import { floorsOf, roomLeft } from "./layout"
import {
  bringing,
  closing,
  closingShown,
  picking,
  pickOf,
  placed,
  type Placing,
  sayRefused,
} from "./opening"
import {
  across,
  carry,
  consume,
  current,
  deck,
  type Direction,
  edge,
  entries,
  even,
  fill,
  focused,
  focusedColumn,
  fresh,
  go,
  heighten,
  heightTo,
  isShowing,
  maximize,
  move,
  send,
  share,
  shift,
  type Spot,
  step,
  takesGroup,
  toEdge,
  widen,
  type Workspaces,
} from "./model"
import { factsOf } from "./useTiling"

/** What the Tiling's actions take: the Window hands it in, as it hands
 * `Tiled` to what it draws, and they reach no more of the Window. */
export type Tiling = {
  /** Changes the workspaces. */
  change: (how: Change) => void
  /** Changes the workspaces to go to a Pane, which comes to the left of
   * the screen once it is drawn (ADR 0065, decision 8). Only `pane.pick`
   * asks it (ADR 0087, decision 7). */
  reach: (how: Change) => void
  /** The workspaces as they are drawn now. */
  drawn: () => Workspaces
  /** A Pane of a Project as it opens on the machine that Project is on,
   * which only the Window knows (ADR 0081). */
  paneOn: (project: ProjectId, pane: PaneState) => PaneState
  /** Takes away what lies over the Panes in their place, as the Sheet,
   * while it shows (ADR 0102, decision 5); false when nothing does. */
  uncover: () => boolean
  /** How the Person works the Panes now: the Flow, and which Projects are
   * of no Project (`placingOf`). */
  placing: () => Placing
  /** A Project by its ID, its folder missing or not, as the bar names it. */
  projectOf: (project: ProjectId) => ProjectSummary | undefined
  /** Where the Person is: the workspace on screen, and the Project a new
   * Pane opens in. */
  here: Pick<WindowApi["here"], "get">
  toggleOverview: () => void
  /** Shows the focused Pane over the whole window, or brings it back. */
  zoom: () => void
  /** Brings the focused column to the middle of the screen, once. */
  center: () => void
  /** In solo, the workspace in view as the row for a while, or back to
   * solo (ADR 0079); false when the Flow is not solo. */
  glance: () => boolean
  /** Picks a Flow on this device (`flow.ts`): Solo is its own view and
   * writes nothing, and a pick that changes how the engine places is
   * written into tiling.toml (ADR 0127, decisions 3 and 4). */
  pickFlow: (flow: Flow) => void
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
function resize(tiling: Tiling, by: 1 | -1, wrap = false) {
  tiling.change((w) => {
    const workspace = current(w)
    const column = workspace.columns[workspace.focus]
    if (!column) return undefined
    const look = columnsOf()
    const floor = floorsOf(workspace.id, look)
    return resized(w, widen(w, by, look, { floor, wrap }))
  })
}

/** Steps the focused Pane's height through the look's `heights`. */
function heightening(tiling: Tiling, by: 1 | -1, wrap = false) {
  tiling.change((w) => resized(w, heighten(w, by, columnsOf(), { wrap })))
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

/** The toast a workspace that cannot close shows: one, however often it
 * is asked. */
const UNCLOSABLE = "workspace-unclosable"

/** Says why workspace `id` stays (`closableAt`): it holds Panes, or it is
 * the empty one at the bottom. One no longer there says nothing. */
function sayUnclosable(w: Workspaces, id: string) {
  const at = w.list.findIndex((one) => one.id === id)
  if (at < 0) return
  if (w.list[at].columns.length > 0)
    toast(`Workspace ${at + 1} holds Panes`, {
      id: UNCLOSABLE,
      description:
        "Only an empty workspace closes. Close or move its Panes first.",
    })
  else
    toast("The empty workspace at the bottom stays", {
      id: UNCLOSABLE,
      description: "It is where a new workspace starts.",
    })
}

/** Closes the empty workspace `id`, a Project's too (`closingWorkspace`):
 * from the one on screen, the window goes to the one above it first, or
 * below when it is the first. One that cannot close says why. */
function closeWorkspace(tiling: Tiling, id: string): void {
  tiling.change((w) => {
    const at = closableAt(w, id)
    if (at === undefined) sayUnclosable(w, id)
    if (at !== w.current) return undefined
    return step(w, w.current > 0 ? -1 : 1)
  })
  tiling.change((w) => {
    const command = closingWorkspace(w, id)
    return command && { command, focus: false }
  })
}

/** Puts every Pane where the row would have opened it, or with `only`
 * that Project's alone: on its Project's workspace, one of no Project on a
 * free one (ADR 0102, decisions 7 and 9). A Project is one as `placing`
 * says, as for a Pane that opens: another machine's too, and one whose
 * folder is missing. A Group goes as its lead says, as it moves. */
export function arranging(
  workspaces: Workspaces,
  { scratch }: Placing,
  only?: ProjectId
): Plan {
  const all = entries(workspaces)
  const named = new Set(all.map((entry) => entry.project))
  const homed = [...named].filter((project) => !scratch(project))
  const kinds = new Set(all.filter(leads).map((entry) => entry.pane.kind))
  return {
    command: {
      method: "workspaces.arrange",
      params: {
        projects: homed,
        leads: [...kinds],
        ...(only !== undefined && { only }),
      },
    },
    // The Pane in front goes along to where it is put.
    want: focused(workspaces)?.id,
  }
}

/** What the engine refuses a move by, as this window believes it, as
 * tiling.toml says the Flow now (ADR 0110, decision 9). */
const factsNow = () => factsOf(fileNow(TILING_FILE).flow)

/** Moves the focused Pane where `how` puts it, and follows it; one in a
 * Group that `how` sends to another workspace takes its Group, as one
 * window (ADR 0065), but one of the Project's own Group goes alone
 * (`takesGroup`). Onto another Project's workspace, in the row and solo,
 * the engine refuses it (ADR 0102, decision 6), and the window says whose
 * it is and where the Pane can go: it names the Projects by `projectOf`,
 * and those of no Project as `scratch` says (`Placing`). */
function moving(
  w: Workspaces,
  how: (w: Workspaces) => Workspaces,
  projectOf: (project: ProjectId) => ProjectSummary | undefined,
  scratch: Placing["scratch"]
): Step {
  const { workspace, column } = focusedColumn(w)
  const entry = focused(w)
  const next = how(w)
  if (!entry || next === w) return undefined
  const away = current(next).id !== workspace.id
  const whole = takesGroup(workspace, column) && away
  const moves = whole ? columnMoved(next, column.id) : moved(next, entry.id)
  const plan = moves && whole ? { ...moves, want: entry.id } : moves
  return (
    plan &&
    refusable(w, plan, factsNow(), (refused) =>
      // Taken along by its Group, it would go there alone, by a drag.
      sayRefused(refused, refused.owner === entry.project, projectOf, scratch)
    )
  )
}

/** Moves the focused Pane as `moving` does, where `how` puts it. */
const moveFocused = (tiling: Tiling, how: (w: Workspaces) => Workspaces) =>
  tiling.change((w) =>
    moving(w, how, tiling.projectOf, tiling.placing().scratch)
  )

/** Each workspace as the Pane menu's "To workspace" offers it to the
 * Pane at `spot`, as `moving` would move it: its Project, and whether the
 * engine refuses the move there, as the copy of its rule foresees (ADR
 * 0102, decision 6). */
export function targetsOf(
  state: Workspaces,
  spot: Spot,
  projectOf: (project: ProjectId) => ProjectSummary | undefined
): { owner?: ProjectSummary; refused: boolean }[] {
  const workspace = state.list[spot.workspace]
  const column = workspace.columns[spot.column]
  const entry = column.entries[spot.entry].id
  const whole = takesGroup(workspace, column)
  const refused = refusedTo(keptOf(state), factsNow(), entry, whole)
  return state.list.map((w) => ({
    owner: w.project === undefined ? undefined : projectOf(w.project),
    refused: refused.has(w.id),
  }))
}

/** The Tiling's actions, as the top of this file says. */
export const TILING_ACTIONS: readonly Action<Tiling>[] = [
  ...DIRECTIONS.map((direction) => ({
    id: `pane.focus-${direction}`,
    section: "Panes",
    family: "Focus a Pane",
    title: `Focus the Pane ${direction}`,
    keys: PAST[direction] ? [] : [{ code: ARROWS[direction], mod: true }],
    run: (tiling: Tiling) => tiling.change((w) => move(w, direction)),
  })),
  ...DIRECTIONS.map((direction) => ({
    id: `pane.move-${direction}`,
    section: "Panes",
    family: "Move the Pane",
    title: `Move the Pane ${direction}`,
    keys: PAST[direction]
      ? []
      : [{ code: ARROWS[direction], mod: true, shift: true }],
    run: (tiling: Tiling) => tiling.change((w) => shifting(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.focus-${direction}-or-workspace`,
    section: "Panes",
    family: "Focus a Pane, or the workspace past it",
    title: `Focus the Pane ${direction}, or the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true }],
    whenHeld: `pane.focus-${direction}`,
    run: (tiling: Tiling) => tiling.change((w) => across(w, direction)),
  })),
  ...UPRIGHT.map((direction) => ({
    id: `pane.move-${direction}-or-to-workspace`,
    section: "Panes",
    family: "Move the Pane, or to the workspace past it",
    title: `Move the Pane ${direction}, or to the workspace ${PAST[direction]}`,
    keys: [{ code: ARROWS[direction], mod: true, shift: true }],
    whenHeld: `pane.move-${direction}`,
    run: (tiling: Tiling) => moveFocused(tiling, (w) => carry(w, direction)),
  })),
  {
    id: "column.wider",
    section: "Columns",
    title: "Make the column wider",
    keys: [{ code: "ArrowRight", mod: true, more: true }],
    run: (tiling) => resize(tiling, 1),
  },
  {
    id: "column.narrower",
    section: "Columns",
    title: "Make the column narrower",
    keys: [{ code: "ArrowLeft", mod: true, more: true }],
    run: (tiling) => resize(tiling, -1),
  },
  {
    id: "column.next-width",
    section: "Columns",
    title: "The column's next width, round",
    // As niri's Mod+R and Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true }],
    run: (tiling) => resize(tiling, 1, true),
  },
  {
    id: "column.previous-width",
    section: "Columns",
    title: "The column's previous width, round",
    // Alt+Shift+R is the height now, as niri's; Alt+Ctrl+Left steps back.
    run: (tiling) => resize(tiling, -1, true),
  },
  {
    id: "column.fill",
    section: "Columns",
    title: "The column as wide as the room the others leave",
    // As niri's Mod+Ctrl+F.
    keys: [{ code: "KeyF", mod: true, more: true }],
    run: (tiling) =>
      tiling.change((w) => {
        const width = roomLeft(current(w))
        return width === undefined ? undefined : resized(w, fill(w, width))
      }),
  },
  {
    id: "column.width",
    args: takes({ width: "a step of the look's, as 1/2" }, ["width"]),
    section: "Columns",
    title: "The column as wide as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ width: "1/2" }`.
    unlisted: true,
    run: (tiling, args) => {
      const width = args?.width
      if (typeof width !== "string" || share(width) === undefined) return
      tiling.change((w) => resized(w, fill(w, width)))
    },
  },
  {
    id: "column.center",
    section: "Columns",
    title: "The column in the middle of the screen",
    // As niri's Mod+C.
    keys: [{ code: "KeyC", mod: true }],
    run: (tiling) => tiling.center(),
  },
  // As niri's Mod+Home and End, and Mod+Ctrl+Home and End.
  ...EDGES.flatMap(({ side, code }) => [
    {
      id: `column.${side}`,
      section: "Columns",
      title: `Focus the ${side} column`,
      keys: [{ code, mod: true }],
      run: (tiling: Tiling) => tiling.change((w) => edge(w, side)),
    },
    {
      id: `column.move-${side}`,
      section: "Columns",
      title: `Move the column to the ${side} place`,
      keys: [{ code, mod: true, shift: true }],
      run: (tiling: Tiling) => tiling.change((w) => movedTo(w, side)),
    },
  ]),
  {
    id: "pane.next-height",
    section: "Panes",
    title: "The Pane's next height in its column, round",
    // As niri's Mod+Shift+R.
    keys: [{ code: "KeyR", mod: true, shift: true }],
    run: (tiling) => heightening(tiling, 1, true),
  },
  {
    id: "pane.taller",
    section: "Panes",
    title: "Make the Pane taller",
    keys: [{ code: "ArrowDown", mod: true, more: true }],
    run: (tiling) => heightening(tiling, 1),
  },
  {
    id: "pane.shorter",
    section: "Panes",
    title: "Make the Pane shorter",
    keys: [{ code: "ArrowUp", mod: true, more: true }],
    run: (tiling) => heightening(tiling, -1),
  },
  {
    id: "pane.height",
    args: takes({ height: "a step of the look's, as 1/3" }, ["height"]),
    section: "Panes",
    title: "The Pane as high in its column as a step of the look's",
    // A picture in the Pane menu (ADR 0066, decision 3): `{ height: "1/3" }`.
    unlisted: true,
    run: (tiling, args) => {
      const height = args?.height
      if (typeof height !== "string") return
      tiling.change((w) => resized(w, heightTo(w, height, columnsOf())))
    },
  },
  {
    id: "column.even",
    section: "Columns",
    title: "Every Pane of the column as high as the others",
    // As niri's Mod+Ctrl+R.
    keys: [{ code: "KeyR", mod: true, more: true }],
    run: (tiling) => tiling.change((w) => resized(w, even(w))),
  },
  {
    id: "pane.zoom",
    section: "Panes",
    title: "The Pane over the whole window, or back",
    // As niri's Mod+Shift+F, fullscreen in the window.
    keys: [{ code: "KeyF", mod: true, shift: true }],
    run: (tiling) => tiling.zoom(),
  },
  {
    id: "column.tabs",
    section: "Columns",
    title: "The column as a Deck, one Pane at a time, or one above another",
    // niri's Mod+W; Alt+G starts a Group (ADR 0065).
    keys: [{ code: "KeyT", mod: true }],
    run: (tiling) => tiling.change((w) => resized(w, deck(w, columnsOf()))),
  },
  // Groups: columns held together, which move and look as one (ADR 0065).
  {
    id: "group.new",
    section: "Groups",
    title: "A Group of the column, for others to join",
    keys: [{ code: "KeyG", mod: true }],
    run: (tiling) => tiling.change(grouping),
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
      run: (tiling: Tiling) => tiling.change((w) => regrouping(w, side)),
    },
    {
      id: `group.column-${side}`,
      section: "Groups",
      title: `Move the column ${side} inside its Group`,
      keys: [{ code: ARROWS[side], mod: true, more: true, shift: true }],
      run: (tiling: Tiling) => tiling.change((w) => shiftingInside(w, side)),
    },
  ]),
  {
    id: "group.maximize",
    section: "Groups",
    title:
      "The Group the whole screen wide, or back; in solo, the row for a while",
    keys: [{ code: "KeyM", mod: true }],
    run: (tiling) => {
      if (!tiling.glance()) tiling.change(filling)
    },
  },
  {
    id: "flow.solo",
    section: "Workspaces",
    title: "Solo, what has the focus the whole screen wide, or back to the row",
    keys: [{ code: "KeyM", mod: true, shift: true }],
    run: (tiling) => tiling.pickFlow(nextFlow(tiling.placing().flow)),
  },
  {
    id: "workspaces.arrange",
    section: "Workspaces",
    title: "Arrange by Project",
    // A toast says it, and offers Undo (`arranged.ts`).
    run: (tiling) =>
      tiling.change((w) =>
        sayArranged(tiling, w, arranging(w, tiling.placing()))
      ),
  },
  {
    id: "workspaces.unarrange",
    section: "Workspaces",
    title: "Undo Arrange by Project",
    // Its key is Undo's only while the toast offers it, and never a
    // field's, a program's or a page's, which have their own.
    keys: [{ code: "KeyZ", primary: true }],
    when: undoesNow,
    pageKeeps: true,
    run: (tiling) => unarrange(tiling),
  },
  {
    // The Flow's menu on the bar: a pick of the three, where the key only
    // goes to solo and back.
    id: "flow.pick",
    args: takes({ flow: "free, row or solo" }, ["flow"]),
    section: "Workspaces",
    title: "Pick how the Agents' windows stand: free, row or solo",
    unlisted: true,
    run: (tiling, args) => {
      if (isFlow(args?.flow)) tiling.pickFlow(args.flow)
    },
  },
  {
    id: "pane.consume-left",
    section: "Panes",
    title: "Take the Pane into the column on the left, or out of its own",
    // As niri's Mod+[.
    keys: [{ code: "BracketLeft", mod: true }],
    run: (tiling) => moveFocused(tiling, (w) => consume(w, "left")),
  },
  {
    id: "pane.consume-right",
    section: "Panes",
    title: "Take the Pane into the column on the right, or out of its own",
    keys: [{ code: "BracketRight", mod: true }],
    run: (tiling) => moveFocused(tiling, (w) => consume(w, "right")),
  },
  {
    id: "column.maximize",
    section: "Columns",
    title: "The column the whole screen wide, or back",
    // As niri's Mod+F.
    keys: [{ code: "KeyF", mod: true }],
    run: (tiling) => tiling.change((w) => resized(w, maximize(w))),
  },
  {
    id: "overview.toggle",
    section: "Workspaces",
    title: "Overview of every window",
    keys: [{ code: "KeyO", mod: true }],
    run: (tiling) => tiling.toggleOverview(),
  },
  ...UPRIGHT.flatMap((direction): Action<Tiling>[] => {
    const code = PAGES[direction]
    const by = direction === "up" ? -1 : 1
    return [
      {
        id: `workspace.${direction}`,
        section: "Workspaces",
        title: `The workspace ${PAST[direction]}`,
        keys: [{ code, mod: true }],
        run: (tiling) => tiling.change((w) => step(w, by)),
      },
      {
        id: `workspace.move-${direction}`,
        section: "Workspaces",
        title: `Move the workspace ${direction}`,
        keys: [{ code, mod: true, shift: true }],
        run: (tiling) => tiling.change((w) => workspaceMoved(w, by)),
      },
    ]
  }),
  {
    id: "workspace.new",
    section: "Workspaces",
    title: "A new workspace: the empty one at the bottom",
    run: (tiling) => tiling.change(fresh),
  },
  {
    // An emptied Project's workspace keeps its place until the Person
    // closes it (ADR 0102, decision 2). No key: a held Alt+W would go on
    // to close the Panes of the workspace it goes to.
    id: "workspace.close",
    args: takes({
      workspace: "the workspace's id; none for the one on screen",
    }),
    section: "Workspaces",
    title: "Close the workspace",
    run: (tiling, args) => {
      const id = args?.workspace ?? tiling.here.get().workspace?.id
      if (typeof id === "string") closeWorkspace(tiling, id)
    },
  },
  {
    // A number on the Bar, past the ninth too, where the keys stop.
    id: "workspace.go",
    args: takes({ index: { number: "its place from the top, from 0" } }, [
      "index",
    ]),
    section: "Workspaces",
    title: "Go to a workspace",
    unlisted: true,
    run: (tiling, args) => {
      const index = args?.index
      if (typeof index === "number" && Number.isInteger(index))
        tiling.change((w) => go(w, index))
    },
  },
  ...NUMBERS.map((n) => ({
    id: `workspace.go-${n}`,
    section: "Workspaces",
    family: "Go to a workspace",
    title: `Go to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true }],
    run: (tiling: Tiling) => tiling.change((w) => go(w, n - 1)),
  })),
  {
    // The launcher, where the Person is, as any Pane a key opens.
    id: "pane.new",
    section: "Panes",
    title: "New Pane",
    keys: [{ code: "KeyN", mod: true }],
    run: (tiling) =>
      tiling.change((w) =>
        placed(
          w,
          tiling.here.get().project,
          paneOf(launcher, {}),
          tiling.placing(),
          { again: true }
        )
      ),
  },
  {
    id: "pane.close",
    section: "Panes",
    title: "Close the Pane",
    keys: [{ code: "KeyW", mod: true }],
    // What lies over the Panes, while it shows; else the focused Pane.
    run: (tiling) => {
      if (tiling.uncover()) return
      tiling.change((w) => {
        const entry = focused(w)
        return entry && closing(entry.id)
      })
    },
  },
  {
    // What an App asks once an Item is put away, as a Thread put off or
    // archived (ADR 0008, decision 4; ADR 0069): one close for each Pane
    // that shows it now.
    id: "pane.put-away",
    args: takes(
      {
        project: "the Project of the Item",
        item: "the Item's id in its Project",
      },
      ["project", "item"]
    ),
    section: "Panes",
    title: "Close every Pane that shows an Item, on any workspace",
    unlisted: true,
    run: (tiling, args) => {
      const { project, item } = args ?? {}
      if (typeof project !== "string" || typeof item !== "string") return
      const shown = { project: project as ProjectId, about: item }
      for (const entry of entries(tiling.drawn()))
        if (isShowing(entry, shown, showsOf))
          tiling.change((w) => closingShown(w, shown))
    },
  },
  {
    // The one way to go to an Agent (ADR 0087, decision 7): a sidebar
    // row, a card of the small inbox, a toast's button and Alt+U run it,
    // with the Pane as an Item carries it. It opens on the machine its
    // Project is on.
    id: "pane.pick",
    section: "Panes",
    title: "Go to a Pane where a workspace shows it, or open it",
    unlisted: true,
    run: (tiling, args) => {
      const picked = pickOf(args)
      if (!picked) return
      // To a Pane, even the one in focus, which no focus goes to: what
      // lies over the Panes goes (ADR 0102, decision 5).
      tiling.uncover()
      const { project } = picked
      const pane = tiling.paneOn(project, picked.pane)
      tiling.reach((w) => picking(w, project, pane, tiling.placing()))
    },
  },
  {
    // Open beside (ADR 0098, decision 14): the sidebar's Shift+Enter and
    // the Banda menu's Tab bring a Pane right of the one in focus, from
    // wherever it is, and what lies over the Panes goes (ADR 0102,
    // decision 5).
    id: "pane.beside",
    section: "Panes",
    title: "Bring a Pane beside the one in focus",
    unlisted: true,
    run: (tiling, args) => {
      const picked = pickOf(args)
      if (!picked) return
      tiling.uncover()
      tiling.change((w) =>
        bringing(
          w,
          picked.project,
          picked.pane,
          tiling.placing(),
          tiling.projectOf
        )
      )
    },
  },
  ...NUMBERS.map((n) => ({
    id: `pane.send-${n}`,
    section: "Panes",
    family: "Move the Pane to a workspace",
    title: `Move the Pane to workspace ${n}`,
    keys: [{ code: `Digit${n}`, mod: true, shift: true }],
    run: (tiling: Tiling) => moveFocused(tiling, (w) => send(w, n - 1)),
  })),
]
