import { expect, test } from "vitest"
import { parseLink, SECTIONS } from "./sections"

test("each section has an id of its own, so a link can open any of them", () => {
  const ids = SECTIONS.map((section) => section.id)
  expect(ids).toEqual([...new Set(ids)])
  for (const section of SECTIONS) {
    expect(parseLink(section.id).section).toBe(section)
    expect(parseLink(`${section.id}/some.key`)).toEqual({
      section,
      key: "some.key",
    })
  }
})

test("the Files App's section keeps the link files, and the settings files have their own", () => {
  expect(parseLink("files").section.title).toBe("Files")
  expect(parseLink("settings-files").section.title).toBe("Settings files")
})
