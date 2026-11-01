import { expect, test } from "vitest"
import { mention, mentioning } from "./mention"

test("a file is named by @ and a word before the caret", () => {
  expect(mentioning("look at @src/ma", 15)).toEqual({
    start: 8,
    word: "src/ma",
  })
  expect(mentioning("@", 1)).toEqual({ start: 0, word: "" })
  // An address, or a word the caret has left, names no file.
  expect(mentioning("me@home", 7)).toBeUndefined()
  expect(mentioning("@notes and more", 15)).toBeUndefined()
})

test("a file picked takes the place of what was typed, and the caret goes after it", () => {
  const text = "read @no then"
  const at = mentioning(text, 8)!
  expect(mention(text, at, "notes.md")).toEqual({
    text: "read @notes.md then",
    caret: 15,
  })
  expect(mention("@no", mentioning("@no", 3)!, "notes.md")).toEqual({
    text: "@notes.md ",
    caret: 10,
  })
})
