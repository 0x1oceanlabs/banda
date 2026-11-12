/**
 * The Panes closed while their machine was away (ADR 0106, decision 4):
 * kept on the device beside the messages, let go of once their machine
 * is back under the boot they ran under, in the order closed, by the main
 * window alone; past 7 days, or under another boot, dropped.
 */
import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import { LEFT_FOR, Left } from "./left"
import { inMemory } from "./queue"

const project = "p" as ProjectId
const terminal = (id: string) => ({
  host: "arc",
  boot: "b1",
  project,
  pane: { kind: "terminal.terminal", args: { terminal: id } },
})

test("a close waits for its machine and goes once it is back under its boot, in the order closed, and once", () => {
  let now = 1_000
  const left = new Left(inMemory(), { now: () => now })
  left.add(terminal("t1"))
  now += 1
  left.add(terminal("t2"))
  left.add({ ...terminal("t3"), host: "mac" })
  expect(left.get().map((one) => one.pane.args.terminal)).toEqual([
    "t1",
    "t2",
    "t3",
  ])
  expect(left.take("arc", "b1").map((one) => one.pane.args.terminal)).toEqual([
    "t1",
    "t2",
  ])
  expect(left.take("arc", "b1")).toEqual([])
  expect(left.get().map((one) => one.host)).toEqual(["mac"])
})

test("one under another boot, or past its 7 days, goes unsent; one under no boot heard goes", () => {
  let now = 1_000
  const left = new Left(inMemory(), { now: () => now })
  left.add(terminal("old"))
  left.add({ ...terminal("unheard"), boot: undefined })
  expect(left.take("arc", "b2").map((one) => one.pane.args.terminal)).toEqual([
    "unheard",
  ])
  left.add(terminal("late"))
  now += LEFT_FOR
  expect(left.take("arc", "b1")).toEqual([])
  expect(left.get()).toEqual([])
})

test("every window on the device keeps and sees them, and the main one alone lets go", () => {
  const storage = inMemory()
  const popped = new Left(storage, { drains: false })
  const main = new Left(storage, {})
  popped.add(terminal("t1"))
  expect(popped.take("arc", "b1")).toEqual([])
  // Read again as the storage says another window changed it.
  main.follow()
  expect(main.get()).toHaveLength(1)
  expect(main.take("arc", "b1")).toHaveLength(1)
  expect(new Left(storage, {}).get()).toEqual([])
})
