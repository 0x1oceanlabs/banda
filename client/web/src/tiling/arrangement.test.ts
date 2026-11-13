import type { Workspace } from "@banda/contract/workspaces"
import { expect, test } from "vitest"
import {
  apply,
  type Command,
  type Facts,
  refusalFor,
  refusedTo,
} from "./arrangement"

const WORK = "a0000000-0000-4000-8000-000000000001"

function open(list: Workspace[], args: Record<string, unknown>, seed: string) {
  const command: Command = {
    method: "workspaces.open",
    params: { project: WORK, kind: "a.a", args: args as never },
  }
  return apply(list, command, seed)
}

/** The golden traces write each Pane's args with their keys in order, so
 * this they cannot hold. */
test("a Pane's args name it whatever the order of their keys, as the engine's", () => {
  const start = [{ id: "00000000-0000-4000-8000-000000000000", columns: [] }]
  const first = open(
    start,
    { a: 1, b: { c: 2, d: 3 } },
    "00000000-0000-4000-8000-000000000001"
  )
  if ("refused" in first) throw new Error(first.message)
  const again = open(
    first.list,
    { b: { d: 3, c: 2 }, a: 1 },
    "00000000-0000-4000-8000-000000000002"
  )
  expect(again).toEqual({
    list: first.list,
    answer: { pane: first.answer.pane, new: false },
  })
})

// The row's refusals themselves are held to the engine's by the golden
// traces (`18-refused-moves.json`). These hold what a client asks its copy
// beside running a command.

/** Project A's workspace, with an Agent's Group that holds Project B's
 * browser; Project B's; a free one with Project C's Pane; and the empty
 * one at the bottom. */
const ROWS: Workspace[] = (() => {
  const pane = (id: string, project: string, kind = "terminal.terminal") => ({
    id,
    project: project as never,
    kind,
    args: {},
  })
  const column = (id: string, panes: Workspace["columns"][0]["panes"]) => ({
    id,
    panes,
    full: false,
  })
  return [
    {
      id: "a",
      project: "pa" as never,
      columns: [
        { ...column("c1", [pane("browser", "pb")]), group: "g" },
        {
          ...column("c2", [pane("thread", "pa", "agents.thread")]),
          group: "g",
        },
      ],
    },
    {
      id: "b",
      project: "pb" as never,
      columns: [column("c3", [pane("t", "pb")])],
    },
    { id: "free", columns: [column("c4", [pane("x", "pc")])] },
    { id: "bottom", columns: [] },
  ]
})()

const ROW: Facts = { flow: "row", home: [], leads: ["agents.thread"] }

test("a Pane carried goes to its Project's workspace or a free one, never another Project's; a Group as its Agent's Thread (ADR 0102, decision 6)", () => {
  // Alone, the browser is Project B's, yet it moves on A's, where it stands.
  expect([...refusedTo(ROWS, ROW, "browser", false)]).toEqual([])
  // With its Group, it goes as the Agent's Thread, Project A's.
  expect([...refusedTo(ROWS, ROW, "browser", true)]).toEqual(["b"])
  expect([...refusedTo(ROWS, ROW, "x", false)]).toEqual(["a", "b"])
  // In no Group, whole is alone; in the Flow free, every workspace is free.
  expect([...refusedTo(ROWS, ROW, "x", true)]).toEqual(["a", "b"])
  const free: Facts = { flow: "free", home: [] }
  expect([...refusedTo(ROWS, free, "x", false)]).toEqual([])
  // With no lead known, a Group is its first Pane's: B's, which may go
  // home.
  const unled: Facts = { flow: "row", home: [] }
  expect([...refusedTo(ROWS, unled, "browser", true)]).toEqual([])
})

test("the copy says which workspace the row refuses a command, whose it is, and what moves as whose", () => {
  const onto = (workspace: string) =>
    ({ to: "column", workspace, index: 0 }) as const
  const moved: Command = {
    method: "workspaces.move_pane",
    params: { pane: "x", place: onto("b") },
  }
  expect(refusalFor(ROWS, moved, ROW)).toEqual({
    workspace: "b",
    at: 1,
    owner: "pb",
    moving: "pc",
  })
  const group: Command = {
    method: "workspaces.move_group",
    params: { column: "c1", workspace: "b", index: 0 },
  }
  expect(refusalFor(ROWS, group, ROW)).toMatchObject({
    owner: "pb",
    moving: "pa",
  })
  const column: Command = { ...group, method: "workspaces.move_column" }
  expect(refusalFor(ROWS, column, ROW)).toBeUndefined()
  // A Pane brought to a place is refused as one moved there; one only
  // opened there, and any other command, is not.
  const shows = { project: "pc" as never, kind: "a.a", args: {}, again: true }
  const open = (brought: boolean): Command => ({
    method: "workspaces.open",
    params: { ...shows, place: onto("a"), ...(brought && { brought }) },
  })
  expect(refusalFor(ROWS, open(true), ROW)).toMatchObject({
    workspace: "a",
    at: 0,
  })
  expect(refusalFor(ROWS, open(false), ROW)).toBeUndefined()
  const closed: Command = { method: "workspaces.close", params: { pane: "x" } }
  expect(refusalFor(ROWS, closed, ROW)).toBeUndefined()
})
