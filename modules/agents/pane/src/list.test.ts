import type { ThreadList } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { applyThreads, rewound } from "./list"
import { agent, event, person } from "./testing"

const empty: ThreadList = { at: 0, threads: [] }

test("a new Thread joins the list once, with its Harness and Agent", () => {
  const started = event(
    "thread.started",
    { thread: "t1", title: "Hello", harness: "claude", agent: "a1" },
    { subject: "t1" }
  )
  const state = [started, started].reduce(applyThreads, empty)
  expect(state.threads).toEqual([
    {
      id: "t1",
      harness: "claude",
      agent: "a1",
      title: "Hello",
      updated_at: started.at,
      asking: [],
    },
  ])
})

test("a Thread from an older log names no Harness", () => {
  const started = event(
    "thread.started",
    { thread: "t1", agent: "a1", title: "Hello" },
    { subject: "t1" }
  )
  expect(applyThreads(empty, started).threads[0].harness).toBe("")
})

test("a Thread that hears a message moves to the top", () => {
  const state: ThreadList = {
    at: 2,
    threads: [
      {
        id: "t2",
        agent: "a2",
        harness: "fake",
        title: "Two",
        updated_at: 2,
        asking: [],
      },
      {
        id: "t1",
        agent: "a1",
        harness: "fake",
        title: "One",
        updated_at: 1,
        asking: [],
      },
    ],
  }
  const posted = event(
    "message.posted",
    { item: "m", turn: "u", text: "again" },
    { author: person, subject: "t1" }
  )
  const moved = applyThreads(state, posted)
  expect(moved.threads.map((t) => t.id)).toEqual(["t1", "t2"])
  expect(moved.threads[0].message).toBe("again")
  const growing = event(
    "reply.grew",
    { item: "r", turn: "u", text: "…" },
    { subject: "t1" }
  )
  expect(applyThreads(moved, growing)).toBe(moved)
})

const one: ThreadList = {
  at: 1,
  threads: [
    {
      id: "t1",
      agent: "a1",
      harness: "fake",
      title: "One",
      updated_at: 1,
      asking: [],
    },
  ],
}

test("a Thread keeps its latest turn that began, and how it ended", () => {
  const started = event("turn.started", { turn: "u1" }, { subject: "t1" })
  const running = applyThreads(one, started)
  expect(running.threads[0].latest).toEqual({
    turn: "u1",
    state: "running",
    began: started.at,
  })
  expect(running.threads[0].updated_at).toBe(1)

  const withdrawn = event(
    "turn.ended",
    { turn: "u2", state: "withdrawn" },
    { author: person, subject: "t1" }
  )
  expect(applyThreads(running, withdrawn)).toBe(running)

  const ended = event(
    "turn.ended",
    { turn: "u1", state: "failed", reason: "It broke.", note: "Tried twice." },
    { subject: "t1" }
  )
  const failed = applyThreads(running, ended)
  expect(failed.threads[0].latest).toEqual({
    turn: "u1",
    state: "failed",
    began: started.at,
    reason: "It broke.",
    note: "Tried twice.",
  })
  expect(failed.threads[0].updated_at).toBe(ended.at)
})

test("a Thread's Questions ask until they are answered or closed", () => {
  const asked = (item: string) =>
    event(
      "question.asked",
      { item, turn: "u1", title: "Which?", choices: [] },
      { subject: "t1" }
    )
  const asking = [asked("q1"), asked("q2"), asked("q1")].reduce(
    applyThreads,
    one
  )
  expect(asking.threads[0].asking).toEqual([
    { item: "q1", title: "Which?" },
    { item: "q2", title: "Which?" },
  ])

  const answered = event(
    "question.answered",
    { item: "q1", choice: "allow" },
    { author: person, subject: "t1" }
  )
  const closed = event("question.closed", { item: "q2" }, { subject: "t1" })
  const settled = [answered, closed].reduce(applyThreads, asking)
  expect(settled.threads[0].asking).toEqual([])
  expect(applyThreads(settled, closed)).toBe(settled)
})

test("a fact about a Thread the list does not have changes nothing", () => {
  const started = event("turn.started", { turn: "u" }, { subject: "t9" })
  expect(applyThreads(one, started)).toBe(one)
})

test("a Thread that goes back to before a message has the list read again", () => {
  const back = (thread: string) =>
    event("thread.rewound", { thread, turn: "u2" }, { subject: thread })
  expect(rewound(one, back("t1"))).toBe(true)
  expect(rewound(one, back("t2"))).toBe(false)
  // Only the engine knows the message before; the list alone keeps it.
  expect(applyThreads(one, back("t1"))).toBe(one)
})

test("a Thread keeps its latest snooze, and what woke it", () => {
  const snoozed = event(
    "thread.snoozed",
    { thread: "t1", until: 5000 },
    { author: person, subject: "t1" }
  )
  const asleep = applyThreads(one, snoozed)
  expect(asleep.threads[0].snooze).toEqual({
    at: snoozed.at,
    by: person,
    until: 5000,
  })
  expect(asleep.threads[0].updated_at).toBe(one.threads[0].updated_at)

  const woke = event(
    "thread.woke",
    { thread: "t1", by: "question" },
    { subject: "t1" }
  )
  const awake = applyThreads(asleep, woke)
  expect(awake.threads[0].snooze?.woke).toEqual({
    at: woke.at,
    by: "question",
  })

  // Until done, it names no time; a new snooze leaves the old waking.
  const again = event(
    "thread.snoozed",
    { thread: "t1" },
    { author: agent, subject: "t1" }
  )
  expect(applyThreads(awake, again).threads[0].snooze).toEqual({
    at: again.at,
    by: agent,
  })
})

test("a renamed Thread takes its new title and keeps the one before, where it stands", () => {
  const two: ThreadList = {
    at: 2,
    threads: [
      {
        id: "t2",
        agent: "a2",
        harness: "",
        title: "Two",
        updated_at: 2,
        asking: [],
      },
      ...one.threads,
    ],
  }
  const renamed = event(
    "thread.renamed",
    { thread: "t1", title: "Fix the list", was: "One" },
    { author: person, subject: "t1" }
  )
  const state = applyThreads(two, renamed)
  expect(state.threads.map((t) => t.id)).toEqual(["t2", "t1"])
  expect(state.threads[1]).toMatchObject({
    title: "Fix the list",
    was: "One",
    updated_at: one.threads[0].updated_at,
  })
})
