import type { Item, Subagent } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { agent, subagent } from "../testing"
import {
  askedOf,
  headOf,
  laneThread,
  litOf,
  pathOf,
  shortTitle,
  statusOf,
  statusWords,
  upOf,
} from "./beside"
import type { LaneState } from "./live-lane"
import type { Followed } from "./live-thread"
import { EMPTY } from "./state"

/** A sub-agent of turn `u`, started at 1 s. */
const lane = (id: string, more: Partial<Subagent> = {}): Subagent =>
  subagent(id, { started: 1000, ...more })

const reviewer = lane("r", { role: "Reviewer", title: "Review card.ts" })
const general = lane("g", { role: "general-purpose", title: "Fix the dots" })
const explore = lane("e", {
  role: "Explore",
  title: "Find b.txt",
  parent: "g",
})
const deep = lane("d", { role: "Explore", title: "Look", parent: "e" })
const lanes = [reviewer, general, explore, deep]

const TITLE = "Make the sidebar card calm"
const words = (one: Subagent, model?: string) =>
  statusWords(statusOf(one, lanes, { model, short: "Claude" }))

test("a top-level sub-agent's header names it and its Thread", () => {
  expect(headOf("t", reviewer, lanes, TITLE)).toEqual({
    look: "working",
    label: "Reviewer",
    of: `sub-agent of ${TITLE}`,
  })
  // A general-purpose one by its title; a Thread with no title yet.
  expect(headOf("t", general, lanes, " ")).toEqual({
    look: "working",
    label: "Fix the dots",
    of: "sub-agent of Thread",
  })
})

test("a nested sub-agent's header is a breadcrumb, from its Thread down to its parent", () => {
  const head = headOf("t", deep, lanes, TITLE)
  expect(head.of).toBeUndefined()
  expect(head.label).toBe("Explore")
  // Its role names it: its title says more.
  expect(head.title).toBe("Look")
  expect(head.crumbs).toEqual([
    { words: "Make the sidebar", to: "thread" },
    { words: "Fix the dots", to: { thread: "t", sub: "g" } },
    { words: "Explore", to: { thread: "t", sub: "e" } },
  ])
  // One named by its title says it once.
  const titled = lane("x", { title: "Count the rows", parent: "r" })
  const nested = headOf("t", titled, [...lanes, titled], TITLE)
  expect(nested.label).toBe("Count the rows")
  expect(nested.title).toBeUndefined()
  // A sub-agent above it that its Thread no longer has.
  const orphan = lane("o", { title: "Look", parent: "gone" })
  expect(headOf("t", orphan, [orphan], TITLE).crumbs).toEqual([
    { words: "Make the sidebar", to: "thread" },
    { words: "Sub-agent", to: { thread: "t", sub: "gone" } },
  ])
})

test("a Codex sub-agent is named by its number, and its Harness asked it", () => {
  const first = lane("c1", { title: "Agent" })
  const second = lane("c2", { title: "Agent 0a1b2c3d" })
  const codex = [first, second]
  expect(headOf("t", first, codex, "Ship").label).toBe("Agent 1")
  expect(headOf("t", second, codex, "Ship").label).toBe("Agent 2")
  expect(askedOf(second, codex, "Codex")).toEqual({ words: "Codex asked" })
  // No role: nothing after its state but how it stands.
  expect(statusWords(statusOf(second, codex, { short: "Codex" }))).toBe(
    "Working · Runs on its own"
  )
})

test("a nested sub-agent was asked by its parent, by that one's satellite", () => {
  expect(askedOf(reviewer, lanes, "Claude")).toEqual({ words: "Claude asked" })
  expect(
    askedOf(explore, [...lanes.slice(0, 1), { ...general, state: "done" }], "C")
  ).toEqual({ words: "Fix the dots asked", look: "done" })
  // A parent its Thread no longer has: its Harness asked, as far as Banda
  // knows.
  expect(askedOf(explore, [explore], "Claude")).toEqual({
    words: "Claude asked",
  })
})

test("its status bar names no role, and a model not its Thread's", () => {
  // A role is its label already; Claude's default role is no role.
  expect(words(reviewer)).toBe("Working · Runs on its own")
  expect(words(general)).toBe("Working · Runs on its own")
  expect(
    words({ ...general, state: "done", ended: 3000, model: "Haiku 5.5" })
  ).toBe("Done · Haiku 5.5 · 2s")
  const haiku = { ...reviewer, model: "Haiku 5.5" }
  expect(words(haiku, "Opus 5.5")).toBe("Working · Haiku 5.5 · Runs on its own")
  expect(words(haiku, "Haiku 5.5")).toBe("Working · Runs on its own")
})

