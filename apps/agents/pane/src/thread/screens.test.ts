import type { Subagent } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { subagent } from "../testing"
import { OPEN_BESIDE } from "./beside"
import {
  back,
  NO_SCREENS,
  opened,
  subagentOpening,
  openWords,
  opensOf,
  screenHeadOf,
} from "./screens"

const reviewer = subagent("r", { role: "Reviewer", title: "Review card.ts" })
const general = subagent("g", { role: "general-purpose", title: "Fix it" })
const explore = subagent("e", {
  role: "Explore",
  title: "Find b.txt",
  parent: "g",
})
const lanes = [reviewer, general, explore]
const TITLE = "Make the sidebar card calm"

test("a Thread's Pane that is alone opens its sub-agents over it; one with room, beside", () => {
  expect(opensOf(true, true)).toBe("over")
  expect(opensOf(false, true)).toBe("beside")
  // Where their Pane does not open from it, as on another host, neither:
  // its rows opened in place show them.
  expect(opensOf(true, false)).toBeUndefined()
  expect(opensOf(false, false)).toBeUndefined()
})

test("Open reads Open beside where it opens beside, and Open over the Thread", () => {
  expect(openWords("beside")).toBe("Open beside")
  expect(openWords("over")).toBe("Open")
})

test("a Thread's Pane that is not alone still asks the window to open the sub-agent beside", () => {
  const where = { project: "p", thread: "t", agent: "a1" }
  expect(subagentOpening("beside", NO_SCREENS, "r", where)).toEqual({
    action: OPEN_BESIDE,
    args: { project: "p", thread: "t", sub: "r", agent: "a1" },
  })
  // With no Agent known yet, as S2a, the window opens it with none.
  expect(
    subagentOpening("beside", NO_SCREENS, "r", { project: "p", thread: "t" })
  ).toEqual({
    action: OPEN_BESIDE,
    args: { project: "p", thread: "t", sub: "r" },
  })
  // Alone, it asks the window nothing: a screen goes on top.
  expect(subagentOpening("over", NO_SCREENS, "r", where)).toEqual({
    screens: ["r"],
  })
})

test("screens stack: the first over the Thread, a nested one on top, and back goes one level up to the Thread", () => {
  const first = opened(NO_SCREENS, "g")
  expect(first).toEqual(["g"])
  // One of its own sub-agents, from a row in it: one more screen.
  const nested = opened(first, "e")
  expect(nested).toEqual(["g", "e"])
  // The one on top again: no second screen of it.
  expect(opened(nested, "e")).toBe(nested)
  // Back: one level up, and the row it was opened from takes the focus.
  expect(back(nested)).toEqual({ screens: ["g"], row: "e" })
  expect(back(first)).toEqual({ screens: [], row: "g" })
  // At the Thread, back changes nothing and focuses no row.
  expect(back(NO_SCREENS)).toEqual({ screens: NO_SCREENS })
})

test("a screen's header says whose sub-agent it is: its Thread's, or, nested, its parent's in place of the breadcrumb", () => {
  expect(screenHeadOf("t", reviewer, lanes, TITLE)).toEqual({
    look: "working",
    label: "Reviewer",
    of: `sub-agent of ${TITLE}`,
  })
  expect(screenHeadOf("t", explore, lanes, TITLE)).toEqual({
    look: "working",
    label: "Explore",
    of: "sub-agent of Fix it",
  })
  // A parent its Thread does not have yet.
  const lost: Subagent = { ...explore, parent: "x" }
  expect(screenHeadOf("t", lost, lanes, TITLE).of).toBe(
    "sub-agent of a sub-agent"
  )
})
