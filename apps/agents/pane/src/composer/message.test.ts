import { expect, test } from "vitest"
import { measure, sendable } from "./message"

test("Enter and Send send what is written, within the limit, once nothing is on its way", () => {
  const message = { written: true, over: 0, busy: false }
  expect(sendable(message)).toBe(true)
  expect(sendable({ ...message, written: false })).toBe(false)
  expect(sendable({ ...message, over: 1 })).toBe(false)
  expect(sendable({ ...message, busy: true })).toBe(false)
})

test("while another machine cannot be reached, Send is held and sends nothing", () => {
  const message = { written: true, over: 0, busy: false }
  expect(
    sendable({ ...message, held: "arc is away. Send once it is back." })
  ).toBe(false)
  expect(sendable({ ...message, held: "Connecting to arc…" })).toBe(false)
  expect(sendable({ ...message, held: undefined })).toBe(true)
})

test("in a started Thread whose machine is away, Send is not held but reads Send when back: written, it sends the message to wait; with nothing written it stays quiet", () => {
  // The Thread gives `whenBack` in place of `held`.
  const message = { written: true, over: 0, busy: false, held: undefined }
  expect(sendable(message)).toBe(true)
  expect(sendable({ ...message, written: false })).toBe(false)
  expect(sendable({ ...message, busy: true })).toBe(false)
})

test("the message is the text, then the comments; images alone are written; past the longest it is over", () => {
  const comment = { id: "1", path: "src/a.ts", lines: [3, 3] as const }
  const { message, written, over } = measure("Look", [comment], 0)
  expect(message).toBe("Look\n\nComment on src/a.ts:3:")
  expect(written).toBe(true)
  expect(over).toBeLessThan(0)
  expect(measure("  ", [], 0).written).toBe(false)
  expect(measure("", [], 1).written).toBe(true)
  expect(measure("x".repeat(120_001), [], 0).over).toBe(1)
})
