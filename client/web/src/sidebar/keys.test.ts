import { expect, test } from "vitest"
import { hintOf } from "./keys"

test("the list's hint names the keys in force, and leaves out one unbound (spec §2.8)", () => {
  const banda: Record<string, string> = {
    "sidebar.archive-picked": "S",
    "sidebar.later-picked": "Z",
    "sidebar.unread-picked": "U",
    "sidebar.select-picked": "X",
    "sidebar.menu-picked": "Shift+F10",
  }
  expect(hintOf((id) => banda[id])).toBe(
    "S archives, Z puts off, U marks unread, X selects. Shift+F10 for more."
  )
  // Archive moved to E, and Unread with no key.
  const moved: Record<string, string> = {
    "sidebar.archive-picked": "E",
    "sidebar.later-picked": "Z",
  }
  expect(hintOf((id) => moved[id])).toBe("E archives, Z puts off.")
  expect(
    hintOf((id) => (id === "sidebar.menu-picked" ? "Menu" : undefined))
  ).toBe("Menu for more.")
  expect(hintOf(() => undefined)).toBeUndefined()
})
