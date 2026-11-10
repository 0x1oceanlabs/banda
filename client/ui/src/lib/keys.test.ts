import { expect, test } from "vitest"
import {
  aPageSaid,
  holdsAlone,
  isModKey,
  keyCaps,
  keyLabel,
  keyText,
  modLabel,
  modText,
  realKey,
  sameMod,
  saidByAPage,
  withMore,
} from "./keys"

const ALT = { alt: true, ctrl: false, super: false }
const ctrlAlt = { alt: true, ctrl: true, super: false }

test("a key reads as it is pressed, as keys.toml writes it on Linux", () => {
  const key = { code: "KeyR", ctrl: true, alt: true, shift: true }
  expect(keyLabel(key, false)).toBe("Ctrl+Alt+Shift+R")
  expect(keyLabel({ code: "Enter", alt: true }, false)).toBe("Alt+Return")
  expect(keyLabel({ code: "ArrowLeft", alt: true }, false)).toBe("Alt+Left")
  expect(keyLabel({ code: "Comma", alt: true }, false)).toBe("Alt+,")
})

test("on a Mac a key reads by its signs, in Apple's order", () => {
  const key = { code: "KeyR", ctrl: true, alt: true, shift: true }
  expect(keyLabel(key, true)).toBe("⌃⌥⇧R")
  expect(keyCaps(key, true)).toEqual(["⌃", "⌥", "⇧", "R"])
  expect(keyLabel({ code: "Enter", alt: true }, true)).toBe("⌥↩")
  expect(keyLabel({ code: "ArrowLeft", alt: true, ctrl: true }, true)).toBe(
    "⌃⌥←"
  )
  expect(keyLabel({ code: "Space", alt: true }, true)).toBe("⌥Space")
})

test("keys.toml writes a key the same on every system", () => {
  expect(keyText({ code: "Digit3", alt: true, shift: true })).toBe(
    "Alt+Shift+3"
  )
  expect(keyText({ code: "Backslash", ctrl: true, alt: true })).toBe(
    "Ctrl+Alt+\\"
  )
})

test("a key held with the mod is made real with it, one more as its level says", () => {
  expect(realKey({ code: "KeyR", mod: true }, ALT)).toEqual({
    code: "KeyR",
    alt: true,
    ctrl: false,
    super: false,
  })
  const wider = { code: "ArrowRight", mod: true, more: true }
  expect(keyText(realKey(wider, ALT))).toBe("Ctrl+Alt+Right")
  expect(keyText(realKey(wider, ctrlAlt))).toBe("Ctrl+Alt+Super+Right")
  expect(
    keyText(realKey({ code: "KeyR", mod: true, shift: true }, ctrlAlt))
  ).toBe("Ctrl+Alt+Shift+R")
  // A key not held with the mod is as it is written.
  const tab = { code: "KeyT", ctrl: true }
  expect(realKey(tab, ctrlAlt)).toBe(tab)
})

test("Super reads as Super, or ⌘ on a Mac, after Alt", () => {
  const key = { code: "KeyR", ctrl: true, alt: true, super: true, shift: true }
  expect(keyLabel(key, false)).toBe("Ctrl+Alt+Super+Shift+R")
  expect(keyLabel(key, true)).toBe("⌃⌥⇧⌘R")
  expect(keyText(key)).toBe("Ctrl+Alt+Super+Shift+R")
})

test("the mouse holds the mod alone; one key more is the program's", () => {
  const press = { altKey: true, ctrlKey: false, metaKey: false }
  expect(holdsAlone(press, ALT)).toBe(true)
  expect(holdsAlone(press, ctrlAlt)).toBe(false)
  expect(holdsAlone({ ...press, ctrlKey: true }, ctrlAlt)).toBe(true)
  expect(holdsAlone({ ...press, ctrlKey: true }, ALT)).toBe(false)
  expect(isModKey("AltRight", ALT)).toBe(true)
  expect(isModKey("ControlLeft", ALT)).toBe(false)
  expect(isModKey("ControlLeft", ctrlAlt)).toBe(true)
})

test("a primary key reads as Ctrl, or ⌘ on a Mac", () => {
  const tab = { code: "KeyT", primary: true }
  expect(keyLabel(tab, false)).toBe("Ctrl+T")
  expect(keyLabel(tab, true)).toBe("⌘T")
  expect(keyText(tab)).toBe("Ctrl+T")
})

test("one key more is the first of Ctrl, Super and Alt the mod lacks", () => {
  expect(withMore(ALT)).toEqual({ alt: true, ctrl: true, super: false })
  expect(withMore(ctrlAlt)).toEqual({ alt: true, ctrl: true, super: true })
  expect(withMore({ alt: true, ctrl: true, super: true })).toBeUndefined()
})

test("a mod reads as it is pressed, and keys.toml writes it in one order", () => {
  expect(modLabel(ctrlAlt, false)).toBe("Ctrl+Alt")
  expect(modLabel(ctrlAlt, true)).toBe("⌃⌥")
  expect(modText({ alt: true, ctrl: false, super: true })).toBe("Alt+Super")
  expect(sameMod(ctrlAlt, { ...ALT, ctrl: true })).toBe(true)
  expect(sameMod(ctrlAlt, ALT)).toBe(false)
})

test("a press a page said is told from one the Person pressed", () => {
  const pressed = new Event("keydown")
  const said = saidByAPage(new Event("keydown"))
  expect(aPageSaid(said)).toBe(true)
  expect(aPageSaid(pressed)).toBe(false)
})
