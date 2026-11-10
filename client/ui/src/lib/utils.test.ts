import { expect, test } from "vitest"
import { cn } from "./utils"

test("the chat's sizes merge as sizes, keeping a colour beside them", () => {
  expect(cn("text-muted-foreground", "text-code")).toBe(
    "text-muted-foreground text-code"
  )
  expect(cn("text-xs", "text-code")).toBe("text-code")
  // A size with its own line height takes the place of an earlier one.
  expect(cn("text-sm leading-relaxed", "text-prose")).toBe("text-prose")
})

test("a corner's level replaces another", () => {
  expect(cn("rounded-control", "rounded-card")).toBe("rounded-card")
  expect(cn("rounded-small", "rounded-full")).toBe("rounded-full")
  expect(cn("rounded-t-card", "rounded-t-none")).toBe("rounded-t-none")
})
