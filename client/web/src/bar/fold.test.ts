import { expect, test } from "vitest"
import type { Listed } from "@banda/ui/pane"
import { folded } from "./fold"

const pane = { kind: "agents.thread", args: {} }
const thread = (id: string, agent: string, mark: Listed["mark"]): Listed => ({
  id,
  title: id,
  mark,
  changed: 1,
  agent,
  pane,
})

test("what a module says of another's Thread goes on that Thread's row", () => {
  const stopped: Listed = {
    id: "browser:7:a1",
    title: "Fix sign-in",
    mark: "asking",
    changed: 5,
    calls: "Stopped on a tab",
    on: "a1",
    pane,
  }
  expect(
    folded([thread("t1", "a1", "done"), thread("t2", "a2", "rest"), stopped])
  ).toEqual([
    { ...thread("t1", "a1", "asking"), changed: 5, calls: "Stopped on a tab" },
    thread("t2", "a2", "rest"),
  ])
  // A quieter word keeps the Thread's own; with none, the list is as it was.
  const quiet = { ...stopped, mark: "rest" as const }
  expect(folded([thread("t1", "a1", "failed"), quiet])).toEqual([
    thread("t1", "a1", "failed"),
  ])
  const plain = [thread("t1", "a1", "done")]
  expect(folded(plain)).toBe(plain)
})

test("a child's call stays on its own card: its parent takes none of it, and what a module says of the child goes on the child's (ADR 0098, decision 24)", () => {
  const parent = thread("t1", "a1", "running")
  const child = { ...thread("t2", "a2", "asking"), parent: "t1" }
  const list = [parent, child]
  expect(folded(list)).toBe(list)
  const stopped: Listed = {
    id: "browser:7:a2",
    title: "t2",
    mark: "asking",
    changed: 5,
    calls: "Stopped on a tab",
    on: "a2",
    pane,
  }
  const idle = { ...child, mark: "rest" as const }
  expect(folded([parent, idle, stopped])).toEqual([
    parent,
    { ...child, changed: 5, calls: "Stopped on a tab" },
  ])
})
