import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { imports } from "../testing/architecture"
import {
  FAMILIES,
  motionOf,
  orbitOf,
  SATELLITE_WORDS,
  type SatelliteState,
  shapeOf,
} from "./satellite"

const STATES = Object.keys(FAMILIES) as SatelliteState[]

/** What a shape is, in short: its element, filled or outlined, and how
 * many corners a polygon has. */
function looks(state: SatelliteState, size: number): string {
  const { tag, attrs } = shapeOf(state, size)
  const filled = attrs.fill === "currentColor" ? "filled" : "outlined"
  const dashed = attrs.strokeDasharray === undefined ? "" : " dashed"
  const corners =
    tag === "polygon" ? ` ${String(attrs.points).split(" ").length / 2}` : ""
  return `${tag}${corners} ${filled}${dashed}`
}

test.each([8, 10, 12])("each state draws its shape at %i px", (size) => {
  expect(Object.fromEntries(STATES.map((s) => [s, looks(s, size)]))).toEqual({
    working: "circle filled",
    queued: "circle outlined dashed",
    asks: "polygon 3 filled",
    failed: "polygon 8 filled",
    done: "rect filled",
    stopped: "rect outlined",
    lost: "path outlined",
  })
})

test.each([8, 10, 12])("every shape stays in its %i px box", (size) => {
  for (const state of STATES) {
    const { attrs } = shapeOf(state, size)
    const numbers = [
      ...String(attrs.points ?? "").matchAll(/-?[\d.]+/g),
      ...String(attrs.d ?? "").matchAll(/-?[\d.]+/g),
    ].map(([n]) => Number(n))
    const box = ["x", "y", "cx", "cy"].flatMap((key) =>
      typeof attrs[key] === "number" ? [attrs[key]] : []
    )
    for (const n of [...numbers, ...box]) {
      expect(n, `${state} at ${size}`).toBeGreaterThanOrEqual(0)
      expect(n, `${state} at ${size}`).toBeLessThanOrEqual(size)
    }
  }
})

test("a lost satellite's square has a gap at its top right", () => {
  const { attrs } = shapeOf("lost", 10)
  // It starts below the corner and ends before it: the path is open.
  expect(String(attrs.d)).toMatch(/^M[\d.]+ [\d.]+V.*H[\d.]+$/)
  expect(String(attrs.d)).not.toMatch(/Z$/i)
})

test("each state has its word", () => {
  expect(STATES.map((state) => SATELLITE_WORDS[state])).toEqual([
    "Working",
    "Queued",
    "Asks",
    "Failed",
    "Done",
    "Stopped",
    "Lost",
  ])
})

test("a first draw is still, a change within a shape blends and one to another shape leaps", () => {
  expect(motionOf(undefined, "working", false)).toBe("still")
  expect(motionOf("working", "working", false)).toBe("still")
  expect(motionOf("done", "stopped", false)).toBe("blend")
  expect(motionOf("queued", "working", false)).toBe("blend")
  expect(motionOf("working", "asks", false)).toBe("leap")
  expect(motionOf("working", "failed", false)).toBe("leap")
})

test("under reduced motion every change draws still", () => {
  expect(motionOf("done", "stopped", true)).toBe("still")
  expect(motionOf("working", "asks", true)).toBe("still")
})

test("its rules are pure: they import nothing, so the Mark's orbit and any client read them", () => {
  const source = readFileSync(join(import.meta.dirname, "satellite.ts"), "utf8")
  expect(imports(source)).toEqual([])
})

test("on the Mark only a failed sub-agent shows, red, while its Thread works: an octagon when large, a 3 px dot at 16 px (ADR 0103, decision 13)", () => {
  expect(orbitOf(true, 0, 48)).toBeUndefined()
  expect(orbitOf(false, 2, 48)).toBeUndefined()
  const large = orbitOf(true, 1, 48)
  expect(large?.form).toBe("octagon")
  if (large?.form === "octagon")
    expect(String(large.shape.attrs.points).split(" ")).toHaveLength(16)
  const small = orbitOf(true, 1, 16)
  // 3 px across at 16 px, in the Mark's 56 units.
  expect(small).toEqual({ form: "dot", cx: 54, cy: 40, r: 5.25 })
  // Not measured yet: taken as small.
  expect(orbitOf(true, 1, 0)).toEqual(small)
})
