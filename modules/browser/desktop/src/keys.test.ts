import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { EventEmitter } from "node:events"
import { beforeEach, expect, test } from "vitest"
import type { KeyboardInputEvent, WebContents } from "electron"
import { keepInForce, keys, sendPress } from "./keys"

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
  let acting = false
  keys(
    page as unknown as WebContents,
    window as unknown as WebContents,
    (id) => acting && id === page.id
  )
  /** A key the Person presses in the page. */
  const pressed = (input: KeyboardInputEvent) => page.sendInputEvent(input)
  /** Runs `act` as Banda's hands act in the page, as `Tabs.hands` says. */
  const hands = (act: () => void) => {
    acting = true
    try {
      act()
    } finally {
      acting = false
    }
  }
  return { page: page as unknown as WebContents, pressed, hands, reached, told }
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
  const { page, hands, reached, told } = fakePage()
  hands(() =>
    expect(
      sendPress(page, { type: "keyDown", keyCode: "l", modifiers: ["control"] })
    ).toMatchObject({ code: "KeyL", ctrlKey: true })
  )
  expect(reached).toEqual([])
  expect(told).toEqual([])
})

test("the keys a page hears as the hands act in it are the page's alone, the mod's too", () => {
  const { page, pressed, hands, reached, told } = fakePage()
  hands(() => {
    expect(sendPress(page, { type: "keyDown", keyCode: "Alt" })).toBeUndefined()
    expect(sendPress(page, { type: "keyUp", keyCode: "Alt" })).toBeUndefined()
    expect(sendPress(page, { type: "keyDown", keyCode: "a" })).toBeUndefined()
    // Text is typed: a key of it that is Banda's goes to the page as well.
    page.sendInputEvent({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
    page.sendInputEvent({ type: "char", keyCode: "w" })
  })
  expect(told).toEqual([])
  expect(reached).toEqual([
    "keyDown Alt",
    "keyUp Alt",
    "keyDown a",
    "keyDown w",
    "char w",
  ])
  // Once they are done, the Person's keys are Banda's again.
  pressed({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
  expect(told).toEqual([expect.objectContaining({ code: "KeyW" })])
})

test("a page that throws as the hands press holds back no key of theirs after", () => {
  const { page, hands, reached, told } = fakePage()
  const broken = Object.assign(Object.create(page), {
    sendInputEvent: () => {
      throw new Error("The page is gone")
    },
  }) as WebContents
  hands(() => {
    expect(() => sendPress(broken, { type: "keyDown", keyCode: "a" })).toThrow(
      "The page is gone"
    )
    page.sendInputEvent({ type: "keyDown", keyCode: "w", modifiers: ["alt"] })
  })
  expect(reached).toEqual(["keyDown w"])
  expect(told).toEqual([])
})
