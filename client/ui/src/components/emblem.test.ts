import { expect, test } from "vitest"
import { emblemColour, emblemOf, type EmblemOf } from "./emblem"

const work: EmblemOf = {
  id: "work",
  name: "Work",
  harness: "claude",
  mark: "W",
  icon: "work",
  colour: 2,
}

test("an emblem's own colour is Claude's orange behind Claude's icons, else the text's", () => {
  expect(emblemColour({ icon: "claude-code", colour: 0 })).toBe(
    "var(--account-claude)"
  )
  expect(emblemColour({ icon: "claude", colour: 0 })).toBe(
    "var(--account-claude)"
  )
  expect(emblemColour({ icon: "codex", colour: 0 })).toBe("var(--account-own)")
  expect(emblemColour({ icon: "work", colour: 0 })).toBe("var(--account-own)")
  expect(emblemColour({ colour: 0 })).toBe("var(--account-own)")
  expect(emblemColour({ icon: "claude-code", colour: 4 })).toBe(
    "var(--account-4)"
  )
})

test("an entry the list has is its own; one it has not is its Harness's", () => {
  expect(emblemOf([work], "work")).toBe(work)
  expect(emblemOf([work], "claude", "Claude Code")).toEqual({
    id: "claude",
    name: "Claude Code",
    harness: "claude",
    mark: "C",
    icon: "claude-code",
    colour: 0,
  })
  expect(emblemOf([], "codex").icon).toBe("codex")
  const other = emblemOf([], "opencode", "  open code")
  expect([other.icon, other.mark, other.colour]).toEqual([undefined, "O", 0])
})
