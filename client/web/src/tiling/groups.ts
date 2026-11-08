/**
 * The keys that work a Group itself (ADR 0065): start one, take a column
 * in or out, move a column inside it, fill the screen with it. Moving a
 * Group is moving any of its columns (`model.ts`, `columnMoved`).
 */
import { type Plan, columnTo } from "./arrange"
import type { Listed } from "@banda/ui/pane"
import {
  type Column,
  current,
  type Entry,
  filledAt,
  focusedColumn,
  runOf,
  type Workspaces,
} from "./model"

/** `Alt+G`: a Group of the focused column alone, for others to join. It
 * only starts one. */
export function grouping(state: Workspaces): Plan | undefined {
  const { column } = focusedColumn(state)
  if (!column || column.group !== undefined) return undefined
  return {
    command: { method: "workspaces.group", params: { column: column.id } },
  }
}

/** `Alt+Shift+[` and `]`: the focused column joins the Group beside it
 * `toward` that side, or, in one, leaves it that way. */
export function regrouping(
  state: Workspaces,
  toward: "left" | "right"
): Plan | undefined {
  const { workspace, c, column } = focusedColumn(state)
  if (!column) return undefined
  const beside = workspace.columns[toward === "left" ? c - 1 : c + 1]
  if (column.group === undefined && beside?.group === undefined) {
    return undefined
  }
  return {
    command: {
      method: "workspaces.regroup",
      params: { column: column.id, toward },
    },
  }
}

/** `Alt+Ctrl+Shift+←` and `→`: the focused column one place that way
 * inside its Group; never out of it. */
export function shiftingInside(
  state: Workspaces,
  toward: "left" | "right"
): Plan | undefined {
  const { workspace, c, column } = focusedColumn(state)
  if (column?.group === undefined) return undefined
  const { start, end } = runOf(workspace.columns, c)
  const to = c + (toward === "left" ? -1 : 1)
  if (to < start || to >= end) return undefined
  return columnTo(column.id, workspace.id, to)
}

/** A Group filling the screen, or giving the room back. */
function fillPlan(column: string, fill: boolean): Plan {
  return { command: { method: "workspaces.fill", params: { column, fill } } }
}

/** `Alt+M`: the focused column's Group the whole screen wide, its columns
 * keeping their shares, and back. */
export function filling(state: Workspaces): Plan | undefined {
  const { workspace, column } = focusedColumn(state)
  if (column?.group === undefined) return undefined
  return fillPlan(column.id, workspace.filled !== column.group)
}

/** Solo (ADR 0079, decision 2): the Agent the focus is at, on a
 * Project's workspace, fills the screen with its Group. A column in no
 * Group, or a Group with no Agent in it, stays as it is. */
export function soloing(
  state: Workspaces,
  isAgent: (entry: Entry) => boolean
): Plan | undefined {
  const { workspace, c, column } = focusedColumn(state)
  if (column?.group === undefined || workspace.project === undefined) {
    return undefined
  }
  if (filledAt(workspace, c)) return undefined
  const { start, end } = runOf(workspace.columns, c)
  const agent = workspace.columns
    .slice(start, end)
    .some((one) => one.entries.some(isAgent))
  return agent ? fillPlan(column.id, true) : undefined
}

/** Back from solo to the row: the Group that fills the workspace in view
 * gives the room back. */
export function unsoloing(state: Workspaces): Plan | undefined {
  const workspace = current(state)
  const column = workspace.columns.find((_, c) => filledAt(workspace, c))
  return column && fillPlan(column.id, false)
}

/** Each Group's Agent, by the first Thread in it that one works in, as
 * its module lists it: what colours and names the Group. */
export function agentsOf(
  columns: readonly Column[],
  listed: (entry: Entry) => Listed | undefined
): Map<string, Listed> {
  const agents = new Map<string, Listed>()
  for (const { group, entries } of columns) {
    if (group === undefined || agents.has(group)) continue
    for (const entry of entries) {
      const thread = listed(entry)
      if (thread?.agent === undefined) continue
      agents.set(group, thread)
      break
    }
  }
  return agents
}
