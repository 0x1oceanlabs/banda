import { expect, test } from "vitest"
import { hintOf } from "./keys"

test("the list's hint names the keys in force, and leaves out one unbound (spec §2.8)", () => {
  const banda: Record<string, string> = {
    "sidebar.archive-picked": "S",
    "sidebar.later-picked": "Z",
    "sidebar.unread-picked": "U",
  }
  expect(hintOf((id) => banda[id])).toBe(
    "S archives, Z puts off, U marks unread."
  )
  // Archive moved to E, and Unread with no key.
  const moved: Record<string, string> = {
    "sidebar.archive-picked": "E",
    "sidebar.later-picked": "Z",
  }
  expect(hintOf((id) => moved[id])).toBe("E archives, Z puts off.")
  expect(hintOf(() => undefined)).toBeUndefined()
})
