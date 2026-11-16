import { EventEmitter } from "node:events"
import { expect, test } from "vitest"
import type { WebContents } from "electron"
import { BROWSER_BRIDGE, SWIPE_CHANNEL } from "@banda/browser-pane/desktop"
import { swipes } from "./swipes"

/** A browser page and Banda's window, as far as a swipe goes: what the
 * page's preload sends, from its own frame or one inside it, and what the
 * window was told. */
function fake(byHands = false) {
  const mainFrame = {}
  const ipc = new EventEmitter()
  const page = { id: 7, ipc, mainFrame } as unknown as WebContents
  const told: unknown[] = []
  const window = {
    send: (channel: string, value: unknown) => told.push([channel, value]),
  } as unknown as WebContents
  swipes(page, window, () => byHands)
  const send = (sent: unknown[], senderFrame: unknown = mainFrame) =>
    ipc.emit(SWIPE_CHANNEL, { senderFrame }, ...sent)
  return { send, told }
}

test("a swipe a page passes on is told to the window, by the page", () => {
  const { send, told } = fake()
  send([-60, 2])
  expect(told).toEqual([
    [BROWSER_BRIDGE.swipe.name, { page: 7, deltaX: -60, deltaY: 2 }],
  ])
})

test("what is no wheel event is dropped", () => {
  const { send, told } = fake()
  send(["-60", 2])
  send([Infinity, 2])
  send([-60])
  send([-60, 2, 0])
  expect(told).toEqual([])
})

test("a frame inside the page tells none", () => {
  const { send, told } = fake()
  send([-60, 2], {})
  expect(told).toEqual([])
})

test("a swipe Banda's hands make in the page stays the page's", () => {
  const { send, told } = fake(true)
  send([-60, 2])
  expect(told).toEqual([])
})
