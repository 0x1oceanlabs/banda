import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { defines } from "../testing/look"
import { cn } from "./utils"

test("the chat's sizes merge as sizes, keeping a colour beside them", () => {
  expect(cn("text-muted-foreground", "text-code")).toBe(
    "text-muted-foreground text-code"
  )
  expect(cn("text-xs", "text-code")).toBe("text-code")
  // A size with its own line height takes the place of an earlier one.
  expect(cn("text-sm leading-relaxed", "text-prose")).toBe("text-prose")
})

test("each level of the type scale merges as a size, keeping a colour beside it", () => {
  const theme = defines(
    readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8"),
    "@theme inline"
  )
  const levels = [...theme].flatMap(([name, value]) => {
    const level = /^text-([a-z]+)$/.exec(name)?.[1]
    return level && value === `var(--${level}-size)` ? [level] : []
  })
  expect(levels).toContain("small")
  for (const level of levels) {
    expect(cn(`text-${level}`, "text-muted-foreground")).toBe(
      `text-${level} text-muted-foreground`
    )
    expect(cn("text-muted-foreground", `text-${level}`)).toBe(
      `text-muted-foreground text-${level}`
    )
    expect(cn("text-xs", `text-${level}`)).toBe(`text-${level}`)
  }
})

test("a corner's level replaces another", () => {
  expect(cn("rounded-control", "rounded-card")).toBe("rounded-card")
  expect(cn("rounded-small", "rounded-full")).toBe("rounded-full")
  expect(cn("rounded-t-card", "rounded-t-none")).toBe("rounded-t-none")
})

test("an elevation replaces another, and keeps a ring beside it", () => {
  const theme = defines(
    readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8"),
    "@theme inline"
  )
  // Each elevation `@theme` makes, by its own shadow, not Tailwind's sizes.
  const elevations = [...theme].flatMap(([name, value]) => {
    const elevation = /^shadow-([a-z]+)$/.exec(name)?.[1]
    return elevation && value === `var(--${elevation}-shadow)`
      ? [elevation]
      : []
  })
  expect(elevations).toEqual(["float", "lift", "tile", "focus", "panel"])
  for (const elevation of elevations)
    expect(cn("shadow-md ring-1", `shadow-${elevation}`)).toBe(
      `ring-1 shadow-${elevation}`
    )
  expect(cn("shadow-md", "shadow-float")).toBe("shadow-float")
  expect(cn("shadow-float", "shadow-lift")).toBe("shadow-lift")
  expect(cn("shadow-tile", "shadow-none")).toBe("shadow-none")
  expect(cn("shadow-float ring-1", "shadow-panel")).toBe("ring-1 shadow-panel")
  expect(cn("shadow-float shadow-black/10")).toBe(
    "shadow-float shadow-black/10"
  )
})
