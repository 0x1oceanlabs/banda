import type { Event } from "@bandaso/contract"
import type { TurnView } from "@bandaso/contract/agents"
import { expect, test } from "vitest"
import { event, person } from "./testing"
import { apply, EMPTY } from "./thread"
import { duration, foldTitle, type Line, summary, timeline } from "./timeline"

function play(...events: Event[]) {
  return events.reduce(apply, EMPTY)
}

const asked = (turn = "u", item = "m") =>
  event(
    "message.posted",
    { item, turn, text: "hi", images: [] },
    { author: person }
  )

const tool = (item: string, tool = "execute", turn = "u") =>
  event("tool.started", {
    item,
    turn,
    title: `Tool ${item}`,
    tool,
    status: "running",
    content: [],
  })

const reply = (item: string, turn = "u") =>
  event("reply.grew", { item, turn, text: "Done." })

/** Each line as a short word, a fold or a line of work with what it holds. */
function shape(lines: Line[]): unknown[] {
  return lines.map((line) => {
    switch (line.kind) {
      case "item":
        return line.item.id
      case "work":
        return { work: line.items.map((item) => item.id), live: line.live }
      case "fold":
        return { fold: shape(line.lines) }
      case "working":
        return "working"
      case "ended":
        return `ended ${line.turn.state}`
      case "changes":
        return { changes: line.files.map((file) => file.path) }
    }
  })
}

test("tool calls and thoughts in a row are one line of work", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Hm" }),
    tool("a"),
    tool("b", "edit"),
    reply("r"),
    tool("c")
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    "working",
    { work: ["t", "a", "b"], live: false },
    "r",
    // A single tool call shows itself.
    "c",
  ])
})

test("the work at the end of the turn that runs is live", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    tool("b")
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    "working",
    { work: ["a", "b"], live: true },
  ])
})

test("a turn that ended folds its work, and its last reply stays", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    reply("r1"),
    tool("b"),
    tool("c"),
    reply("r2"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: ["a", "r1", { work: ["b", "c"], live: false }] },
    "r2",
  ])
})

test("a turn with no work, or one that failed, does not fold", () => {
  const plain = play(
    asked(),
    event("turn.started", { turn: "u" }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(plain))).toEqual(["m", "r"])
  const failed = play(
    asked("v", "n"),
    event("turn.started", { turn: "v" }),
    tool("a", "execute", "v"),
    tool("b", "execute", "v"),
    event("turn.ended", { turn: "v", state: "failed" })
  )
  expect(shape(timeline(failed))).toEqual([
    "n",
    { work: ["a", "b"], live: false },
    "ended failed",
  ])
})

test("a stopped turn folds and still says it stopped", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a"),
    tool("b"),
    event("turn.ended", { turn: "u", state: "stopped" })
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: [{ work: ["a", "b"], live: false }] },
    "ended stopped",
  ])
})

test("a line of work names its two largest kinds", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    tool("a", "edit"),
    tool("b"),
    tool("c"),
    tool("d", "read"),
    tool("e", "execute")
  )
  const items = state.items.filter((item) => item.body.kind === "tool")
  expect(summary(items)).toBe("Ran 3 commands, edited a file and 1 more")
  expect(summary(items.slice(0, 3))).toBe("Ran 2 commands and edited a file")
})

test("a duration reads as a clock would", () => {
  expect(duration(12_400)).toBe("12s")
  expect(duration(65_000)).toBe("1m 05s")
  expect(duration(2 * 3600_000 + 3 * 60_000)).toBe("2h 03m")
})

test("a folded turn says how long it took, or that a Person stopped it", () => {
  const turn: TurnView = { id: "u", message: "m", state: "done" }
  expect(foldTitle({ ...turn, started: 0, ended: 65_000 })).toBe(
    "Worked for 1m 05s"
  )
  expect(foldTitle(turn)).toBe("Worked")
  expect(
    foldTitle({ ...turn, state: "stopped", started: 0, ended: 8000 })
  ).toBe("You stopped after 8s")
})

test("a turn that ended and changed files says which, after its reply", () => {
  const state = play(
    asked(),
    event("turn.started", { turn: "u" }),
    event("tool.started", {
      item: "e",
      turn: "u",
      title: "Edit a.md",
      tool: "edit",
      status: "done",
      content: [{ kind: "diff", path: "/a.md", old: "one\n", new: "two\n" }],
    }),
    reply("r"),
    event("turn.ended", { turn: "u", state: "done" })
  )
  expect(shape(timeline(state))).toEqual([
    "m",
    { fold: ["e"] },
    "r",
    { changes: ["/a.md"] },
  ])
})
