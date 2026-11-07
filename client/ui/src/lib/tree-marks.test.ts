import { expect, test } from "vitest"
import { holding, pulseCSS, rowMarkOf } from "./tree-marks"

const turned = new Set(["src/a.ts", "docs/guide.md"])
const marking = {
  loading: false,
  holds: holding(["src/b.ts", "README.md"]),
  turned,
  turnHolds: holding(turned),
}

test("a folder holds what is under it, however deep", () => {
  expect([...holding(["a/b/c.ts", "a/d.ts", "e.ts"])]).toEqual(["a/", "a/b/"])
})

test("a file the turn changed has the quiet dot; a folder shows git's dot, the turn's, or both", () => {
  expect(rowMarkOf("src/a.ts", false, marking)).toBe("turned")
  expect(rowMarkOf("src/b.ts", false, marking)).toBeNull()
  expect(rowMarkOf("src/", true, marking)).toBe("holds-both")
  expect(rowMarkOf("docs/", true, marking)).toBe("holds-turned")
  expect(rowMarkOf("lib/", true, marking)).toBeNull()
  expect(rowMarkOf("src/", true, { ...marking, loading: true })).toBe("loading")
  expect(
    rowMarkOf("src/", true, {
      ...marking,
      turned: new Set(),
      turnHolds: new Set(),
    })
  ).toBe("holds")
})

test("each pulsing row is found by its path, in its colour", () => {
  expect(pulseCSS(new Map())).toBe("")
  const css = pulseCSS(
    new Map([
      ["src/a.ts", "var(--account-1)"],
      ['odd "name".ts', "red; } * { x: y"],
    ])
  )
  const [first, second] = css.split("\n")
  expect(first).toContain(
    `button[data-type='item'][data-item-path="src/a.ts"] { --banda-pulse: var(--account-1);`
  )
  expect(first).toContain("animation: banda-pulse")
  // A quote in a name stays in its string; a colour cannot end the rule.
  expect(second).toContain(`[data-item-path="odd \\"name\\".ts"]`)
  expect(second).toContain("--banda-pulse: red  *  x: y;")
})
