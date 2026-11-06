import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { EventEmitter } from "node:events"
import { beforeEach, expect, test } from "vitest"
import type { KeyboardInputEvent, WebContents } from "electron"
import { keepInForce, keys, sendAlone } from "./keys"

/** The codes Electron gives the keys these tests send. */
const CODES: Record<string, string> = {
  w: "KeyW",
  a: "KeyA",
  l: "KeyL",
  Alt: "AltLeft",
}

/**
 * A browser page in Banda's window, as Electron keeps one: a key sent to
 * it is told to its `before-input-event` before `sendInputEvent` returns,
 * a char is not, and a key prevented there never reaches the page.
 */
function fakePage() {
  const reached: string[] = []
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    sendInputEvent: ({ type, keyCode, modifiers = [] }: KeyboardInputEvent) => {
      let prevented = false
      if (type !== "char") {
        page.emit(
          "before-input-event",
          { preventDefault: () => (prevented = true) },
          {
            type,
            code: CODES[keyCode] ?? keyCode,
            alt: modifiers.includes("alt"),
            control: modifiers.includes("control"),
            shift: modifiers.includes("shift"),
            meta: modifiers.includes("meta"),
            isAutoRepeat: false,
          }
        )
      }
      if (!prevented) reached.push(`${type} ${keyCode}`)
    },
  })
  const told: unknown[] = []
  const window = { send: (_: string, value: unknown) => told.push(value) }
  keys(page as unknown as WebContents, window as unknown as WebContents)
  /** A key the Person presses in the page. */
  const pressed = (input: KeyboardInputEvent) => page.sendInputEvent(input)
  return { page: page as unknown as WebContents, pressed, reached, told }
}

beforeEach(() =>
  keepInForce({
    mod: { alt: true, ctrl: false, super: false },
    keys: [
      { code: "KeyW", alt: true },
      { code: "KeyL", primary: true },
    ],
  })
)

test("the Person's key in force goes to the window, and the mod's is told too", () => {
  const { pressed, reached, told } = fakePage()
  pressed({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
  pressed({ type: "keyDown", keyCode: "Alt" })
  pressed({ type: "keyDown", keyCode: "a", modifiers: ["alt"] })
  expect(told).toEqual([
    expect.objectContaining({ code: "KeyW", altKey: true, page: 7 }),
    expect.objectContaining({ code: "AltLeft", page: 7 }),
  ])
  expect(reached).toEqual(["keyDown Alt", "keyDown a"])
})

test("a press of the hands that is one of Banda's keys is held back from the page and the window", () => {
  const { page, reached, told } = fakePage()
  const banda = sendAlone(
    page,
    { type: "keyDown", keyCode: "l", modifiers: ["control"] },
    { press: true }
  )
  expect(banda).toMatchObject({ code: "KeyL", ctrlKey: true })
  expect(reached).toEqual([])
  expect(told).toEqual([])
})

test("the hands' other keys and their text reach the page alone, the mod's too", () => {
  const { page, pressed, reached, told } = fakePage()
  const send = (input: KeyboardInputEvent, press: boolean) =>
    sendAlone(page, input, { press })
  expect(send({ type: "keyDown", keyCode: "Alt" }, true)).toBeUndefined()
  expect(send({ type: "keyUp", keyCode: "Alt" }, true)).toBeUndefined()
  expect(send({ type: "keyDown", keyCode: "a" }, true)).toBeUndefined()
  // Text is typed: a key of it that is Banda's goes to the page as well.
  expect(
    send({ type: "keyDown", keyCode: "w", modifiers: ["alt"] }, false)
  ).toBeUndefined()
  expect(send({ type: "char", keyCode: "w" }, false)).toBeUndefined()
  expect(told).toEqual([])
  expect(reached).toEqual([
    "keyDown Alt",
    "keyUp Alt",
    "keyDown a",
    "keyDown w",
    "char w",
  ])
  // Once they are sent, the Person's keys are Banda's again.
  pressed({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
  expect(told).toEqual([expect.objectContaining({ code: "KeyW" })])
})

test("a page that throws as the hands send leaves the Person's keys Banda's", () => {
  const { page, pressed, told } = fakePage()
  const broken = Object.assign(Object.create(page), {
    sendInputEvent: () => {
      throw new Error("The page is gone")
    },
  }) as WebContents
  expect(() =>
    sendAlone(broken, { type: "keyDown", keyCode: "a" }, { press: true })
  ).toThrow("The page is gone")
  pressed({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
  expect(told).toEqual([expect.objectContaining({ code: "KeyW" })])
})
