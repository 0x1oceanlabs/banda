import type { Offer } from "@bandaso/contract/agents"
import { expect, test } from "vitest"
import { matching, suggested, typed } from "./commands"

const OFFER: Offer = {
  options: [],
  plans: true,
  commands: [
    {
      name: "review",
      description: "Review the changes so far",
      hint: "what to look at",
    },
    { name: "compact", description: "Make room in the context" },
    { name: "plan", description: "The Harness's own plan" },
  ],
}

const names = (commands: { name: string }[]) => commands.map((c) => c.name)

test("the Thread's own commands come first, and only where it can plan", () => {
  expect(names(suggested(OFFER))).toEqual([
    "plan",
    "default",
    "review",
    "compact",
  ])
  expect(suggested(OFFER)[0].plan).toBe(true)
  expect(names(suggested({ ...OFFER, plans: false }))).toEqual([
    "review",
    "compact",
    "plan",
  ])
})

test("a command is typed while the message is `/` and one word", () => {
  expect(typed("/")).toBe("")
  expect(typed("/rev")).toBe("rev")
  expect(typed("/review ")).toBeUndefined()
  expect(typed("say /review")).toBeUndefined()
  expect(typed("/home/roma")).toBeUndefined()
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
