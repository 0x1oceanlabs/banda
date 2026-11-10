import { expect, test } from "vitest"
import { emblemColour, emblemOf, type EmblemOf, iconGroupsOf } from "./emblem"

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

test("an account picks its Harness's own icons and the neutral ones, which the engine takes", () => {
  const groups = (harness: string) =>
    iconGroupsOf(harness).map(({ group, icons }) => [group, icons.length])
  expect(groups("claude")).toEqual([
    ["Its own", 2],
    ["Whose", 4],
    ["What for", 2],
    ["How it runs", 5],
  ])
  expect(iconGroupsOf("codex")[0]!.icons).toEqual(["codex", "chatgpt"])
  expect(groups("opencode").map(([group]) => group)).toEqual([
    "Whose",
    "What for",
    "How it runs",
  ])
  // Fifteen icons in all (decision 4).
  const all = new Set(
    ["claude", "codex"].flatMap((h) => iconGroupsOf(h).flatMap((g) => g.icons))
  )
  expect(all.size).toBe(15)
})
