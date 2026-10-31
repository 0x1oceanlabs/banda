import { expect, test } from "vitest"
import { type AgentsState, applyAgents, threadsOf } from "./agents"
import { event, person } from "./testing"
import { DEFAULT_SETTINGS } from "./thread"

const empty: AgentsState = { at: 0, agents: [], threads: [] }

test("a new Agent and its first Thread join the lists once", () => {
  const created = event("agent.created", {
    agent: "a1",
    name: "Writer",
    harness: "fake",
  })
  const started = event(
    "thread.started",
    { thread: "t1", agent: "a1", title: "Hello" },
    { subject: "t1" }
  )
  const state = [created, started, created, started].reduce(applyAgents, empty)
  expect(state.agents).toEqual([
    { id: "a1", name: "Writer", harness: "fake", settings: DEFAULT_SETTINGS },
  ])
  expect(threadsOf(state, "a1").map((t) => t.title)).toEqual(["Hello"])
})

test("a Thread that hears a message moves to the top", () => {
  const state: AgentsState = {
    at: 2,
    agents: [],
    threads: [
      { id: "t2", agent: "a1", title: "Two", updated_at: 2 },
      { id: "t1", agent: "a1", title: "One", updated_at: 1 },
    ],
  }
  const posted = event(
    "message.posted",
    { item: "m", turn: "u", text: "again" },
    { author: person, subject: "t1" }
  )
  const moved = applyAgents(state, posted)
  expect(threadsOf(moved, "a1").map((t) => t.id)).toEqual(["t1", "t2"])
  const growing = event(
    "reply.grew",
    { item: "r", turn: "u", text: "…" },
    { subject: "t1" }
  )
  expect(applyAgents(moved, growing)).toBe(moved)
})
