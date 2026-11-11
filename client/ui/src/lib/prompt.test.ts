import { getSchema } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Node } from "@tiptap/pm/model"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { expect, test } from "vitest"
import { PROMPT_BLOCKS } from "../components/prompt-blocks"
import { Chip } from "../components/prompt-chip"
import { CodeBlock } from "../components/prompt-code"
import { PROMPT_MARKS } from "../components/prompt-marks"
import { docOf, quoted, rechip, textOf, typingIn } from "./prompt"

const schema = getSchema([
  Document,
  Paragraph,
  Text,
  Chip,
  ...PROMPT_MARKS,
  ...PROMPT_BLOCKS,
  CodeBlock,
])
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

test("a skill the Harness has, named with $, is a chip that writes it back", () => {
  const skills = new Set(["explain", "review:deep"])
  const text =
    "$explain this, then *see $review:deep* it.\n$5 and $other stay, as `$explain` does"
  const doc = Node.fromJSON(schema, docOf(text, { skills }))
  expect(textOf(doc.content)).toBe(text)
  const chips: string[] = []
  doc.descendants((child) => {
    if (child.type.name === "chip")
      chips.push(`${child.attrs.kind}:${child.attrs.value}`)
  })
  expect(chips).toEqual(["skill:explain", "skill:review:deep"])
  // A skill the Harness has not said is text.
  expect(back("$explain this")).toBe("$explain this")
  expect(node("$explain this").firstChild?.firstChild?.isText).toBe(true)
})

test("skills said later make chips of their names, and one gone is text", () => {
  const text = "$explain it, `$explain`, $review"
  const doc = Node.fromJSON(
    schema,
    docOf(text, { skills: new Set(["review"]) })
  )
  let state = EditorState.create({ schema, doc })
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
  const tr = rechip(state, { skills: new Set(["explain"]) })
  if (!tr) throw new Error("nothing changed")
  const now = state.apply(tr)
  expect(textOf(now.doc.content)).toBe(text)
  const chips: string[] = []
  now.doc.descendants((child) => {
    if (child.type.name === "chip") chips.push(child.attrs.value)
  })
  expect(chips).toEqual(["explain"])
  expect(now.selection.to).toBe(now.doc.content.size - 1)
  expect(rechip(now, { skills: new Set(["explain"]) })).toBeUndefined()
})

/** The chips in `doc`, each as its kind and what it points at. */
const chipsIn = (doc: Node) => {
  const chips: string[] = []
  doc.descendants((child) => {
    if (child.type.name === "chip")
      chips.push(`${child.attrs.kind}:${child.attrs.value}`)
  })
  return chips
}

test("a sub-agent of the Thread is a chip that writes words about it, and back", () => {
  const subagents = new Set(["Reviewer", "Kim's notes", "$explain"])
  const text =
    "(about sub-agent 'Reviewer') skip card.ts.\n" +
    "(about sub-agent 'Kim's notes'), and (about sub-agent '$explain')\n" +
    "(about sub-agent 'Other') stays, as `(about sub-agent 'Reviewer')` does"
  const doc = Node.fromJSON(
    schema,
    docOf(text, { subagents, skills: new Set(["explain"]) })
  )
  expect(textOf(doc.content)).toBe(text)
  // An apostrophe in a label is read up to the `')` that closes it, and a
  // skill in a label stays in it.
  expect(chipsIn(doc)).toEqual([
    "subagent:Reviewer",
    "subagent:Kim's notes",
    "subagent:$explain",
  ])
  // Words about one the Thread has not are text.
  expect(chipsIn(node(text))).toEqual([])
})

