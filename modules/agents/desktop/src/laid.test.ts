import { expect, test } from "vitest"
import { fitted, logged, Logs } from "./laid"

test("the check keeps the console's errors and warnings, each cut short", () => {
  expect(logged("info", "hi")).toBeUndefined()
  expect(logged("debug", "hi")).toBeUndefined()
  expect(logged("error", "Uncaught nope")).toEqual({
    level: "error",
    text: "Uncaught nope",
  })
  const long = logged("warning", "x".repeat(600))
  expect(long?.text).toBe(`${"x".repeat(500)}…`)
})

test("the check keeps 20 lines, and says how many more there were", () => {
  const logs = new Logs()
  logs.hear("info", "not kept")
  for (let n = 0; n < 23; n++) logs.hear("error", `line ${n}`)
  const said = logs.said()
  expect(said).toHaveLength(21)
  expect(said[19].text).toBe("line 19")
  expect(said[20]).toEqual({ level: "warning", text: "3 more lines left out." })
  const few = new Logs()
  few.hear("warning", "careful")
  expect(few.said()).toEqual([{ level: "warning", text: "careful" }])
})

test("a picture comes no larger than a model reads, its shape kept", () => {
  expect(fitted(390, 316)).toEqual({ width: 390, height: 316 })
  expect(fitted(728, 4000)).toEqual({ width: 285, height: 1568 })
  expect(fitted(1600, 800)).toEqual({ width: 1568, height: 784 })
})
