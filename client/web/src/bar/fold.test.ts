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
