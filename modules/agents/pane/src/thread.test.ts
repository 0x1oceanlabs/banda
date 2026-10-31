import type { Event } from "@bandaso/contract"
import { expect, test } from "vitest"
import { agent, event, person } from "./testing"
import {
  EMPTY,
  apply,
  choose,
  chosen,
  retryable,
  rows,
  working,
} from "./thread"

function play(...events: Event[]) {
  return events.reduce(apply, EMPTY)
}

test("a turn's facts build the Thread a Person reads", () => {
  const state = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "hi" },
      { author: person }
    ),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    event("reply.grew", { item: "r", turn: "u", text: "Hel" }),
    event("reply.grew", { item: "r", turn: "u", text: "lo" }),
    event("tool.started", {
      item: "x",
      turn: "u",
      title: "Run",
      tool: "execute",
      status: "pending",
    }),
    event("tool.changed", { item: "x", status: "done" }),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(state.items.map((i) => [i.id, i.author.kind, i.body])).toEqual([
    ["m", "person", { kind: "message", text: "hi" }],
    ["t", "agent", { kind: "thought", text: "Hm" }],
    ["r", "agent", { kind: "message", text: "Hello" }],
    [
      "x",
      "agent",
      { kind: "tool", title: "Run", tool: "execute", status: "done" },
    ],
  ])
  expect(state.turns).toEqual([
    { id: "u", message: "m", state: "done", reason: undefined },
  ])
  expect(working(state)).toBeUndefined()
})

test("a Question opens, then is answered or closed", () => {
  const asked = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "go" },
      { author: person }
    ),
    event("question.asked", {
      item: "q",
      turn: "u",
      title: "Run it?",
      choices: [{ id: "allow", name: "Allow", allows: true }],
    })
  )
  expect(working(asked)?.id).toBe("u")
  const answered = apply(
    asked,
    event(
      "question.answered",
      { item: "q", choice: "allow" },
      { author: person }
    )
  )
  expect(answered.items[1].body).toMatchObject({
    state: "answered",
    answer: "allow",
  })
  const closed = apply(asked, event("question.closed", { item: "q" }))
  expect(closed.items[1].body).toMatchObject({ state: "closed" })
})

test("a Question with a form keeps what the Person filled in", () => {
  const form = [
    {
      id: "colour",
      title: "Colour",
      required: false,
      input: { kind: "text" },
    },
  ]
  const asked = play(
    event("question.asked", {
      item: "q",
      turn: "u",
      title: "Which colour?",
      choices: [{ id: "accept", name: "Submit", allows: true }],
      form,
    })
  )
  expect(asked.items[0].body).toMatchObject({ form, state: "open" })
  const answered = apply(
    asked,
    event(
      "question.answered",
      { item: "q", choice: "accept", values: { colour: "Blue" } },
      { author: person }
    )
  )
  expect(answered.items[0].body).toMatchObject({
    state: "answered",
    values: { colour: "Blue" },
  })
})

test("a tool call shows its content and what its command printed", () => {
  const diff = { kind: "diff", path: "a.md", old: "a", new: "b" }
  const state = play(
    event("tool.started", {
      item: "x",
      turn: "u",
      title: "Run",
      tool: "execute",
      status: "running",
      content: [],
    }),
    event("tool.output", { item: "x", text: "one\n", cut: false }),
    event("tool.output", { item: "x", text: "two\n", cut: true }),
    event("tool.changed", { item: "x", status: "done", exit: { code: 0 } }),
    event("tool.changed", { item: "x", content: [diff] })
  )
  expect(state.items[0].body).toEqual({
    kind: "tool",
    title: "Run",
    tool: "execute",
    status: "done",
    content: [diff],
    output: { text: "one\ntwo\n", cut: true, exit: { code: 0 } },
  })
})

test("a notice joins the Thread as its own line", () => {
  const state = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "go" },
      { author: person }
    ),
    event("notice.posted", { item: "n", turn: "u", text: "Starts afresh." })
  )
  expect(state.items.map((i) => i.body)).toEqual([
    { kind: "message", text: "go" },
    { kind: "notice", text: "Starts afresh." },
  ])
})

