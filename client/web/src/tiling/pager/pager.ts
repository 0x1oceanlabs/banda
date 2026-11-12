/**
 * The Pager: the workspaces on the Bar, one cell each, that show where the
 * Person is and take them to another workspace (ADR 0024; ADR 0102,
 * decision 2). A pager, as an X11 panel's: it reads, draws and asks;
 * it moves nothing itself.
 *
 *   in    PagerState   what the Tiling holds, as the Pager needs it
 *                      (`pagerStateOf`, a selector of the Tiling's store)
 *         Projects     the Projects the window knows (`WidgetProps`)
 *   out   Cell[]       what each cell shows, is called and is reached by
 *                      (`cellsOf`)
 *   draws <nav aria-label="Workspaces">, a button per cell, the mark on
 *         the one on screen (`Pager.tsx`), moving on the look's
 *         `workspace` move (`motion.ts`)
 *   runs  `workspace.go` with the cell's index, on a click; nothing else
 *   gives `data-workspace` with the workspace's ID on each cell: a carried
 *         Pane dims a cell it may not drop on (`data-refused`) and aims at
 *         one it may (`data-drop`) by it (`useMoving.ts`)
 *
 * This file is the one place that decides how a workspace shows: a new
 * way is a new `Face` here and its drawing in `Pager.tsx`.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Workspaces } from "../model"

/** A workspace the Pager shows, as the Tiling holds it. */
export type PagerWorkspace = {
  id: string
  /** Its place from the top, from 0. */
  index: number
  /** It holds no Pane: the current one, emptied, or the one at the bottom. */
  empty: boolean
  /** The empty one at the bottom, which the Pager shows as its `+`. */
  bottom: boolean
  /** The Project whose workspace it is (ADR 0102, decision 1). */
  project?: ProjectId
}

/** What the Pager reads of the Tiling: the workspaces it shows, and the
 * one on screen. Made afresh each time, it is told by `sameData`, so a key
 * that moves only the focus draws the Pager not. */
export type PagerState = { list: PagerWorkspace[]; current: number }

/** The workspaces the Pager shows: those that hold Panes, the current
 * one, a Project's emptied one, and the empty one at the bottom; and the
 * one on screen. An emptied free one in the middle stands on no cell: the
 * window tidies it once the Person has left it. */
export function pagerStateOf(state: Workspaces): PagerState {
  const last = state.list.length - 1
  const list = state.list.flatMap((workspace, index) => {
    const empty = workspace.columns.length === 0
    if (
      empty &&
      !workspace.project &&
      index !== state.current &&
      index !== last
    )
      return []
    const bottom = index === last
    const project = bottom ? undefined : workspace.project
    return [
      { id: workspace.id, index, empty, bottom, ...(project && { project }) },
    ]
  })
  return { list, current: state.current }
}

/** What a cell shows: a free workspace's number, a Project's Sign, faint
 * while it is emptied and keeps its place, or the empty one at the
 * bottom's `+`. */
export type Face =
  | { kind: "number"; number: number }
  | { kind: "sign"; project: ProjectSummary; faint: boolean }
  | { kind: "new" }

/** One workspace on the Pager. */
export type Cell = {
  /** The workspace's ID: what moves it and what a carried Pane drops on. */
  id: string
  /** Its place from the top, from 0, which a click goes to. */
  index: number
  /** The one on screen. */
  here: boolean
  face: Face
  /** Its name, as a screen reader says it. */
  name: string
  /** The action whose key the pointer's hint names. */
  action: string
  /** Whose it is, said before its name in the hint. */
  whose?: string
}

/**
 * Each workspace of `state` as a cell. Its number is its place, so it is
 * its `Alt+N`, and a Sign takes a place too. A Project's shows its Sign
 * when the window knows the Project among `projects`; else its number, as
 * a free one does.
 */
export function cellsOf(
  state: PagerState,
  projects: readonly ProjectSummary[]
): Cell[] {
  return state.list.map((w) => {
    const here = w.index === state.current
    if (w.bottom)
      return {
        id: w.id,
        index: w.index,
        here,
        face: { kind: "new" },
        name: "New workspace",
        action: "workspace.new",
      }
    const number = w.index + 1
    const project = w.project && projects.find((p) => p.id === w.project)
    return {
      id: w.id,
      index: w.index,
      here,
      face: project
        ? { kind: "sign", project, faint: w.empty }
        : { kind: "number", number },
      name: `Workspace ${number}`,
      action: `workspace.go-${number}`,
      ...(project && { whose: project.name }),
    }
  })
}
