import type { ListedThread, Touched } from "@banda/contract/agents"
import type { HarnessView } from "@banda/contract/harnesses"
import { expect, test } from "vitest"
import {
  colourOf,
  followsAt,
  HOLD,
  nextTarget,
  pulsesOf,
  QUIET,
  type Target,
  threadOf,
  touchOf,
  turnedIn,
  turnPaths,
} from "./agent"

/** A Thread whose latest turn began at `began`, running or done. */
function thread(
  id: string,
  began?: number,
  state: "running" | "done" = "done",
  harness = "claude"
): ListedThread {
  return {
    id,
    agent: `agent-${id}`,
    harness,
    title: id,
    updated_at: 0,
    asking: [],
    ...(began === undefined
      ? {}
      : { latest: { turn: `turn-${id}`, state, began } }),
  } as ListedThread
}

function touch(
  path: string,
  kind: "read" | "write",
  at: number,
  line?: number
): Touched {
  return { thread: "t", path, kind, at, ...(line ? { line } : {}) } as Touched
}

test("Files is with the Thread it was opened from, else the one at work that began last, else the one that ran last", () => {
  const threads = [
    thread("old", 10),
    thread("new", 30),
    thread("busy", 20, "running"),
    thread("never"),
  ]
  expect(threadOf(threads, "old")?.id).toBe("old")
  expect(threadOf(threads, null)?.id).toBe("busy")
  expect(threadOf(threads, "gone")?.id).toBe("busy")
  expect(threadOf([thread("old", 10), thread("new", 30)], null)?.id).toBe("new")
  expect(threadOf([thread("never")], undefined)).toBeNull()
})

test("a Thread's colour is its account's emblem's", () => {
  const harnesses = [
    { id: "claude", icon: "claude-code", colour: 0 },
    { id: "claude-2", icon: "work", colour: 3 },
  ] as HarnessView[]
  expect(colourOf(harnesses, "claude")).toBe("var(--account-claude)")
  expect(colourOf(harnesses, "claude-2")).toBe("var(--account-3)")
  expect(colourOf(harnesses, "codex")).toBe("var(--primary)")
})

test("each Thread's file pulses in its tree, in its colour; files outside the folder do not", () => {
  const touched = [
    { ...touch("/w/src/a.ts", "write", 1), thread: "one" },
    { ...touch("notes.md", "read", 2), thread: "two" },
    { ...touch("/elsewhere/b.ts", "read", 3), thread: "three" },
  ]
  const pulses = pulsesOf(touched, "/w", "/w", (id) => `colour-${id}`)
  expect([...pulses]).toEqual([
    ["src/a.ts", "colour-one"],
    ["notes.md", "colour-two"],
  ])
  expect([...pulsesOf(touched, "/w/src", "/w", () => "c")]).toEqual([
    ["a.ts", "c"],
  ])
})

test("Follow goes to each write, and to a read only once the last write is HOLD behind it", () => {
  const top = "/w"
  let target: Target | null = nextTarget(null, touch("/w/a.ts", "read", 0), top)
  expect(target).toEqual({ path: "/w/a.ts", line: null, kind: "read", at: 0 })
  target = nextTarget(target, touch("b.ts", "write", 1000, 12), top)
  expect(target).toEqual({ path: "/w/b.ts", line: 12, kind: "write", at: 1000 })
  // The Agent reads around what it writes: Follow stays on the write.
  const held = nextTarget(
    target,
    touch("/w/c.ts", "read", 1000 + HOLD - 1),
    top
  )
  expect(held).toBe(target)
  // Writes are never held; a read long after moves it.
  expect(nextTarget(target, touch("/w/d.ts", "write", 1500), top)?.path).toBe(
    "/w/d.ts"
  )
  expect(
    nextTarget(target, touch("/w/c.ts", "read", 1000 + HOLD), top)?.path
  ).toBe("/w/c.ts")
  // The same touch heard again changes nothing.
  expect(nextTarget(target, touch("/w/b.ts", "write", 1000, 12), top)).toBe(
    target
  )
})

test("Follow follows the Thread's latest touch among its sub-agents'", () => {
  // The engine keeps one touch per worker, the latest last: the turn's,
  // then a sub-agent's, and another Thread's between them.
  const turn = { ...touch("/w/a.ts", "write", 1000), thread: "t" }
  const lane = {
    ...touch("/w/b.ts", "read", 2000),
    thread: "t",
    sub: "s",
  } as Touched
  const other = { ...touch("/w/c.ts", "write", 3000), thread: "u" }
  expect(touchOf([turn, other, lane], "t")).toBe(lane)
  // The turn touches again: its entry moves to the end.
  const again = { ...turn, path: "/w/d.ts", at: 4000 }
  expect(touchOf([other, lane, again], "t")).toBe(again)
  expect(touchOf([other], "t")).toBeUndefined()
})

test("Follow waits while the Person works: QUIET after a key or a click, and while they hold something", () => {
  expect(followsAt(1000, null, false)).toBe(1000)
  expect(followsAt(10_000, 1000, false)).toBe(10_000)
  expect(followsAt(2000, 1000, false)).toBe(1000 + QUIET)
  expect(followsAt(2000, null, true)).toBeNull()
  expect(followsAt(99_000, 1000, true)).toBeNull()
})

test("a turn's marks are git's checkpoints and its tool calls' files outside the folder, else its tool calls'", () => {
  expect(
    turnPaths(["src/a.ts", "made.txt"], ["src/a.ts", "/other/b.ts"], "/w")
  ).toEqual(["/w/src/a.ts", "/w/made.txt", "/other/b.ts"])
  expect(turnPaths(null, ["src/a.ts", "/other/b.ts"], "/w/")).toEqual([
    "/w/src/a.ts",
    "/other/b.ts",
  ])
  // In the tree of a folder, the files under it.
  expect([
    ...turnedIn(["/w/src/a.ts", "/w/made.txt", "/other/b.ts"], "/w/src"),
  ]).toEqual(["a.ts"])
})
