import { expect, test } from "vitest"
import { besideFile } from "./paths"

test("a markdown file's picture is found beside it", () => {
  const notes = "/work/docs/notes.md"
  expect(besideFile(notes, "img/a.png")).toBe("/work/docs/img/a.png")
  expect(besideFile(notes, "./a.png")).toBe("/work/docs/a.png")
  expect(besideFile(notes, "../shot%20one.png")).toBe("/work/shot one.png")
  expect(besideFile(notes, "/tmp/a.png")).toBe("/tmp/a.png")
  expect(besideFile(notes, "a.png?raw#top")).toBe("/work/docs/a.png")
  expect(besideFile("/a.md", "../../x.png")).toBe("/x.png")
  expect(besideFile(notes, "%E0%A4%A")).toBeNull()
})
