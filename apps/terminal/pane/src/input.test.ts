import { expect, test } from "vitest"
import { type JsonValue, Unreachable } from "@banda/contract"
import { problem } from "@banda/ui/lib/words"
import { Input } from "./input"

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
  const input = new Input(send, "t", () => {})
  input.type("l")
  input.type("s")
  input.type("\r")
  await settle()
  expect(calls.map((c) => c.params)).toEqual([{ terminal: "t", data: "l" }])
  calls[0].answer()
  await settle()
  expect(calls.map((c) => c.params)).toEqual([
    { terminal: "t", data: "l" },
    { terminal: "t", data: "s\r" },
  ])
})

test("once the engine says it runs writes in the order sent, each key goes as it is typed, before the last one's answer", async () => {
  const { calls, send } = engine()
  const input = new Input(send, "t", () => {})
  // Typed before the terminal's screen came: nothing said yet how this
  // engine runs them, so one goes, and the rest waits.
  input.type("l")
  input.type("s")
  expect(calls.map((c) => c.params)).toEqual([{ terminal: "t", data: "l" }])
  // Its snapshot says so: what waited goes, and from here a key waits for
  // none, so its echo is one round trip away.
  input.inOrder(true)
  input.type("\r")
  input.resize({ cols: 100, rows: 30 })
  input.type("x")
  expect(calls.slice(1).map((c) => [c.method, c.params])).toEqual([
    ["terminal.write", { terminal: "t", data: "s" }],
    ["terminal.write", { terminal: "t", data: "\r" }],
    ["terminal.resize", { terminal: "t", size: { cols: 100, rows: 30 } }],
    ["terminal.write", { terminal: "t", data: "x" }],
  ])
})

test("with eight on their way, what is typed meanwhile waits and goes as one", async () => {
  const { calls, send } = engine()
  const input = new Input(send, "t", () => {})
  input.inOrder(true)
  for (const key of "12345678") input.type(key)
  input.type("9")
  input.type("0")
  expect(calls).toHaveLength(8)
  calls[0].answer()
  await settle()
  expect(calls.at(-1)?.params).toEqual({ terminal: "t", data: "90" })
})

test("an engine that stops saying so, as an older one a Pane reaches again, gets one write at a time", async () => {
  const { calls, send } = engine()
  const input = new Input(send, "t", () => {})
  input.inOrder(true)
  input.inOrder(false)
  input.type("a")
  input.type("b")
  input.type("c")
  await settle()
  expect(calls.map((c) => c.params)).toEqual([{ terminal: "t", data: "a" }])
  calls[0].answer()
  await settle()
  expect(calls.map((c) => c.params)).toEqual([
    { terminal: "t", data: "a" },
    { terminal: "t", data: "bc" },
  ])
})

test("only the last size goes, before what was typed with it", async () => {
  const { calls, send } = engine()
  const input = new Input(send, "t", () => {})
  input.type("a")
  input.resize({ cols: 80, rows: 24 })
  input.resize({ cols: 100, rows: 30 })
  input.type("b")
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
  const input = new Input(
    async (_method, params) => {
      sent.push((params as { data: string }).data)
    },
    "t",
    () => {}
  )
  const paste = "x".repeat(16 * 1024 - 1) + "😀" + "y"
  input.type(paste)
  await settle()
  expect(sent.join("")).toBe(paste)
  expect(sent[0].length).toBe(16 * 1024 - 1)
  expect(sent[1].startsWith("😀")).toBe(true)
})

test("typing a program does not read says so; a size it missed does not", async () => {
  const problems: unknown[] = []
  const input = new Input(
    async () => {
      throw new Error("does not read")
    },
    "t",
    (error) => problems.push(error)
  )
  input.resize({ cols: 80, rows: 24 })
  input.type("a")
  await settle()
  expect(problems).toEqual([new Error("does not read")])
})

test("a write refused while away gives the foot's words and goes nowhere later", async () => {
  const sent: string[] = []
  let away = true
  const send = (_method: string, params: JsonValue) => {
    sent.push((params as { data: string }).data)
    return away
      ? Promise.reject(new Unreachable("arc", "arc is away"))
      : Promise.resolve(null)
  }
  const said: string[] = []
  const input = new Input(send, "t", (error) =>
    said.push(problem(error, "your typing"))
  )
  input.type("rm ")
  await settle()
  input.type("-rf\r")
  await settle()
  expect(said).toEqual([
    "arc is away: your typing was not sent.",
    "arc is away: your typing was not sent.",
  ])
  // Back, what was refused stays refused: only what is typed now goes.
  away = false
  input.type("ls\r")
  await settle()
  expect(sent).toEqual(["rm ", "-rf\r", "ls\r"])
  expect(said).toHaveLength(2)
})
