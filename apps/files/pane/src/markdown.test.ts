import { expect, test } from "vitest"
import { frontMatter } from "./markdown"

test("front matter is read apart from the markdown under it", () => {
  expect(
    frontMatter('---\nstatus: accepted\ndate: "2026-11-05"\n---\n\n# Title\n')
  ).toEqual({
    facts: [
      ["status", "accepted"],
      ["date", "2026-11-05"],
    ],
    body: "\n# Title\n",
  })
  // Lists and nested keys stay in the source.
  expect(frontMatter("---\ntags:\n  - a\n---\nText")?.facts).toEqual([
    ["tags", ""],
  ])
})

test("a rule that is not at the top, or never closed, is markdown", () => {
  expect(frontMatter("# Title\n\n---\n\nText")).toBeNull()
  expect(frontMatter("---\nstatus: open\n")).toBeNull()
})
