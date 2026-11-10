import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  BEZIER,
  CALL,
  eased,
  type Ease,
  type Loop,
  LOOPED,
  LOOPS,
  type Part,
  phaseOf,
  valueAt,
} from "./mark-rhythm"

test("a loop's values are its keyframes', and between them as CSS eases", () => {
  const { breath } = LOOPS
  expect(valueAt(breath, 0)).toEqual([0.988, 1.03])
  expect(valueAt(breath, breath.period / 2)).toEqual([1.012, 0.97])
  // Halfway between two keys, a sine's half is halfway too.
  const [x] = valueAt(breath, breath.period / 4)
  expect(x).toBeCloseTo(1, 3)
  // The rhythm goes round: a period later, or before, it is where it was.
  expect(valueAt(breath, 0.4 + 3 * breath.period)).toEqual(valueAt(breath, 0.4))
  expect(valueAt(breath, 0.4 - breath.period)[0]).toBeCloseTo(
    valueAt(breath, 0.4)[0]!,
    9
  )
})

test("held values jump at their second and stay until the next", () => {
  // Open's eyes close for their first 0.12 s, then stay open.
  expect(valueAt(LOOPS.blink, 0.05)).toEqual([1])
  expect(valueAt(LOOPS.blink, 0.13)).toEqual([0])
  expect(valueAt(LOOPS.blink, 3.6)).toEqual([0])
  expect(valueAt(LOOPS["look-around"], 1.5)).toEqual([-3.4, 0])
  expect(valueAt(LOOPS["look-around"], 3)).toEqual([3.4, 0])
})

test("the eases begin at 0 and end at 1, as CSS's do", () => {
  for (const ease of ["linear", "in", "out", "inOut"] as const) {
    expect(eased(ease, 0), ease).toBeCloseTo(0, 6)
    expect(eased(ease, 1), ease).toBeCloseTo(1, 6)
  }
  expect(eased("inOut", 0.5)).toBeCloseTo(0.5, 6)
  expect(eased("in", 0.5)).toBeLessThan(0.5)
  expect(eased("out", 0.5)).toBeGreaterThan(0.5)
  expect(eased("hold", 0.99)).toBe(0)
})

test("a call moves in its first 0.7 s, then the mark is still until the next", () => {
  for (const name of [
    "hop",
    "shake",
    "shake-turn",
    "ring",
    "ring-turn",
    "bells",
  ] as const) {
    const loop = LOOPS[name]
    expect(loop.period, name).toBe(CALL)
    expect(valueAt(loop, 1), name).toEqual(valueAt(loop, CALL - 0.01))
    expect(valueAt(loop, 0.1), name).not.toEqual(valueAt(loop, 1))
  }
})

test("one Thread keeps one rhythm, and each Thread its own", () => {
  const wall = 1_770_000_000.25
  const one = "019a6e2c-7d10-7c3a-9b1e-5f2a8d4c6e01"
  const other = "019a6e2c-7d10-7c3a-9b1e-5f2a8d4c6e02"
  // The same Thread at the same moment stands at the same place in it, in
  // every window, and a second later a second further.
  expect(phaseOf(one, wall)).toBe(phaseOf(one, wall))
  expect(phaseOf(one, wall + 1) - phaseOf(one, wall)).toBeCloseTo(1, 6)
  // Another Thread stands elsewhere, though its id differs by one letter.
  expect(phaseOf(other, wall)).not.toBe(phaseOf(one, wall))
  for (const beat of ["", "t", one, other]) {
    const at = phaseOf(beat, wall)
    expect(at, beat).toBeGreaterThanOrEqual(0)
    expect(at, beat).toBeLessThan(1_000_000)
  }
})

test("each look's loops move parts of their own, in keys that go forward", () => {
  for (const [look, names] of Object.entries(LOOPED)) {
    const parts = names.map((name) => LOOPS[name].part)
    expect(new Set(parts).size, look).toBe(parts.length)
  }
  for (const [name, loop] of Object.entries(LOOPS)) {
    const at = loop.keys.map(([at]) => at)
    expect(at[0], name).toBe(0)
    expect(at.at(-1), name).toBe(1)
    for (let i = 1; i < at.length; i++)
      expect(at[i]!, name).toBeGreaterThan(at[i - 1]!)
  }
})

