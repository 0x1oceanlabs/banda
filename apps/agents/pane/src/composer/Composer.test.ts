import { expect, test } from "vitest"
import { sendable } from "./Composer"

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
