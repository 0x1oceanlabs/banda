import type { Event } from "@bandaso/contract"
import { expect, test } from "vitest"
import { agent, event, person } from "./testing"
import { EMPTY, apply, rows, working } from "./thread"

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
