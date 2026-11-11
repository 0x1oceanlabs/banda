import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import type { Args, WindowApi } from "@banda/ui/module"
import type { PaneState, Runs } from "@banda/ui/pane"
import { OPEN_BESIDE } from "./beside"
import { openBeside, opensBeside, subagentPane } from "./SubagentPane"
import { showBeside, shownBeside } from "./shown-beside"

/** A window that keeps what it was asked to open, and how. */
function fake() {
  const opened: [PaneState, ProjectId, unknown][] = []
  const window = {
    open: (pane: PaneState, project: ProjectId, how: unknown) =>
      void opened.push([pane, project, how]),
  } as unknown as WindowApi
  return { window, opened }
}

const run = (window: WindowApi, args: Args) => {
  expect(openBeside.id).toBe(OPEN_BESIDE)
  return openBeside.run(window, args)
}

test("Open beside opens the sub-agent's Pane in its Thread's Group, or shows it in the one there", () => {
  const { window, opened } = fake()
  run(window, { project: "p", thread: "t", sub: "r", agent: "a1" })
  // A `path` from before is no arg of it: its parents say where it sits.
  run(window, { project: "p", thread: "t", sub: "e", path: ["g"], agent: "a1" })
  expect(opened).toEqual([
    [
      { kind: "agents.subagent", args: { thread: "t", sub: "r" } },
      "p",
      { again: false, update: true, beside: "a1" },
    ],
    [
      { kind: "agents.subagent", args: { thread: "t", sub: "e" } },
      "p",
      { again: false, update: true, beside: "a1" },
    ],
  ])
  // One Pane per Thread: both are the same Pane, which the second updates.
  const [first, second] = opened.map(([pane]) =>
    subagentPane.identity?.(pane.args as never)
  )
  expect(first).toBe("t")
  expect(second).toBe(first)
  // Another Thread's sub-agents have their own.
  expect(subagentPane.identity?.({ thread: "u", sub: "r" })).not.toBe(first)
  // One kept from before, with its `path`, is the same Pane.
  const kept = { thread: "t", sub: "e", path: ["g"] }
  expect(subagentPane.identity?.(kept)).toBe(first)
})

test("a Thread offers Open beside only where the router says its sub-agents' Pane opens", () => {
  const asked: PaneState[] = []
  const router = (answer: Runs) => (what: string | PaneState) => {
    if (typeof what !== "string") asked.push(what)
    return answer
  }
  // This machine's Thread.
  expect(opensBeside(router({ runs: true }), "t")).toBe(true)
  // Another host's: the kind does not open elsewhere yet, so the window's
  // router says it is not there (client/web, PaneFrame.test.ts), and the
  // Thread offers none.
  expect(subagentPane.elsewhere).toBeUndefined()
  const there = router({ runs: false, why: "Not on the other host yet" })
  expect(opensBeside(there, "t")).toBe(false)
  expect(asked).toEqual([
    { kind: "agents.subagent", args: { thread: "t", sub: "" } },
    { kind: "agents.subagent", args: { thread: "t", sub: "" } },
  ])
  // No router, as in a test of a part: nothing says it does not.
  expect(opensBeside(undefined, "t")).toBe(true)
})

test("Open beside with no Agent, or without what it names, opens nothing to its Group", () => {
  const { window, opened } = fake()
  run(window, { project: "p", thread: "t", sub: "r" })
  run(window, { project: "p", thread: "t" })
  run(window, { thread: "t", sub: "r" })
  expect(opened).toEqual([
    [
      { kind: "agents.subagent", args: { thread: "t", sub: "r" } },
      "p",
      { again: false, update: true },
    ],
  ])
})

test("a Thread lights the row its Pane beside shows, until that Pane shows another or goes", () => {
  const first = showBeside("p", "t", "r")
  expect(shownBeside("p", "t")).toBe("r")
  expect(shownBeside("p", "other")).toBeUndefined()
  // It shows another: the first one's going takes nothing back.
  const second = showBeside("p", "t", "g")
  first()
  expect(shownBeside("p", "t")).toBe("g")
  second()
  expect(shownBeside("p", "t")).toBeUndefined()
})
