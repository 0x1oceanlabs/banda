import type { ListedThread } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { FAILED, listedOf } from "./rows"

const thread = (more: Partial<ListedThread> = {}): ListedThread => ({
  id: "t1",
  agent: "a1",
  harness: "claude",
  title: "Hello",
  updated_at: 5,
  asking: [],
  ...more,
})

test("a quiet Thread lists its title, Harness, Agent and what it was asked", () => {
  const listed = listedOf(
    thread({ message: "fix the form\nand more" }),
    {},
    "Claude"
  )
  expect(listed).toMatchObject({
    id: "t1",
    title: "Hello",
    mark: "rest",
    changed: 5,
    said: "fix the form",
    by: "Claude",
    harness: "claude",
    agent: "a1",
    pane: { kind: "agents.thread", args: { thread: "t1", harness: "claude" } },
  })
  expect(listed.calls).toBeUndefined()
  expect(listed.began).toBeUndefined()
})

test("a Thread that asks says what it asks", () => {
  const asking = thread({
    latest: { turn: "u1", state: "running", began: 3 },
    asking: [{ item: "q1", title: "Run npm test?" }],
  })
  expect(listedOf(asking, {}, "Claude")).toMatchObject({
    mark: "asking",
    calls: "Run npm test?",
    began: 3,
  })
})

test("a failed Thread says why, or that it failed", () => {
  const failed = (reason?: string) =>
    thread({ latest: { turn: "u1", state: "failed", began: 3, reason } })
  expect(listedOf(failed("Sign in to Codex"), {}, "").calls).toBe(
    "Sign in to Codex"
  )
  expect(listedOf(failed(), {}, "").calls).toBe(FAILED)
  expect(listedOf(failed(), { t1: "u1" }, "").calls).toBeUndefined()
})

test("a done Thread says what its Agent told of its turn, once it is unseen", () => {
  const done = (note?: string) =>
    thread({ latest: { turn: "u1", state: "done", began: 3, note } })
  expect(listedOf(done("PR #470 is open"), {}, "")).toMatchObject({
    mark: "done",
    calls: "PR #470 is open",
  })
  expect(listedOf(done(), {}, "").calls).toBeUndefined()
  expect(
    listedOf(done("PR #470 is open"), { t1: "u1" }, "").calls
  ).toBeUndefined()
})

test("what it was asked shows only when it says more than the title", () => {
  expect(listedOf(thread({ message: "Hello" }), {}, "").said).toBeUndefined()
})

test("a new Thread with no title yet is a New Thread", () => {
  expect(listedOf(thread({ title: "" }), {}, "").title).toBe("New Thread")
})

test("a Thread whose turn finished says whether its Person saw it, for Mark as unread", () => {
  const ended = (state: "done" | "failed" | "stopped") =>
    thread({ latest: { turn: "u1", state, began: 3 } })
  expect(listedOf(ended("done"), {}, "").seen).toBe(false)
  expect(listedOf(ended("done"), { t1: "u1" }, "").seen).toBe(true)
  expect(listedOf(ended("failed"), { t1: "u1" }, "").seen).toBe(true)
  // Stopped by the Person, running, or not begun: nothing to see.
  expect(listedOf(ended("stopped"), {}, "").seen).toBeUndefined()
  const running = thread({ latest: { turn: "u1", state: "running", began: 3 } })
  expect(listedOf(running, {}, "").seen).toBeUndefined()
  expect(listedOf(thread(), {}, "").seen).toBeUndefined()
})

test("a renamed Thread lists the title it had before", () => {
  expect(listedOf(thread({ was: "hello there" }), {}, "").was).toBe(
    "hello there"
  )
  expect(listedOf(thread(), {}, "").was).toBeUndefined()
})
