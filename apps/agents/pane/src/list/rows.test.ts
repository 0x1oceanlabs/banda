import type { ListedThread } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { ANSWER, FAILED, listedOf, RETRY, SHOW } from "./rows"

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

test("a Thread an Agent started names its parent; one its Person started names none (ADR 0098, decision 24)", () => {
  expect(listedOf(thread({ parent: "t0" }), "Claude").parent).toBe("t0")
  expect(listedOf(thread(), "Claude")).not.toHaveProperty("parent")
})

test("a Thread that asks says what it asks", () => {
  const asking = thread({
    latest: { turn: "u1", state: "running", began: 3 },
    asking: [{ item: "q1", title: "Run npm test?" }],
  })
  expect(listedOf(asking, "Claude")).toMatchObject({
    mark: "asking",
    calls: "Run npm test?",
    began: 3,
  })
})

test("a Thread at work lists what it does, in the window's words (ADR 0099, decision 11)", () => {
  const working = thread({
    latest: { turn: "u1", state: "running", began: 3 },
    doing: { what: "execute", title: "pnpm test", since: 4 },
    stepped: 6,
    compacting: true,
    limit_until: 9000,
  })
  expect(listedOf(working, "Claude")).toMatchObject({
    mark: "running",
    began: 3,
    doing: { what: "execute", title: "pnpm test", since: 4 },
    stepped: 6,
    compacting: true,
    limitUntil: 9000,
  })
  const listed = listedOf(thread(), "Claude")
  for (const field of ["doing", "stepped", "compacting", "limitUntil"])
    expect(listed).not.toHaveProperty(field)
})

test("a Thread lists how many lines its last turn that ended changed, and nothing when it changed none (ADR 0098, decision 8)", () => {
  const done = thread({
    latest: { turn: "u1", state: "done", began: 3 },
    changed_lines: { added: 38, removed: 9 },
  })
  expect(listedOf(done, "Claude").changedLines).toEqual({
    added: 38,
    removed: 9,
  })
  expect(listedOf(thread(), "Claude")).not.toHaveProperty("changedLines")
})

test("a failed Thread says why, or that it failed", () => {
  const failed = (reason?: string) =>
    thread({ latest: { turn: "u1", state: "failed", began: 3, reason } })
  expect(listedOf(failed("Sign in to Codex"), "").calls).toBe(
    "Sign in to Codex"
  )
  expect(listedOf(failed(), "").calls).toBe(FAILED)
  expect(listedOf({ ...failed(), seen: "u1" }, "").calls).toBeUndefined()
})

test("a done Thread says what its Agent told of its turn, once it is unseen", () => {
  const done = (note?: string) =>
    thread({ latest: { turn: "u1", state: "done", began: 3, note } })
  expect(listedOf(done("PR #470 is open"), "")).toMatchObject({
    mark: "done",
    calls: "PR #470 is open",
  })
  expect(listedOf(done(), "").calls).toBeUndefined()
  expect(
    listedOf({ ...done("PR #470 is open"), seen: "u1" }, "").calls
  ).toBeUndefined()
})

test("what it was asked shows only when it says more than the title", () => {
  expect(listedOf(thread({ message: "Hello" }), "").said).toBeUndefined()
})

test("a new Thread with no title yet is a New Thread", () => {
  expect(listedOf(thread({ title: "" }), "").title).toBe("New Thread")
})

test("a Thread whose turn finished says whether its Person saw it, for Mark as unread", () => {
  const ended = (state: "done" | "failed" | "stopped") =>
    thread({ latest: { turn: "u1", state, began: 3 } })
  expect(listedOf(ended("done"), "").seen).toBe(false)
  expect(listedOf({ ...ended("done"), seen: "u1" }, "").seen).toBe(true)
  expect(listedOf({ ...ended("failed"), seen: "u1" }, "").seen).toBe(true)
  // Stopped by the Person, running, or not begun: nothing to see.
  expect(listedOf(ended("stopped"), "").seen).toBeUndefined()
  const running = thread({ latest: { turn: "u1", state: "running", began: 3 } })
  expect(listedOf(running, "").seen).toBeUndefined()
  expect(listedOf(thread(), "").seen).toBeUndefined()
})

