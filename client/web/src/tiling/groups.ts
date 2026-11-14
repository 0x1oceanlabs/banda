/**
 * The keys that work a Group itself (ADR 0065): start one, take a column
 * in or out, move a column inside it, fill the screen with it. Moving a
 * Group is moving any of its columns (`model.ts`, `columnMoved`).
 */
import { type Plan, columnTo } from "./arrange"
import {
  type Column,
  type Entry,
  focusedColumn,
  runOf,
  type Workspaces,
} from "./model"
import type { Owner } from "./shows"

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

/** Each Group's owner, by the first Pane in it whose Item names one, as
 * `owner` says: whose Mark colours the Group, and whose name it bears. */
export function ownersOf(
  columns: readonly Column[],
  owner: (entry: Entry) => Owner | undefined
): Map<string, Owner> {
  const owners = new Map<string, Owner>()
  for (const { group, entries } of columns) {
    if (group === undefined || owners.has(group)) continue
    for (const entry of entries) {
      const one = owner(entry)
      if (one === undefined) continue
      owners.set(group, one)
      break
    }
  }
  return owners
}
