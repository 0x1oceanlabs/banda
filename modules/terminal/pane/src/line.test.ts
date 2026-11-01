import { expect, test } from "vitest"
import type { JsonValue } from "@bandaso/contract"
import { Line } from "./line"

/** An engine that answers each call when the test says so. */
function engine() {
  const calls: { method: string; params: JsonValue; answer: () => void }[] = []
  const send = (method: string, params: JsonValue) =>
    new Promise<unknown>((resolve) =>
      calls.push({ method, params, answer: () => resolve(null) })
    )
  return { calls, send }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test("typing waits for the typing before it, and what came meanwhile goes as one", async () => {
  const { calls, send } = engine()
  const line = new Line(send, "t", () => {})
  line.type("l")
  line.type("s")
  line.type("\r")
  await settle()
  expect(calls.map((c) => c.params)).toEqual([{ terminal: "t", data: "l" }])
  calls[0].answer()
  await settle()
  expect(calls.map((c) => c.params)).toEqual([
    { terminal: "t", data: "l" },
    { terminal: "t", data: "s\r" },
  ])
})

test("only the last size goes, before what was typed with it", async () => {
  const { calls, send } = engine()
  const line = new Line(send, "t", () => {})
  line.type("a")
  line.resize({ cols: 80, rows: 24 })
  line.resize({ cols: 100, rows: 30 })
  line.type("b")
  await settle()
  calls[0].answer()
  await settle()
  calls[1].answer()
  await settle()
  expect(calls.map((c) => [c.method, c.params])).toEqual([
    ["terminal.write", { terminal: "t", data: "a" }],
    ["terminal.resize", { terminal: "t", size: { cols: 100, rows: 30 } }],
    ["terminal.write", { terminal: "t", data: "b" }],
  ])
})

test("a paste larger than one call goes in pieces, never half a character", async () => {
  const sent: string[] = []
  const line = new Line(
    async (_method, params) => {
      sent.push((params as { data: string }).data)
    },
    "t",
    () => {}
  )
  const paste = "x".repeat(16 * 1024 - 1) + "😀" + "y"
  line.type(paste)
  await settle()
  expect(sent.join("")).toBe(paste)
  expect(sent[0].length).toBe(16 * 1024 - 1)
  expect(sent[1].startsWith("😀")).toBe(true)
})

test("typing a program does not read says so; a size it missed does not", async () => {
  const problems: unknown[] = []
  const line = new Line(
    async () => {
      throw new Error("does not read")
    },
    "t",
    (error) => problems.push(error)
  )
  line.resize({ cols: 80, rows: 24 })
  line.type("a")
  await settle()
  expect(problems).toEqual([new Error("does not read")])
})
