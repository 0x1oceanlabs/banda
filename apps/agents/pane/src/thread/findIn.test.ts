import { expect, test } from "vitest"
import { event, person } from "../testing"
import { apply, EMPTY } from "./state"
import { holds } from "./findIn"
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