test("its status bar says how each state stands, with a still duration", () => {
  const done = { ...reviewer, state: "done" as const, ended: 126_000 }
  expect(words({ ...done, report: "All good." })).toBe(
    "Done · 2m 05s · Returned its answer to Claude"
  )
  // No answer heard: it says only how long it took.
  expect(words(done)).toBe("Done · 2m 05s")
  // A nested one answered the sub-agent that started it.
  expect(
    words({ ...explore, state: "done", ended: 3000, report: "bravo" })
  ).toBe("Done · 2s · Returned its answer to Fix the dots")
  expect(
    words({ ...reviewer, state: "failed", why: "It ran out of tokens" })
  ).toBe("Failed · It ran out of tokens")
  expect(words({ ...reviewer, state: "failed" })).toBe("Failed")
  expect(words({ ...reviewer, state: "stopped" })).toBe("Stopped")
  expect(words({ ...reviewer, state: "stopped", why: "Its turn ended" })).toBe(
    "Stopped · Its turn ended"
  )
  expect(
    words({ ...reviewer, state: "lost", why: "Banda restarted while it ran" })
  ).toBe("Lost · Banda restarted while it ran")
  const asks = statusOf({ ...reviewer, state: "asks" }, lanes, {
    short: "Claude",
  })
  expect(asks).toEqual({ look: "asks", word: "Asks", rest: [] })
  expect(statusOf(done, lanes, { short: "Claude" }).look).toBe("done")
})

test("up and the lit row walk one sub-agent tree, by its parents", () => {
  expect(upOf("t", deep)).toEqual({ thread: "t", sub: "e" })
  expect(upOf("t", explore)).toEqual({ thread: "t", sub: "g" })
  // Esc at the top does nothing new.
  expect(upOf("t", general)).toBeUndefined()
  // Its Thread lights the row it went from, however deep.
  expect([general, explore, deep].map((one) => litOf(one, lanes))).toEqual([
    "g",
    "g",
    "g",
  ])
  expect(litOf(reviewer, lanes)).toBe("r")
})

test("a path stops at a parent its Thread does not have, and at a loop", () => {
  expect(pathOf(lane("x", { parent: "gone" }), lanes)).toEqual(["gone"])
  const a = lane("a", { parent: "b" })
  const b = lane("b", { parent: "a" })
  expect(pathOf(a, [a, b])).toEqual(["b"])
  expect(pathOf(reviewer, lanes)).toEqual([])
})

test("a breadcrumb keeps the first words of its Thread's title", () => {
  expect(shortTitle("Make the sidebar card calm")).toBe("Make the sidebar")
  expect(shortTitle("  Fix  it ")).toBe("Fix it")
  expect(shortTitle("")).toBe("Thread")
})

/** A call that runs. */
const call = (id: string): Item => ({
  id,
  turn: "u",
  author: agent,
  at: 0,
  body: {
    kind: "tool",
    title: "Read card.ts",
    tool: "read",
    status: "running",
    content: [],
  },
})

test("a lane draws as a Thread of one turn, which nobody may stop or edit", () => {
  const thread: Followed = {
    ...EMPTY,
    title: TITLE,
    harness: "claude",
    items: [call("own")],
    turns: [
      {
        id: "u",
        message: "m",
        state: "running",
        started: 0,
        can: {
          stop: true,
          retry: true,
          edit: true,
          withdraw: true,
          steer: true,
          fork: true,
          rewind: true,
        },
      },
    ],
    subagents: [reviewer],
    held: true,
  }
  const child = lane("k", { parent: "r", title: "Count" })
  const read: LaneState = {
    at: 9,
    thread: "t",
    subagent: reviewer,
    items: [call("c")],
    subagents: [child],
  }
  const drawn = laneThread(thread, read)
  expect(drawn.title).toBe(TITLE)
  expect(drawn.harness).toBe("claude")
  expect(drawn.at).toBe(9)
  expect(drawn.items.map((item) => item.id)).toEqual(["c"])
  expect(drawn.held).toBe(false)
  expect(drawn.turns).toHaveLength(1)
  const [turn] = drawn.turns
  expect(turn).toMatchObject({ id: "u", state: "running", started: 1000 })
  expect(Object.values(turn!.can).some(Boolean)).toBe(false)
  // The child the lane's own read knows, before its Thread's facts do.
  expect(drawn.subagents.map((one) => one.id)).toEqual(["r", "k"])

  // Nothing new came: what it draws is the same.
  const again = laneThread(thread, { ...read, at: 10 })
  expect(again.turns).toBe(drawn.turns)
  const knows = { ...thread, subagents: [reviewer, child] }
  expect(laneThread(knows, read).subagents).toBe(knows.subagents)

  // Stopped, its calls say so as its row's do (`turnStateOf`).
  const stopped = laneThread(thread, {
    ...read,
    subagent: { ...reviewer, state: "stopped", ended: 5000 },
  })
  expect(stopped.turns[0]).toMatchObject({ state: "stopped", ended: 5000 })
  const done = laneThread(thread, {
    ...read,
    subagent: { ...reviewer, state: "done", ended: 5000 },
  })
  expect(done.turns[0]?.state).toBe("done")
})