test("sub-agents the Thread has later make chips of their words, and one gone is text", () => {
  const text =
    "(about sub-agent 'Reviewer') and (about sub-agent 'Agent 2') $explain"
  const doc = Node.fromJSON(
    schema,
    docOf(text, { subagents: new Set(["Agent 2"]) })
  )
  const state = EditorState.create({ schema, doc })
  const tr = rechip(state, {
    subagents: new Set(["Reviewer"]),
    skills: new Set(["explain"]),
  })
  if (!tr) throw new Error("nothing changed")
  const now = state.apply(tr)
  expect(textOf(now.doc.content)).toBe(text)
  expect(chipsIn(now.doc)).toEqual(["subagent:Reviewer", "skill:explain"])
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
    // What starts a line.
    "\n- ",
    "\n1. ",
    "\n# ",
    "\n> ",
    "\n---",
    "\n  * ",
    "[ ] ",
    "[x]",
    "\n```",
    "\n~~~",
    "````",
    "ts",
    "\t",
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

/** Each line's block: its kind and what it holds. */
const blocks = (text: string) => {
  const lines: string[] = []
  node(text).forEach((block) => {
    const attrs = Object.entries(block.attrs)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ")
    lines.push(
      `${block.type.name}${attrs ? ` ${attrs}` : ""}: ${block.textContent}`
    )
  })
  return lines
}

test("how a line starts says what it is, written back as it was", () => {
  const text = [
    "# Title",
    "###  Small",
    "> quoted",
    ">close",
    "- one",
    "  * two",
    "+ three",
    "1. first",
    "10) tenth",
    "- [ ] to do",
    "- [x] done",
    "-",
    "---",
    "* * *",
    "#tag and -dash and 1.5",
  ].join("\n")
  expect(back(text)).toBe(text)
  expect(blocks(text)).toEqual([
    'heading level=1 space=" ": Title',
    'heading level=3 space="  ": Small',
    'quote prefix="> ": quoted',
    'quote prefix=">": close',
    'item indent="" marker="-" space=" " check=null checkSpace="": one',
    'item indent="  " marker="*" space=" " check=null checkSpace="": two',
    'item indent="" marker="+" space=" " check=null checkSpace="": three',
    'item indent="" marker="1." space=" " check=null checkSpace="": first',
    'item indent="" marker="10)" space=" " check=null checkSpace="": tenth',
    'item indent="" marker="-" space=" " check=" " checkSpace=" ": to do',
    'item indent="" marker="-" space=" " check="x" checkSpace=" ": done',
    'item indent="" marker="-" space="" check=null checkSpace="": ',
    'rule source="---": ',
    'rule source="* * *": ',
    "paragraph: #tag and -dash and 1.5",
  ])
})

test("a fence's lines are code, as they are, to the line closing it", () => {
  const text =
    "```sh\n# a comment\n- not a list *or* @a/b.ts\n```\n# after\n~~~~\n~~~\n~~~~ \n```\n```"
  expect(back(text)).toBe(text)
  expect(blocks(text)).toEqual([
    'codeBlock fence="```" language="sh" close="```" hollow=false: # a comment\n- not a list *or* @a/b.ts',
    'heading level=1 space=" ": after',
    'codeBlock fence="~~~~" language="" close="~~~~ " hollow=false: ~~~',
    'codeBlock fence="```" language="" close="```" hollow=true: ',
  ])
  // A fence left open runs to the end; one with ` after its backticks is
  // not a fence.
  for (const open of ["```ts\nconst a = 1", "```", "```\n", "``` a`b"])
    expect(back(open)).toBe(open)
  expect(blocks("``` a`b")).toEqual(["paragraph: ``` a`b"])
})

test("code is written so that it reads back as it is", () => {
  const code = (text: string, close: string | null) =>
    schema.nodes.codeBlock.create(
      { fence: "```", language: "md", close },
      text ? schema.text(text) : null
    )
  const line = schema.nodes.paragraph.create(null, schema.text("after"))
  const doc = (...content: Node[]) => schema.node("doc", null, content)
  // Code holding a closing fence is fenced longer.
  expect(textOf(doc(code("```\nx", "```")).content)).toBe(
    "````md\n```\nx\n````"
  )
  // Code left open closes before what comes after it.
  expect(textOf(doc(code("x", null), line).content)).toBe(
    "```md\nx\n```\nafter"
  )
})

test("an item given text is written with a space after its marker", () => {
  const item = schema.nodes.item.create(
    { marker: "-", space: "", check: " ", checkSpace: "" },
    schema.text("x")
  )
  expect(textOf(schema.node("doc", null, [item]).content)).toBe("- [ ] x")
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
  expect(typingIn("then $exp")).toEqual({ trigger: "$", word: "exp" })
  expect(typingIn("$")).toEqual({ trigger: "$", word: "" })
  // Not a command past a line's start, a path, an address, a word the
  // caret has left, or a chip.
  expect(typingIn("see /rev")).toBeUndefined()
  expect(typingIn("/a/b")).toBeUndefined()
  expect(typingIn("me@home")).toBeUndefined()
  expect(typingIn("@notes and")).toBeUndefined()
  expect(typingIn("@￼")).toBeUndefined()
  // Nor a price, or a skill's name inside a word.
  expect(typingIn("costs $5")).toBeUndefined()
  expect(typingIn("a$b")).toBeUndefined()
})

test("a quote's lines each start with >, a blank one too", () => {
  expect(quoted("  one  \n\ntwo\n")).toBe("> one\n>\n> two")
  const doc = docOf(quoted("one\n\ntwo"))
  expect(doc.content?.map((line) => line.type)).toEqual([
    "quote",
    "quote",
    "quote",
  ])
})
