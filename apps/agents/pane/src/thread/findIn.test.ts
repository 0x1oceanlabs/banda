import type { Event } from "@banda/contract"
import { expect, test } from "vitest"
import { event, person, subagent as lane } from "../testing"
import { apply, EMPTY } from "./state"
import { holds } from "./findIn"
import { byId } from "./subagents"
import { timeline } from "./timeline"

test("a folded turn holds the words its work shows, in any case", () => {
  const state = [
    event(
      "message.posted",
      { item: "m", turn: "u", text: "hi", images: [] },
      { author: person }
    ),
    event("turn.started", { turn: "u" }),
    event("thought.grew", { item: "t", turn: "u", text: "Read the Notes" }),
    event("tool.started", {
      item: "a",
      turn: "u",
      title: "Run the tests",
      tool: "execute",
      status: "completed",
      content: [],
    }),
    event("reply.grew", { item: "r", turn: "u", text: "Done." }),
    event("turn.ended", { turn: "u", state: "done" }),
  ].reduce(apply, EMPTY)
  const fold = timeline(state).find((line) => line.kind === "fold")!
  expect(holds(fold, "notes")).toBe(true)
  expect(holds(fold, "TESTS")).toBe(true)
  // The reply stays outside the fold.
  expect(holds(fold, "done")).toBe(false)
  expect(holds(fold, "")).toBe(false)
})

test("Find matches a sub-agent row's label, role and report's first line, never its now", () => {
  const play = (...events: Event[]) => events.reduce(apply, EMPTY)
  const state = play(
    event(
      "message.posted",
      { item: "m", turn: "u", text: "hi", images: [] },
      { author: person }
    ),
    event("turn.started", { turn: "u" }),
    event("subagent.started", {
      item: "s",
      subagent: lane("a", {
        title: "Map the keys",
        role: "Explore",
        model: "Haiku 5.5",
      }),
    }),
    event("subagent.started", {
      item: "z",
      subagent: lane("b", { role: "general-purpose", model: "Opus 5.5" }),
    }),
    event("tool.started", {
      item: "c",
      turn: "u",
      sub: "a",
      title: "Read settings.ts",
      tool: "read",
      status: "running",
      content: [],
    })
  )
  const group = timeline(state).find((line) => line.kind === "subagents")!
  const lanes = { byId: byId(state.subagents), model: "Opus 5.5" }
  expect(holds(group, "explore", lanes)).toBe(true)
  expect(holds(group, "MAP THE", lanes)).toBe(true)
  expect(holds(group, "general", lanes)).toBe(true)
  // A model the row names, but not its parent's, which it does not.
  expect(holds(group, "haiku", lanes)).toBe(true)
  expect(holds(group, "opus", lanes)).toBe(false)
  expect(holds(group, "opus", { ...lanes, model: "Sonnet 5.5" })).toBe(true)
  // What it does now is not its words, nor are its entries.
  expect(holds(group, "settings", lanes)).toBe(false)
  // Without its record, a row holds nothing.
  expect(holds(group, "explore")).toBe(false)

  // Done, its report's first line is: read again from its new record.
  const done = apply(
    state,
    event("subagent.ended", {
      subagent: "a",
      turn: "u",
      state: "done",
      report: "Read in **3 places**\nsidebar.ts",
      ended: 9,
    })
  )
  const ended = { byId: byId(done.subagents) }
  const settled = timeline(done).find((line) => line.kind === "subagents")!
  expect(holds(settled, "in 3 places", ended)).toBe(true)
  expect(holds(settled, "sidebar.ts", ended)).toBe(false)
  // The anchor is the same entry; the record changed.
  expect(settled.kind === "subagents" && settled.items[0]).toBe(
    group.kind === "subagents" && group.items[0]
  )
})
