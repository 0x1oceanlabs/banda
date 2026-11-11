import type { MarkState } from "@banda/ui/lib/mark-state"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import { actsOf, actsWidth } from "./acts"

const acts = (stand: Stand, mark: MarkState) => actsOf(stand, { mark })

test("each place offers d10's acts, Later first (ADR 0098, decision 10)", () => {
  // Your turn: Asks can only be put off; Done, Failed and Woke archive too.
  expect(acts("turn", "asking")).toEqual(["later"])
  expect(acts("turn", "done")).toEqual(["later", "archive"])
  expect(acts("turn", "failed")).toEqual(["later", "archive"])
  expect(acts("turn", "idle")).toEqual(["later", "archive"])
  expect(acts("open", "idle")).toEqual(["later", "archive"])
  // At work: Later, whose picker offers "When it's done" first.
  expect(acts("working", "running")).toEqual(["later"])
  expect(acts("working", "thinking")).toEqual(["later"])
  expect(acts("later", "idle")).toEqual(["wake"])
  expect(acts("later", "asking")).toEqual(["wake"])
  expect(acts("archived", "idle")).toEqual(["unarchive"])
})

test("a Woke card that asks again is never archived while it asks (decision 11)", () => {
  expect(acts("turn", "asking")).not.toContain("archive")
})

test("the acts take 20 px each, 2 px apart (spec §2.5)", () => {
  expect(actsWidth(0)).toBe(0)
  expect(actsWidth(1)).toBe(20)
  expect(actsWidth(2)).toBe(42)
})
