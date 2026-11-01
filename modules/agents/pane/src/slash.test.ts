import type { Offer } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { matching, ownCommand, suggested } from "./slash"

const OFFER: Offer = {
  options: [],
  plans: true,
  slash_commands: [
    {
      name: "review",
      description: "Review the changes so far",
      hint: "what to look at",
    },
    { name: "compact", description: "Make room in the context" },
    { name: "plan", description: "The Harness's own plan" },
  ],
  no_images: false,
}

const names = (commands: { name: string }[]) => commands.map((c) => c.name)

test("the window's own come first, and only where the Harness can plan", () => {
  expect(names(suggested(OFFER))).toEqual([
    "plan",
    "default",
    "review",
    "compact",
  ])
  expect(suggested(OFFER)[0].planMode).toBe(true)
  expect(names(suggested({ ...OFFER, plans: false }))).toEqual([
    "review",
    "compact",
    "plan",
  ])
})

test("a whole message of the window's own switches plan mode", () => {
  const all = suggested(OFFER)
  expect(ownCommand(" /plan ", all)).toBe(true)
  expect(ownCommand("/default", all)).toBe(false)
  expect(ownCommand("/plan the work", all)).toBeUndefined()
  expect(ownCommand("/review", all)).toBeUndefined()
  // Where the Harness cannot plan, `/plan` is the Harness's to run.
  expect(ownCommand("/plan", suggested({ ...OFFER, plans: false }))).toBe(
    undefined
  )
})

test("names that fit best come first, then descriptions", () => {
  const all = suggested(OFFER)
  expect(names(matching(all, ""))).toEqual(names(all))
  expect(names(matching(all, "co"))).toEqual(["compact"])
  // `/plan` holds it only in its description: "before".
  expect(names(matching(all, "re"))).toEqual(["review", "plan"])
  expect(names(matching(all, "fault"))).toEqual(["default"])
  expect(names(matching(all, "CONTEXT"))).toEqual(["compact"])
  expect(names(matching(all, "zzz"))).toEqual([])
})
