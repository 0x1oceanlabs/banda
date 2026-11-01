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
  running,
  steerable,
  waiting,
  working,
} from "./thread"

function play(...events: Event[]) {
  return events.reduce(apply, EMPTY)
}

test("a turn's facts build the Thread a Person reads", () => {
  const state = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "hi", images: [] },
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
    ["m", "person", { kind: "message", text: "hi", images: [] }],
    ["t", "agent", { kind: "thought", text: "Hm" }],
    ["r", "agent", { kind: "message", text: "Hello", images: [] }],
    [
      "x",
      "agent",
      { kind: "tool", title: "Run", tool: "execute", status: "done" },
    ],
  ])
  const [turn] = state.turns
  expect(turn).toMatchObject({ id: "u", message: "m", state: "done" })
  // It ran from its start to its end, as the log's times say.
  expect(turn.started).toBeLessThan(turn.ended!)
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
      { item: "m", turn: "u", text: "hi", images: [] },
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

test("a failed turn's outcome follows the last thing it wrote, and a message reads where its turn started", () => {
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
  ).toEqual(["m1", "r", "u1", "m2", "u2"])
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
      offer: {
        options: [model],
        plans: true,
        slash_commands: [],
        no_images: false,
      },
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

const ids = (state: ReturnType<typeof play>) =>
  rows(state).map((row) => (row.kind === "item" ? row.item.id : row.turn.id))

/** A Thread whose turn `u1` runs and has said "Waiting.", then `more`,
 * made after it so the log's order holds. */
function aTurnRuns(more: () => Event[] = () => []) {
  const base = play(
    event(
      "message.posted",
      { item: "m1", turn: "u1", text: "wait" },
      { author: person }
    ),
    event("turn.started", { turn: "u1" }),
    event("reply.grew", { item: "r1", turn: "u1", text: "Waiting." })
  )
  return more().reduce(apply, base)
}

test("a message sent into a running turn reads where it was sent", () => {
  const state = aTurnRuns(() => [
    event(
      "message.steered",
      { item: "s", turn: "u1", text: "also this", images: [] },
      { author: person }
    ),
    event("reply.grew", { item: "r2", turn: "u1", text: "Steered." }),
    event("turn.ended", { turn: "u1", state: "done" }),
  ])
  expect(ids(state)).toEqual(["m1", "r1", "s", "r2"])
  expect(state.items.find((i) => i.id === "s")?.turn).toBe("u1")
  expect(state.turns).toHaveLength(1)
})

test("a waiting message shows after the Thread until its turn starts", () => {
  const queued = aTurnRuns(() => [
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "second" },
      { author: person }
    ),
    event(
      "message.posted",
      { item: "m3", turn: "u3", text: "third" },
      { author: person }
    ),
  ])
  expect(running(queued)?.id).toBe("u1")
  expect(waiting(queued).map(({ item }) => item.id)).toEqual(["m2", "m3"])
  expect(ids(queued)).toEqual(["m1", "r1"])

  const changed = [
    event(
      "message.edited",
      { item: "m2", text: "second, changed" },
      { author: person }
    ),
    event("turn.ended", { turn: "u3", state: "withdrawn" }),
  ].reduce(apply, queued)
  expect(waiting(changed).map(({ item }) => item.body)).toEqual([
    { kind: "message", text: "second, changed" },
  ])
  expect(ids(changed)).toEqual(["m1", "r1"])

  const started = [
    event("turn.ended", { turn: "u1", state: "done" }),
    event("turn.started", { turn: "u2" }),
  ].reduce(apply, changed)
  expect(waiting(started)).toEqual([])
  expect(ids(started)).toEqual(["m1", "r1", "m2"])
})

test("a held queue works on nothing until a Person lets it go", () => {
  const stopped = aTurnRuns(() => [
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "second" },
      { author: person }
    ),
    event("thread.held", { thread: "t", held: true }, { author: person }),
    event("turn.ended", { turn: "u1", state: "stopped" }),
  ])
  expect(stopped.held).toBe(true)
  expect(working(stopped)).toBeUndefined()
  expect(waiting(stopped).map(({ turn }) => turn.id)).toEqual(["u2"])
  const resumed = apply(
    stopped,
    event("thread.held", { thread: "t", held: false }, { author: person })
  )
  expect(working(resumed)?.id).toBe("u2")
})

