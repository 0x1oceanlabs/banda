import { expect, test } from "vitest"
import type { Listed } from "@banda/ui/pane"
import { leftSaid, refusalOf } from "./refusals"

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

test("what Archive N done left: the cards whose machine is not reached, by why", () => {
  expect(leftSaid([])).toBeUndefined()
  expect(leftSaid(["mac is away", "mac is away", "pi is off"])).toBe(
    "2 not reached (mac is away), 1 not reached (pi is off)"
  )
})