test("a renamed Thread lists the title it had before", () => {
  expect(listedOf(thread({ was: "hello there" }), "").was).toBe("hello there")
  expect(listedOf(thread(), "").was).toBeUndefined()
})

test("a toast answers a Question by its choices, and a failed turn by trying again or signing in", () => {
  const choices = [
    { id: "always", name: "Always", allows: true, always: true },
    { id: "once", name: "Allow", allows: true, always: false },
    { id: "no", name: "Deny", allows: false, always: false },
  ]
  const asking = thread({
    latest: { turn: "u1", state: "running", began: 3 },
    asking: [{ item: "q1", title: "Run npm test?", choices }],
  })
  expect(listedOf(asking, "", "p").answers).toEqual([
    {
      label: "Allow",
      action: ANSWER,
      args: { project: "p", item: "q1", choice: "once" },
    },
    {
      label: "Deny",
      action: ANSWER,
      args: { project: "p", item: "q1", choice: "no" },
    },
  ])
  // One with a form is answered in its Thread: no buttons.
  const form = thread({
    latest: { turn: "u1", state: "running", began: 3 },
    asking: [{ item: "q1", title: "Which?" }],
  })
  expect(listedOf(form, "", "p").answers).toBeUndefined()

  const failed = (failure?: { class: "sign_in" }) =>
    thread({
      latest: {
        turn: "u1",
        state: "failed",
        began: 3,
        ...(failure && { failure }),
      },
    })
  expect(listedOf(failed(), "", "p").answers).toEqual([
    { label: "Try again", action: RETRY, args: { project: "p", turn: "u1" } },
  ])
  expect(listedOf(failed({ class: "sign_in" }), "", "p").answers).toMatchObject(
    [{ label: "Sign in", action: SHOW }]
  )
  // Seen, it calls no more.
  expect(listedOf({ ...failed(), seen: "u1" }, "", "p").answers).toBeUndefined()
})

test("a Thread is archived while its host's archive holds: nothing happened since, and it neither works nor asks", () => {
  const done = thread({ latest: { turn: "u1", state: "done", began: 3 } })
  expect(listedOf({ ...done, archived: { at: 5 } }, "").archived).toBe(true)
  // It lists when it was archived, which the Archive counts from.
  expect(listedOf({ ...done, archived: { at: 9 } }, "")).toMatchObject({
    archived: true,
    archivedAt: 9,
  })
  // Something new in it brings it back, with no time of its archive.
  const back = listedOf({ ...done, archived: { at: 4 } }, "")
  expect(back.archived).toBeUndefined()
  expect(back).not.toHaveProperty("archivedAt")
  const running = thread({
    archived: { at: 9 },
    latest: { turn: "u1", state: "running", began: 3 },
  })
  expect(listedOf(running, "").archived).toBeUndefined()
  const asking = {
    ...done,
    archived: { at: 9 },
    asking: [{ item: "q", title: "?" }],
  }
  expect(listedOf(asking, "").archived).toBeUndefined()
  expect(listedOf(done, "").archived).toBeUndefined()
})

test("a put-off Thread lists its Later, and whether its Person saw it wake", () => {
  const person = { kind: "person", id: "p1" } as const
  const later = { at: 1, by: person, until: 9 }
  expect(listedOf(thread({ later }), "Claude").later).toEqual({
    at: 1,
    until: 9,
  })
  const seen = thread({ later: { ...later, woke_seen: "dismissed" } })
  expect(listedOf(seen, "Claude").later).toEqual({
    at: 1,
    until: 9,
    wokeSeen: true,
  })
})

test("a Thread put off Someday lists it, which no time tells from until done (ADR 0098, decision 12)", () => {
  const person = { kind: "person", id: "p1" } as const
  const someday = { at: 1, by: person, someday: true }
  expect(listedOf(thread({ later: someday }), "Claude").later).toEqual({
    at: 1,
    someday: true,
  })
  const done = { at: 1, by: person, someday: false }
  expect(listedOf(thread({ later: done }), "Claude").later).toEqual({ at: 1 })
})
