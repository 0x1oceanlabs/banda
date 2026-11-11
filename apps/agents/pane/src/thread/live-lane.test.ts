import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Event } from "@banda/contract"
import type { SubagentView } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { event, person, subagent as lane } from "../testing"
import { didWords } from "./timeline"
import {
  applyLane,
  fromSubagentView,
  laneDid,
  type LaneState,
  workOfLane,
} from "./live-lane"

/** Sub-agent `a` as its row opened in place first reads it. */
const read: SubagentView = {
  at: 0,
  thread: "t",
  subagent: lane("a"),
  items: [],
  subagents: [],
}

const call = (item: string, sub?: string, tool = "read") =>
  event("tool.started", {
    item,
    turn: "u",
    ...(sub && { sub }),
    title: `Read ${item}.ts`,
    tool,
    status: "running",
    content: [],
  })

test("a lane follows only its own entries, its Questions and the sub-agents it starts", () => {
  const followed = [
    call("c", "a"),
    // Another sub-agent's, and the Agent's own.
    call("x", "b"),
    call("own"),
    event("reply.grew", { item: "r", turn: "u", text: "Mine" }),
    event("tool.changed", { item: "c", status: "done" }),
    event("tool.changed", { item: "x", status: "failed" }),
    event("thought.grew", { item: "t", turn: "u", sub: "a", text: "Hm" }),
    event("thought.grew", { item: "t", turn: "u", sub: "a", text: "m" }),
    event("question.asked", {
      item: "q",
      turn: "u",
      sub: "a",
      title: "Allow pnpm vitest?",
      choices: [],
    }),
    event("question.asked", {
      item: "p",
      turn: "u",
      title: "Allow the Agent?",
      choices: [],
    }),
    event("question.answered", { item: "q", choice: "yes" }),
    event("subagent.started", {
      item: "s",
      subagent: lane("k", { parent: "a" }),
    }),
    // Its sub-agent's own, and another's sub-agent.
    call("y", "k"),
    event("subagent.started", {
      item: "w",
      subagent: lane("j", { parent: "b" }),
    }),
    event("subagent.changed", { subagent: "a", title: "Map the keys" }),
    event("subagent.ended", {
      subagent: "k",
      turn: "u",
      state: "done",
      ended: 5,
    }),
    event("subagent.ended", {
      subagent: "b",
      turn: "u",
      state: "done",
      ended: 6,
    }),
  ].reduce(applyLane, fromSubagentView(read))

  expect(followed.items.map((item) => [item.id, item.body.kind])).toEqual([
    ["c", "tool"],
    ["t", "thought"],
    ["q", "question"],
    ["s", "subagent"],
  ])
  expect(followed.items[0].body).toMatchObject({ status: "done" })
  expect(followed.items[1].body).toEqual({ kind: "thought", text: "Hmm" })
  expect(followed.items[2].body).toMatchObject({
    sub: "a",
    state: "answered",
    answer: "yes",
  })
  expect(followed.items[3]).toMatchObject({
    turn: "u",
    author: { kind: "agent" },
  })
  expect(followed.subagent).toMatchObject({
    title: "Map the keys",
    state: "running",
  })
  expect(followed.subagents).toEqual([
    { ...lane("k", { parent: "a" }), state: "done", ended: 5, can_stop: false },
  ])

  const ended = applyLane(
    followed,
    event("subagent.ended", {
      subagent: "a",
      turn: "u",
      state: "done",
      report: "Read in 3 places",
      ended: 9,
    })
  )
  expect(ended.subagent).toMatchObject({
    state: "done",
    ended: 9,
    can_stop: false,
    report: "Read in 3 places",
  })
  // What it already followed is not heard again.
  const last = event("subagent.changed", { subagent: "a", title: "Again" })
  const once = applyLane(ended, last)
  expect(applyLane(once, last)).toBe(once)
  // A Person's message is no entry of it.
  const said = event(
    "message.posted",
    { item: "m", turn: "v", text: "hi", images: [] },
    { author: person }
  )
  expect(applyLane(once, said).items).toBe(once.items)
})

test("what its parent wrote after the brief comes in its lane where it came, given again whole", () => {
  const messaged = (more: Record<string, unknown>) =>
    event("subagent.messaged", { item: "w", turn: "u", subagent: "a", ...more })
  const followed = [
    call("c", "a"),
    // The row where it was sent, in its Thread: not the lane's own.
    messaged({ item: "r", text: "Read it" }),
    messaged({ sub: "a", text: "Read it" }),
    messaged({ sub: "a", text: "Read it once more." }),
    call("d", "a"),
  ].reduce(applyLane, fromSubagentView(read))
  expect(followed.items.map((item) => item.id)).toEqual(["c", "w", "d"])
  expect(followed.items[1].body).toEqual({
    kind: "messaged",
    subagent: "a",
    text: "Read it once more.",
  })
})

test("its work line counts its own calls and thoughts, and while it works only those that ended", () => {
  const working = [
    call("a", "a"),
    event("tool.changed", { item: "a", status: "done" }),
    call("b", "a"),
    call("x", "b"),
    call("e", "a", "execute"),
    event("tool.changed", { item: "e", status: "done" }),
  ].reduce(applyLane, fromSubagentView(read))
  expect(workOfLane(working).map((item) => item.id)).toEqual(["a", "b", "e"])
  expect(didWords(laneDid(working))).toBe("ran a command")
  const done = applyLane(
    working,
    event("subagent.ended", {
      subagent: "a",
      turn: "u",
      state: "done",
      ended: 9,
    })
  )
  expect(didWords(laneDid(done))).toBe("ran a command")
  expect(laneDid(done).kinds).toHaveLength(1)
  const looked = { ...done, items: done.items.slice(0, 2) } as LaneState
  expect(didWords(laneDid(looked))).toBe("read 2 files")
})

/**
 * The engine's tests write a sub-agent's checkpoints beside its Thread's
 * when `BANDA_CHECKPOINTS` names a folder, as `scripts/check.sh` does: its
 * view, the facts after it, and the view the engine read then. Following
 * those facts from the first view must give the last one (ADR 0014,
 * decision 3).
 */
type Checkpoint = { start: SubagentView; events: Event[]; end: SubagentView }

const folder =
  process.env.BANDA_CHECKPOINTS && join(process.env.BANDA_CHECKPOINTS, "lanes")
const files =
  folder && existsSync(folder)
    ? readdirSync(folder).filter((file) => file.endsWith(".json"))
    : []

/** The state without its place in the log: the engine's view stands where
 * the whole Project's log stood, the fold where the last fact did. */
function placeless(state: LaneState): LaneState {
  return { ...state, at: 0 }
}

test.skipIf(!folder)("the engine wrote a sub-agent's checkpoints", () => {
  expect(files.length).toBeGreaterThan(0)
})

test.each(files)(
  "facts after a sub-agent's view give the engine's next view: %s",
  (file) => {
    const { start, events, end } = JSON.parse(
      readFileSync(join(folder!, file), "utf8")
    ) as Checkpoint
    const applied = events.reduce(applyLane, fromSubagentView(start))
    expect(placeless(applied)).toEqual(placeless(fromSubagentView(end)))
  }
)