test("an event already in the view, or one this window does not know, changes nothing", () => {
  const state = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "hi" },
      { author: person }
    )
  )
  const old = { ...event("turn.started", { turn: "u" }), seq: state.at }
  expect(apply(state, old)).toBe(state)
  const newer = apply(
    state,
    event("turn.started", { turn: "u" }, { author: agent, version: 2 })
  )
  expect(newer.turns[0].state).toBe("queued")
  expect(newer.at).toBeGreaterThan(state.at)
  const unknown = apply(state, event("turn.paused", { turn: "u" }))
  expect(unknown.items).toBe(state.items)
})

test("a failed turn's outcome follows the last thing it wrote", () => {
  const state = play(
    event(
      "message.posted",
      { item: "m1", turn: "u1", text: "go" },
      { author: person }
    ),
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "and" },
      { author: person }
    ),
    event("turn.started", { turn: "u1" }),
    event("reply.grew", { item: "r", turn: "u1", text: "Hm" }),
    event("turn.ended", { turn: "u1", state: "failed", reason: "It broke." }),
    event("turn.started", { turn: "u2" }),
    event("turn.ended", { turn: "u2", state: "stopped" })
  )
  expect(
    rows(state).map((row) => (row.kind === "item" ? row.item.id : row.turn.id))
  ).toEqual(["m1", "m2", "u2", "r", "u1"])
})

test("a failed turn is tried again in a new turn, and only the latest can be", () => {
  const failed = play(
    event(
      "message.posted",
      { item: "m", turn: "u1", text: "go" },
      { author: person }
    ),
    event("turn.started", { turn: "u1" }),
    event("turn.ended", {
      turn: "u1",
      state: "failed",
      reason: "Fake needs you to sign in.",
      failure: { class: "sign_in" },
    })
  )
  expect(failed.turns[0].failure).toEqual({ class: "sign_in" })
  expect(retryable(failed, failed.turns[0])).toBe(true)

  const again = apply(
    failed,
    event("turn.queued", { turn: "u2", message: "m" }, { author: person })
  )
  expect(working(again)?.id).toBe("u2")
  expect(retryable(again, again.turns[0])).toBe(false)
  const state = [
    event("turn.started", { turn: "u2" }),
    event("reply.grew", { item: "r", turn: "u2", text: "Done." }),
    event("turn.ended", { turn: "u2", state: "done" }),
  ].reduce(apply, again)
  expect(
    rows(state).map((row) => (row.kind === "item" ? row.item.id : row.turn.id))
  ).toEqual(["m", "u1", "r"])
  expect(retryable(state, state.turns[1])).toBe(false)
})

test("the Thread's settings and the Harness's offer follow their facts", () => {
  const model = {
    id: "model",
    name: "Model",
    category: "model",
    value: "fast",
    choices: [
      { value: "fast", name: "Fast" },
      { value: "smart", name: "Smart" },
    ],
  }
  const state = play(
    event("thread.offered", {
      thread: "t",
      offer: { options: [model], plans: true },
    }),
    event("thread.configured", {
      thread: "t",
      settings: { mode: "supervised", plan: true, options: {} },
    })
  )
  expect(state.offer.plans).toBe(true)
  expect(state.settings.mode).toBe("supervised")
  expect(chosen(state.settings, model)).toBe("fast")
  const smart = choose(state.settings, "model", "smart")
  expect(chosen(smart, model)).toBe("smart")
  expect(smart.mode).toBe("supervised")
})

test("an Agent's plan is one item its steps change, and the context follows", () => {
  const steps = (...states: string[]) =>
    states.map((state, at) => ({ text: `Step ${at}`, state }))
  const state = play(
    event("plan.made", {
      item: "p",
      turn: "u",
      steps: steps("in_progress", "pending"),
    }),
    event("plan.changed", { item: "p", steps: steps("done", "in_progress") }),
    event("thread.used", { thread: "t", usage: { used: 500, size: 1000 } })
  )
  expect(state.items.map((i) => i.body)).toEqual([
    { kind: "plan", steps: steps("done", "in_progress") },
  ])
  expect(state.usage).toEqual({ used: 500, size: 1000 })
})
