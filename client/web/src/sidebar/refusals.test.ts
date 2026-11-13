import { expect, test } from "vitest"
import type { Listed } from "@banda/ui/pane"
import { leftSaid, refusalOf, setRefusalOf } from "./refusals"

const thread = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "Fix the list",
  mark: "idle",
  changed: 1,
  pane: { kind: "agents.thread", args: { thread: "t1" } },
  ...more,
})

test("S on a card that asks or works says why, with the key in force that puts it off; no other card is refused (spec §2.6)", () => {
  const asks = { stand: "turn" as const, listed: thread({ mark: "asking" }) }
  const works = {
    stand: "working" as const,
    listed: thread({ mark: "working" }),
  }
  const said = (why: ReturnType<typeof refusalOf>) =>
    why && `${why.title} ${why.description}`
  expect(said(refusalOf(asks, "Z"))).toBe(
    "“Fix the list” asks you. Answer it, or Z puts it off."
  )
  expect(said(refusalOf(works, "Shift+L"))).toBe(
    "“Fix the list” is at work. Shift+L puts it off until it's done."
  )
  // With no key for Later, the words name none.
  expect(said(refusalOf(asks, undefined))).toBe(
    "“Fix the list” asks you. Answer it, or put it off."
  )
  expect(said(refusalOf(works, undefined))).toBe(
    "“Fix the list” is at work. Put it off until it's done."
  )
  expect(
    refusalOf({ stand: "turn", listed: thread({ mark: "done" }) }, "Z")
  ).toBeUndefined()
})

test("what an act on several cards left, still selected, and why Archive leaves them all (spec S10b)", () => {
  expect(leftSaid([])).toBeUndefined()
  expect(leftSaid(["asks"])).toBe("1 asks you, still selected")
  expect(
    leftSaid([
      "asks",
      "works",
      "asks",
      "works",
      { away: "mac is away" },
      { away: "mac is away" },
    ])
  ).toBe(
    "2 ask you, 2 are at work, 2 not reached (mac is away), still selected"
  )
  const asks = {
    stand: "turn" as const,
    listed: { title: "A", mark: "asking" as const },
  }
  const works = {
    stand: "working" as const,
    listed: { title: "W", mark: "working" as const },
  }
  expect(setRefusalOf([asks, asks], "Z")).toBe("They ask you. Z puts them off.")
  expect(setRefusalOf([works, works], "Z")).toBe(
    "They are at work. Z puts them off until they're done."
  )
  expect(setRefusalOf([asks, works], undefined)).toBe(
    "They ask you or are at work. Put them off."
  )
  // One card says it as S does on it.
  expect(setRefusalOf([asks], "Z")).toBe(
    "“A” asks you. Answer it, or Z puts it off."
  )
})
