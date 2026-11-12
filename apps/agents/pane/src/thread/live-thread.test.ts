import type { Engine, ProjectId } from "@banda/contract"
import type { Item, ThreadView } from "@banda/contract/agents"
import { afterEach, expect, test, vi } from "vitest"
import { agent, event, person, subagent as lane } from "../testing"
import { type Followed, follow, readThread } from "./live-thread"
import { EMPTY } from "./state"

afterEach(() => {
  vi.restoreAllMocks()
})

/** An engine whose Thread holds entries of these kinds, by their IDs. */
function engineWith(kinds: Record<string, string>): Engine {
  const items = Object.entries(kinds).map(
    ([id, kind]) =>
      ({
        id,
        author: agent,
        at: 0,
        body: { kind, text: "" },
      }) as unknown as Item
  )
  const view: ThreadView = {
    at: 0,
    thread: { title: "", harness: "fake" } as ThreadView["thread"],
    items,
    turns: [],
    settings: EMPTY.settings,
    offer: EMPTY.offer,
    held: false,
  }
  return { call: async () => view } as unknown as Engine
}

const project = "p" as ProjectId

test("a read that left entries out says so once in the window's log, naming their kinds", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const engine = engineWith({
    a: "reminder",
    m: "message",
    b: "poll",
    c: "reminder",
  })
  const read = await readThread(engine, project, "t")
  expect(read.items.map((item) => item.id)).toEqual(["m"])
  expect(warned.mock.calls).toEqual([
    [
      "agents: left out entries of kinds this window does not know: reminder, poll",
    ],
  ])
})

test("a read that left nothing out says nothing", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const read = await readThread(engineWith({ m: "message" }), project, "t")
  expect(read.items.map((item) => item.id)).toEqual(["m"])
  expect(warned).not.toHaveBeenCalled()
})

const fence = { fence: "missing", why: "off", words: "BANDA_FENCE=off" }

test("a turn Banda kept Supervised says why and when, which the Person's next choice keeps", () => {
  const said = event("thread.configured", {
    thread: "t",
    settings: { mode: "supervised", options: {} },
    supervised: { before: true, fence },
  })
  const kept = follow(EMPTY, said)
  expect(kept.settings.mode).toBe("supervised")
  expect(kept.supervised).toEqual({ before: true, fence, at: said.at })
  const chosen = follow(
    kept,
    event("thread.configured", {
      thread: "t",
      settings: { mode: "full_access", options: {} },
    })
  )
  expect(chosen.settings.mode).toBe("full_access")
  expect(chosen.supervised).toEqual(kept.supervised)
  // What the Pane already followed is not heard again.
  expect(follow(chosen, said)).toBe(chosen)
})

const call = (item: string, sub?: string, tool = "execute") =>
  event("tool.started", {
    item,
    turn: "u",
    ...(sub && { sub }),
    title: `pnpm ${item}`,
    tool,
    status: "running",
    content: [],
  })

test("follow keeps each sub-agent's latest entry, which a change by ID reaches", () => {
  const followed = [
    event("subagent.started", { item: "s", subagent: lane("a") }),
    event("subagent.started", { item: "z", subagent: lane("b") }),
    event("thought.grew", { item: "t", turn: "u", sub: "a", text: "Hm" }),
    call("c", "b"),
    event("thought.grew", { item: "t", turn: "u", sub: "a", text: "m" }),
    // The Agent's own call is not a sub-agent's.
    call("own"),
  ].reduce(follow, EMPTY as Followed)
  expect(followed.heard?.get("a")?.body).toEqual({
    kind: "thought",
    text: "Hmm",
  })
  expect(followed.heard?.get("b")?.id).toBe("c")
  expect(followed.heard?.size).toBe(2)

  const changed = [
    event("tool.output", { item: "c", text: "ok\n", cut: false }),
    event("tool.changed", { item: "c", status: "done" }),
  ].reduce(follow, followed)
  expect(changed.heard?.get("b")?.body).toMatchObject({
    kind: "tool",
    status: "done",
    output: { text: "ok\n", cut: false },
  })
  // What the other one did stays as it was.
  expect(changed.heard?.get("a")).toBe(followed.heard?.get("a"))
  // Its next call is its latest.
  const next = follow(changed, call("d", "b"))
  expect(next.heard?.get("b")?.id).toBe("d")

  // The Thread's checkpoints never see it.
  expect(next.items.map((item) => item.id)).toEqual(["s", "z", "own"])
})

test("a rewind forgets what was heard of the sub-agents it takes", () => {
  const begun = (item: string, turn: string) => [
    event(
      "message.posted",
      { item, turn, text: "go", images: [] },
      { author: person }
    ),
    event("turn.started", { turn }),
  ]
  const heard = [
    ...begun("m", "u"),
    event("subagent.started", { item: "s", subagent: lane("a") }),
    call("c", "a"),
    ...begun("m2", "v"),
    event("subagent.started", {
      item: "s2",
      subagent: lane("b", { turn: "v" }),
    }),
    call("d", "b"),
  ].reduce(follow, EMPTY as Followed)
  expect([...(heard.heard?.keys() ?? [])]).toEqual(["a", "b"])
  const rewound = follow(
    heard,
    event("thread.rewound", { thread: "t", turn: "v" })
  )
  expect([...(rewound.heard?.keys() ?? [])]).toEqual(["a"])
  expect(rewound.heard?.get("a")).toBe(heard.heard?.get("a"))
})

test("a sub-agent that ends, or changes to an end, is forgotten; its Question is not its work", () => {
  const heard = [
    event("subagent.started", { item: "s", subagent: lane("a") }),
    event("subagent.started", { item: "z", subagent: lane("b") }),
    call("c", "a"),
    call("d", "b"),
    event("question.asked", {
      item: "q",
      turn: "u",
      sub: "a",
      title: "Allow pnpm c?",
      choices: [],
    }),
  ].reduce(follow, EMPTY as Followed)
  expect(heard.heard?.get("a")?.id).toBe("c")
  const ended = follow(
    heard,
    event("subagent.ended", {
      subagent: "a",
      turn: "u",
      state: "done",
      ended: 9,
    })
  )
  expect([...(ended.heard?.keys() ?? [])]).toEqual(["b"])
  const stopped = follow(
    ended,
    event("subagent.changed", { subagent: "b", state: "stopped" })
  )
  expect(stopped.heard?.size).toBe(0)
})
