import { expect, test } from "vitest"
import type { SpaceSummary } from "@banda/contract"
import { sameSpaces, shownSpaces } from "./spaces"

const space: SpaceSummary = {
  id: "one",
  name: "Work",
  folder: "/work",
  pinned: false,
  archived: false,
  sees_others: false,
  scratch: false,
  missing: false,
}

test("pickers omit scratch and archived Spaces while keeping pinned Spaces first", () => {
  const pinned = { ...space, id: "pin", pinned: true }
  expect(
    shownSpaces([
      space,
      { ...space, id: "scratch", scratch: true },
      pinned,
      { ...space, id: "archive", archived: true },
    ])
  ).toEqual([pinned, space])
})

test("promotion changes a Space list even if no other field changes", () => {
  expect(sameSpaces([{ ...space, scratch: true }], [space])).toBe(false)
})
