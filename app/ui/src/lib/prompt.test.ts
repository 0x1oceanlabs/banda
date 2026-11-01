import { getSchema } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Node } from "@tiptap/pm/model"
import { expect, test } from "vitest"
import { Chip } from "../components/prompt-chip"
import { PROMPT_MARKS } from "../components/prompt-marks"
import { docOf, textOf, typingIn } from "./prompt"

const schema = getSchema([Document, Paragraph, Text, Chip, ...PROMPT_MARKS])
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

/** The line's pieces: each text or chip with the styles it has. */
const styles = (text: string) => {
  const pieces: string[] = []
  node(text).descendants((child) => {
    if (!child.isInline) return
    const marks = child.marks.map((mark) => mark.type.name).join("+")
    const shown = child.isText ? child.text : `[${child.attrs.value}]`
    pieces.push(marks ? `${marks}:${shown}` : `${shown}`)
  })
  return pieces
}

test("markdown's inline styles are styles, written back as they were", () => {
  const cases: Record<string, string[]> = {
    "**bold** and __bold__": ["bold:bold", " and ", "bold:bold"],
    "*it* and _it_": ["italic:it", " and ", "italic:it"],
    "~~gone~~ `npm i`": ["strike:gone", " ", "code:npm i"],
    "***both*** *a **b** c*": [
      "bold+italic:both",
      " ",
      "italic:a ",
      "bold+italic:b",
      "italic: c",
    ],
    "**`x`**": ["bold+code:x"],
    "*__x__* and _**y**_": ["bold+italic:x", " and ", "bold+italic:y"],
    "`**not**`": ["code:**not**"],
  }
  for (const [text, pieces] of Object.entries(cases)) {
    expect(styles(text)).toEqual(pieces)
    expect(back(text)).toBe(text)
  }
})

test("text that only looks like markdown stays as it was", () => {
  for (const text of [
    "a_b_c and snake_case_name, foo__bar__baz",
    "2 * 3 * 4 and a*b",
    "*open and _open and **open and ~one~",
    "\\*not it\\* and C:\\path\\x",
    "<div> &amp; 5 > 3 and 1 < 2",
    "`` and ``` and `",
    "  indented\ttab ",
    "**** and ** **",
  ]) {
    expect(back(text)).toBe(text)
    expect(styles(text).filter((piece) => /^[a-z+]+:/.test(piece))).toEqual([])
  }
})

test("any text comes back as it was", () => {
  // Pieces markdown reads, mixed at random from a fixed seed.
  const pieces = [
    "*",
    "**",
    "_",
    "__",
    "~~",
    "~",
    "`",
    "\\",
    " ",
    "a",
    "b.c",
    "@a/b.ts",
    "\n",
    "x_y",
  ]
  let seed = 7
  const next = () => (seed = (seed * 48271) % 2147483647)
  for (let round = 0; round < 3000; round += 1) {
    let text = ""
    for (let count = next() % 12; count >= 0; count -= 1)
      text += pieces[next() % pieces.length]
    expect(back(text)).toBe(text)
  }
})

test("a chip takes the style around it, and in code it is text", () => {
  const text = "*see @src/main.ts* and `@src/main.ts`"
  expect(styles(text)).toEqual([
    "italic:see ",
    "italic:[src/main.ts]",
    " and ",
    "code:@src/main.ts",
  ])
  expect(back(text)).toBe(text)
  // A chip starts a word, and a delimiter after a path is not part of it.
  expect(styles("**@a/b.ts**")).toEqual(["bold:@a/b.ts"])
  expect(styles("**look @a/b.ts**")).toEqual(["bold:look ", "bold:[a/b.ts]"])
})

test("a style ending in a space is written with the space outside it", () => {
  const bold = schema.marks.bold.create()
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("a "),
      schema.text(" b c ", [bold]),
      schema.text("d"),
    ]),
  ])
  expect(textOf(doc.content)).toBe("a  **b c** d")
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
