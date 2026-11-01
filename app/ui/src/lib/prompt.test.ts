import { getSchema } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Node } from "@tiptap/pm/model"
import { expect, test } from "vitest"
import { docOf, offsetOf, posOf, textOf } from "./prompt"

const schema = getSchema([Document, Paragraph, Text])
const node = (text: string) => Node.fromJSON(schema, docOf(text))

test("a prompt's lines are the document's paragraphs, and back", () => {
  for (const text of ["", "one", "one\ntwo", "a\n\nb\n"])
    expect(textOf(node(text))).toBe(text)
  expect(node("one\ntwo").childCount).toBe(2)
})

test("the caret maps between the text and the document", () => {
  const doc = node("ab\n\ncd")
  // Each offset into the text has a place, and comes back the same.
  for (let offset = 0; offset <= "ab\n\ncd".length; offset++)
    expect(offsetOf(doc, posOf(doc, offset))).toBe(offset)
  // The second line starts in the second paragraph.
  expect(posOf(doc, 3)).toBe(5)
  // Past the end is the end.
  expect(offsetOf(doc, posOf(doc, 99))).toBe(6)
})
