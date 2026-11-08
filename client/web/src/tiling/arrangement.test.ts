import type { Workspace } from "@banda/contract/workspaces"
import { expect, test } from "vitest"
import { apply, type Command } from "./arrangement"

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