test("a waiting message sent now joins the running turn", () => {
  const state = aTurnRuns(() => [
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "now this" },
      { author: person }
    ),
    event("reply.grew", { item: "r1", turn: "u1", text: " Still." }),
    event("turn.ended", { turn: "u2", state: "withdrawn" }),
    event(
      "message.steered",
      { item: "m2", turn: "u1", text: "now this", images: [] },
      { author: person }
    ),
  ])
  expect(waiting(state)).toEqual([])
  expect(ids(state)).toEqual(["m1", "r1", "m2"])
})

test("a message its turn could not take waits for a turn of its own", () => {
  const state = aTurnRuns(() => [
    event(
      "message.steered",
      { item: "s", turn: "u1", text: "late", images: [] },
      { author: person }
    ),
    event("turn.ended", { turn: "u1", state: "done" }),
    event("turn.queued", { turn: "u2", message: "s" }, { author: person }),
  ])
  expect(state.items.find((i) => i.id === "s")?.turn).toBeUndefined()
  expect(waiting(state).map(({ item }) => item.id)).toEqual(["s"])
  expect(ids(state)).toEqual(["m1", "r1"])
})

test("a message sent now that its turn could not take waits again", () => {
  const state = aTurnRuns(() => [
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "now this" },
      { author: person }
    ),
    event("turn.ended", { turn: "u2", state: "withdrawn" }),
    event(
      "message.steered",
      { item: "m2", turn: "u1", text: "now this", images: [] },
      { author: person }
    ),
    event("turn.ended", { turn: "u1", state: "done" }),
    event("turn.queued", { turn: "u3", message: "m2" }, { author: person }),
  ])
  expect(waiting(state).map(({ turn }) => turn.id)).toEqual(["u3"])
  expect(ids(state)).toEqual(["m1", "r1"])
})

test("a failed turn can go again past messages that wait or were taken back", () => {
  const failed = play(
    event(
      "message.posted",
      { item: "m1", turn: "u1", text: "first" },
      { author: person }
    ),
    event(
      "message.posted",
      { item: "m2", turn: "u2", text: "second" },
      { author: person }
    ),
    event(
      "message.posted",
      { item: "m3", turn: "u3", text: "third" },
      { author: person }
    ),
    event("turn.started", { turn: "u1" }),
    event("turn.ended", { turn: "u1", state: "failed" }),
    event("thread.held", { thread: "t", held: true }),
    event("turn.ended", { turn: "u3", state: "withdrawn" })
  )
  const u1 = failed.turns[0]
  expect(retryable(failed, u1)).toBe(true)
  const again = apply(
    failed,
    event("turn.queued", { turn: "u4", message: "m1" }, { author: person })
  )
  expect(retryable(again, u1)).toBe(false)
})

test("what the Agent does by itself is a turn its notice starts", () => {
  const goes = play(
    event(
      "message.posted",
      { item: "m1", turn: "u1", text: "start a task" },
      { author: person }
    ),
    event("turn.started", { turn: "u1" }),
    event("reply.grew", { item: "r1", turn: "u1", text: "Started." }),
    event("turn.ended", { turn: "u1", state: "done" }),
    event("notice.posted", { item: "n", turn: "u2", text: "Writer went on." }),
    event("turn.queued", { turn: "u2", message: "n" }),
    event("turn.started", { turn: "u2" }),
    event("reply.grew", { item: "r2", turn: "u2", text: "Found it." })
  )
  const own = goes.turns[1]
  expect(ids(goes)).toEqual(["m1", "r1", "n", "r2"])
  expect(waiting(goes)).toEqual([])
  expect(running(goes)?.id).toBe("u2")
  expect(steerable(goes)).toBe(false)
  const cut = apply(
    goes,
    event("turn.ended", { turn: "u2", state: "interrupted" })
  )
  expect(retryable(cut, cut.turns[1])).toBe(false)
  expect(own.message).toBe("n")
})