// marks.css's loops are written from LOOPS and LOOPED, so what a mark's
// news draws on the window's clock is what the keyframes draw after it.

/** A keyframe's declarations, by the part it moves. */
function declared(part: Part, [a, b, c, d]: readonly number[]): string[] {
  if (part === "move" || part === "look")
    return [`transform: translate(${a}px, ${b}px);`]
  if (part === "turn" || part === "bell") return [`transform: rotate(${a}deg);`]
  if (part === "size") return [`transform: scale(${a}, ${b});`]
  if (part === "lid") return [`transform: scaleY(${a});`]
  return [`transform: translate(${a}px, ${b}px) scale(${c});`, `opacity: ${d};`]
}

/** How CSS goes from a keyframe to the next, as `Ease` says. */
function timingOf(ease: Ease): string | undefined {
  if (ease === "linear") return undefined
  if (ease === "hold") return "steps(1, end)"
  return `cubic-bezier(${BEZIER[ease].join(", ")})`
}

function keyframes(name: string, { part, keys }: Loop, sign = 1): string[] {
  return [
    `@keyframes ${name} {`,
    ...keys.flatMap(([at, values, ease], i) => {
      const timing = i < keys.length - 1 ? timingOf(ease) : undefined
      return [
        `${+(at * 100).toFixed(3)}% {`,
        ...declared(
          part,
          values.map((value) => sign * value || 0)
        ),
        ...(timing ? [`animation-timing-function: ${timing};`] : []),
        "}",
      ]
    }),
    "}",
  ]
}

/** marks.css's generated part, as `LOOPS` and `LOOPED` write it. */
function generated(): string {
  const mark = '[data-slot="banda-mark"]'
  const lines = Object.entries(LOOPS).flatMap(([name, loop]) => [
    ...keyframes(`mark-${name}`, loop),
    // Eyes that look about move the body back the other way.
    ...(loop.part === "look" ? keyframes(`mark-${name}-back`, loop, -1) : []),
  ])
  for (const [look, names] of Object.entries(LOOPED))
    for (const name of names) {
      const { part, period } = LOOPS[name]
      const groups: [string, string][] = [[`mark-${part}`, `mark-${name}`]]
      if (part === "look") groups.push(["mark-unlook", `mark-${name}-back`])
      for (const [group, animation] of groups)
        lines.push(
          `${mark}[data-loop="${look}"] .${group} {`,
          `animation-name: ${animation};`,
          `animation-duration: ${period}s;`,
          "}"
        )
    }
  // The snores follow one another, a third of their loop apart.
  for (const at of [1, 2])
    lines.push(
      `${mark} .mark-z:nth-child(${at + 1}) {`,
      `animation-delay: calc(var(--mark-phase, 0s) - ${+((LOOPS.zz.period * at) / 3).toFixed(3)}s);`,
      "}"
    )
  return lines.join("\n")
}

/** marks.css's generated part, between its two marks. */
const BLOCK = /(\/\* loops: from here \*\/)([\s\S]*)(\/\* loops: to here \*\/)/

/** `css`'s lines, each without the space around it, as the test compares
 * them: one keyframe's line apart is told by itself. */
const linesOf = (css: string) =>
  css
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

// With WRITE_MARKS set, it writes the part anew, and prettier lays it out.
test("marks.css's loops are LOOPS and LOOPED, as this test writes them", async () => {
  const file = fileURLToPath(new URL("../styles/marks.css", import.meta.url))
  const css = readFileSync(file, "utf8")
  if (process.env.WRITE_MARKS) {
    const { format, resolveConfig } = await import("prettier")
    const written = css.replace(BLOCK, `$1\n${generated()}\n$3`)
    const options = { ...(await resolveConfig(file)), filepath: file }
    writeFileSync(file, await format(written, options))
  }
  const [, , block] = BLOCK.exec(readFileSync(file, "utf8")) ?? []
  expect(block, "marks.css has no generated part").toBeDefined()
  expect(linesOf(block!)).toEqual(linesOf(generated()))
})
