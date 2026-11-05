import { expect, test } from "vitest"
import { keyCaps, keyLabel, keyText } from "./keys"

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
