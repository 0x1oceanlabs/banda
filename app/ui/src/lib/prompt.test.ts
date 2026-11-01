import { getSchema } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Node } from "@tiptap/pm/model"
import { expect, test } from "vitest"
import { Chip } from "../components/prompt-chip"
import { docOf, textOf, typingIn } from "./prompt"

const schema = getSchema([Document, Paragraph, Text, Chip])
const node = (text: string) => Node.fromJSON(schema, docOf(text))
const back = (text: string) => textOf(node(text).content)

test("a prompt's lines are the document's paragraphs, and back", () => {
  for (const text of ["", "one", "one\ntwo", "a\n\nb\n"])
    expect(back(text)).toBe(text)
  expect(node("one\ntwo").childCount).toBe(2)
})

test("a file named in the text is a chip that writes it back", () => {
  const text =
    "look at @src/main.ts and @notes.md.\n@here stays, me@home too (@a/b)"
  expect(back(text)).toBe(text)
  const chips: string[] = []
  node(text).descendants((child) => {
    if (child.type.name === "chip") chips.push(child.attrs.value)
  })
  // A full stop or a bracket after a path is not part of it.
  expect(chips).toEqual(["src/main.ts", "notes.md"])
})

test("a word being typed asks for suggestions", () => {
  expect(typingIn("/rev")).toEqual({ trigger: "/", word: "rev" })
  expect(typingIn("/")).toEqual({ trigger: "/", word: "" })
  expect(typingIn("look at @src/ma")).toEqual({ trigger: "@", word: "src/ma" })
  expect(typingIn("@")).toEqual({ trigger: "@", word: "" })
  // Not a command past a line's start, a path, an address, a word the
  // caret has left, or a chip.
  expect(typingIn("see /rev")).toBeUndefined()
  expect(typingIn("/a/b")).toBeUndefined()
  expect(typingIn("me@home")).toBeUndefined()
  expect(typingIn("@notes and")).toBeUndefined()
  expect(typingIn("@￼")).toBeUndefined()
})
