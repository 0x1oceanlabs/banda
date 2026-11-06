import type { ProjectId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { describe, expect, test } from "vitest"
import { columnMoved, opened } from "./arrange"
import {
  filling,
  grouping,
  groupState,
  regrouping,
  shiftingInside,
} from "./groups"
import {
  type Column,
  groupEnds,
  open,
  runOf,
  send,
  shift,
  toEdge,
  widthIn,
  type Workspaces,
} from "./model"

const pane = (kind: string) => ({ kind, args: {} }) as PaneState

/** A workspace of columns named by their letters, each in the Group that
 * `groups` names at its place ("." for none), focused at `focus`. */
function strip(names: string, groups: string, focus: number): Workspaces {
  const columns: Column[] = [...names].map((name, i) => ({
    id: name,
    entries: [
      {
        id: `${name}1`,
        project: "s" as ProjectId,
        pane: { kind: "a.a", args: {} } as PaneState,
      },
    ],
    active: 0,
    ...(groups[i] !== "." && { group: groups[i] }),
  }))
  return {
    list: [
      { id: "w", columns, focus },
      { id: "below", columns: [], focus: 0 },
    ],
    current: 0,
  }
}

const order = (state: Workspaces, w = 0) =>
  state.list[w].columns.map((column) => column.id).join("")

describe("a Group", () => {
  test("is the columns beside each other that name it", () => {
    const { columns } = strip("abcde", ".gg.h", 0).list[0]
    expect(runOf(columns, 2)).toEqual({ start: 1, end: 3 })
    expect(runOf(columns, 0)).toEqual({ start: 0, end: 1 })
    const workspace = strip("abcd", ".gg.", 0).list[0]
    expect(groupEnds(workspace, 1)).toEqual({
      first: true,
      last: false,
      pad: true,
    })
    expect(groupEnds(workspace, 2).last).toBe(true)
    expect(groupEnds(workspace, 0)).toEqual({
      first: false,
      last: false,
      pad: false,
    })
  })

  test("Alt+G only starts one", () => {
    expect(grouping(strip("ab", "..", 1))?.command).toEqual({
      method: "workspaces.group",
      params: { column: "b" },
    })
    expect(grouping(strip("ab", ".g", 1))).toBeUndefined()
  })

  test("Alt+Shift+[ joins the Group there, or leaves one; nothing beside none", () => {
    expect(regrouping(strip("abc", "gg.", 2), "left")?.command).toEqual({
      method: "workspaces.regroup",
      params: { column: "c", toward: "left" },
    })
    expect(regrouping(strip("abc", "gg.", 1), "right")?.command.params).toEqual(
      { column: "b", toward: "right" }
    )
    expect(regrouping(strip("abc", "gg.", 2), "right")).toBeUndefined()
    expect(regrouping(strip("abc", "...", 1), "left")).toBeUndefined()
  })

  test("moves whole, and a column moves past one whole", () => {
    const right = shift(strip("abcde", ".gg..", 2), "right")
    expect(order(right)).toBe("adbce")
    expect(right.list[0].focus).toBe(3)
    expect(columnMoved(right, "c")?.command).toEqual({
      method: "workspaces.move_group",
      params: { column: "c", workspace: "w", index: 2 },
    })
    const past = shift(strip("abcd", ".gg.", 0), "right")
    expect(order(past)).toBe("bcad")
    expect(columnMoved(past, "a")?.command).toEqual({
      method: "workspaces.move_column",
      params: { column: "a", workspace: "w", index: 2 },
    })
    expect(order(shift(strip("abcd", ".gg.", 3), "left"))).toBe("adbc")
    expect(order(toEdge(strip("abcd", "..gg", 3), "first"))).toBe("cdab")
    const sent = send(strip("abc", ".gg", 1), 1)
    expect([order(sent), order(sent, 1)]).toEqual(["a", "bc"])
    expect(columnMoved(sent, "b")?.command.params).toEqual({
      column: "b",
      workspace: "below",
      index: 0,
    })
  })

  test("Alt+Ctrl+Shift+arrows move a column inside it, never out", () => {
    expect(shiftingInside(strip("abc", "ggg", 0), "right")?.command).toEqual({
      method: "workspaces.move_column",
      params: { column: "a", workspace: "w", index: 1 },
    })
    expect(shiftingInside(strip("abc", "gg.", 1), "right")).toBeUndefined()
    expect(shiftingInside(strip("abc", "...", 1), "right")).toBeUndefined()
  })

  test("Alt+M fills the screen with it, and back", () => {
    expect(filling(strip("ab", "gg", 0))?.command).toEqual({
      method: "workspaces.fill",
      params: { column: "a", fill: true },
    })
    expect(filling(strip("ab", "..", 0))).toBeUndefined()
    const filled = strip("ab", "gg", 0)
    filled.list[0].filled = "g"
    expect(filling(filled)?.command.params).toEqual({
      column: "a",
      fill: false,
    })
  })

  test("filling the screen, its columns keep their shares", () => {
    const state = strip("abc", "gg.", 0)
    const workspace = { ...state.list[0], filled: "g" }
    const [a, b, c] = workspace.columns
    Object.assign(a, { width: "1/3" })
    Object.assign(b, { width: "2/3" })
    expect(widthIn(workspace, a)).toBe("0.333")
    expect(widthIn(workspace, b)).toBe("0.667")
    expect(widthIn(workspace, c)).toBe("1/2")
    // It stands out into the Strip's padding, not the gaps.
    expect(groupEnds(workspace, 0).pad).toBe(false)
  })

  test("what a Thread opens goes into its Group, in the Deck right of it", () => {
    const before = strip("ab", "..", 0)
    const next = open(before, "s" as ProjectId, pane("git.diff"), {
      from: "a1",
      place: "group",
    })
    expect(
      opened(before, next, { place: { to: "group", pane: "a1" } })?.command
        .params
    ).toMatchObject({
      kind: "git.diff",
      place: { to: "group", pane: "a1" },
    })
  })

  test("its colour is its Agent's state", () => {
    expect(groupState("running")).toBe("working")
    expect(groupState("asking")).toBe("asking")
    expect(groupState("done")).toBe("done")
    expect(groupState("offline")).toBe("failed")
    expect(groupState("idle")).toBeUndefined()
  })
})
