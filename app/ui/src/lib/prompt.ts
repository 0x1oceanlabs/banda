/**
 * A prompt is a string; the prompt editor shows it as a document of
 * paragraphs, one a line, styled as its markdown says, where what the text
 * points at is a chip (ADR 0015, decisions 2 and 3). A chip is one atom:
 * what it points at, written into the string in its kind's way, a file as
 * `@path`. A style keeps the delimiters it was written with, so the string
 * comes back as it was, character for character. These turn one into the
 * other, and find the word being typed. Pure, so plain tests cover them.
 */
import type { JSONContent } from "@tiptap/core"
import type { Fragment, Mark, Node } from "@tiptap/pm/model"

/** What a chip points at, and how each kind is written and read. */
export const KINDS = {
  file: {
    write: (path: string) => `@${path}`,
    /** `@` at a word's start, then a path with a folder or an extension
     * in it, so a name such as `@here` stays text; a full stop, a comma or
     * a style's delimiter after it is not part of it. */
    read: /(^|\s)@([^\s@]*[./][^\s@]*[^\s@.,;:!?)\]*~`])(?=[.,;:!?)\]*~`]*(?:\s|$))/g,
    /** Its name, the last part of its path. */
    label: (path: string) => path.slice(path.lastIndexOf("/") + 1),
  },
} as const

export type ChipKind = keyof typeof KINDS

/** How text is styled: strike `~~`, bold `**` or `__`, italic `*` or `_`,
 * code `` ` ``. Of two styles over the same text, written inside as many
 * styles, the one earlier here is written outside. */
const ORDER = ["strike", "bold", "italic", "code"] as const
export type MarkName = (typeof ORDER)[number]

/** What stands for a chip in text read to find the word being typed. */
export const CHIP_MARK = "￼"

/** A chip of `kind` that points at `value`. */
export function chip(kind: ChipKind, value: string): JSONContent {
  return { type: "chip", attrs: { kind, value } }
}

/** The document that shows `text`: a paragraph for each line, styled as
 * its markdown says, what it points at as chips. */
export function docOf(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => {
      const content = inline(line)
      return { type: "paragraph", ...(content.length > 0 && { content }) }
    }),
  }
}

/** A line's text and chips, styled. A chip stands in as a character the
 * line has not got while the styles are read, so a chip in code stays its
 * text and a style around a chip takes it in. */
function inline(line: string): JSONContent[] {
  let stand = 0xe000
  while (line.includes(String.fromCodePoint(stand))) stand += 1
  const chipAt = String.fromCodePoint(stand)
  const paths: string[] = []
  const shown = line.replace(
    KINDS.file.read,
    (_, space: string, path: string) => {
      paths.push(path)
      return space + chipAt
    }
  )
  const parts: JSONContent[] = []
  for (const { text, marks } of spansOf(shown)) {
    const styled = marks.length > 0 ? { marks } : {}
    const code = marks.some((mark) => mark.type === "code")
    text.split(chipAt).forEach((piece, index) => {
      if (index > 0) {
        const path = paths.shift() ?? ""
        parts.push(
          code
            ? { type: "text", text: KINDS.file.write(path), ...styled }
            : { ...chip("file", path), ...styled }
        )
      }
      if (piece) parts.push({ type: "text", text: piece, ...styled })
    })
  }
  return parts
}

/** A style as read: its delimiter, and how many styles it was written
 * inside, so of two over the same text the one outside stays outside. */
type StyledMark = {
  type: MarkName
  attrs: { delimiter: string; depth: number }
}
type Span = { text: string; marks: StyledMark[] }

/** A line read as markdown's inline styles: bold, italic, strike, code.
 * Only a pair of delimiters styles; one left open is text, and so is
 * what a backslash escapes, the backslash kept. */
function spansOf(text: string): Span[] {
  const root: Span[] = []
  const open: { mark: MarkName; delimiter: string; spans: Span[] }[] = []
  const into = () => open.at(-1)?.spans ?? root
  const asText = (frame: (typeof open)[number]) => {
    add(into(), frame.delimiter)
    for (const span of frame.spans) add(into(), span.text, span.marks)
  }
  const styled = (mark: MarkName, delimiter: string): StyledMark => ({
    type: mark,
    attrs: { delimiter, depth: open.length },
  })
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === "\\") {
      add(into(), text.slice(at, at + 2))
      at += 2
      continue
    }
    if (char === "`") {
      TICKS.lastIndex = at
      const run = TICKS.exec(text)![0]
      const close = text.indexOf("`", at + 1)
      if (run.length === 1 && close > at + 1 && text[close + 1] !== "`") {
        add(into(), text.slice(at + 1, close), [styled("code", "`")])
        at = close + 1
      } else {
        add(into(), run)
        at += run.length
      }
      continue
    }
    if (char !== "*" && char !== "_" && char !== "~") {
      PLAIN.lastIndex = at
      const run = PLAIN.exec(text)![0]
      add(into(), run)
      at += run.length
      continue
    }
    // A run of one delimiter: what it touches says whether it can open a
    // style or close one; `_` inside a word does neither, as in snake_case.
    let end = at
    while (text[end] === char) end += 1
    const before = text[at - 1] ?? ""
    const after = text[end] ?? ""
    const canClose =
      before !== "" && !/\s/.test(before) && (char !== "_" || !/\w/.test(after))
    const canOpen =
      after !== "" && !/\s/.test(after) && (char !== "_" || !/\w/.test(before))
    while (at < end) {
      const top = open.at(-1)
      const boldInItalic =
        top?.mark === "italic" &&
        end - at === 2 &&
        canOpen &&
        !open.some((frame) => frame.mark === "bold")
      if (
        !boldInItalic &&
        canClose &&
        top &&
        text.startsWith(top.delimiter, at) &&
        at + top.delimiter.length <= end
      ) {
        open.pop()
        const mark = styled(top.mark, top.delimiter)
        const first = top.spans[0]
        const last = into().at(-1)?.marks ?? []
        // A pair with nothing between is text, as no style can be empty, and
        // so is one that would run on into a style just before it.
        if (
          !first ||
          [mark, ...first.marks].some((one) => last.some((it) => same(one, it)))
        ) {
          asText(top)
          add(into(), top.delimiter)
        } else
          for (const span of top.spans)
            add(into(), span.text, [mark, ...span.marks])
        at += top.delimiter.length
        continue
      }
      const length = Math.min(end - at, 2)
      const mark = char === "~" ? "strike" : length === 2 ? "bold" : "italic"
      // A style never holds itself, so the delimiters it meets are text.
      if (
        !canOpen ||
        (char === "~" && length < 2) ||
        open.some((frame) => frame.mark === mark)
      ) {
        add(into(), text.slice(at, end))
        at = end
        continue
      }
      open.push({ mark, delimiter: char.repeat(length), spans: [] })
      at += length
    }
  }
  // What is left open was text all along.
  for (let frame = open.pop(); frame; frame = open.pop()) asText(frame)
  return root
}

const PLAIN = /[^\\`*_~]+/y
const TICKS = /`+/y

/** Adds text to `spans`, onto the last one if it is styled the same. */
function add(spans: Span[], text: string, marks: StyledMark[] = []) {
  if (!text) return
  const last = spans.at(-1)
  if (last && alike(last.marks, marks)) last.text += text
  else spans.push({ text, marks })
}

function alike(a: StyledMark[], b: StyledMark[]) {
  return a.length === b.length && a.every((mark, at) => same(mark, b[at]))
}

function same(a: StyledMark, b: StyledMark) {
  return (
    a.type === b.type &&
    a.attrs.delimiter === b.attrs.delimiter &&
    a.attrs.depth === b.attrs.depth
  )
}

/** What a leaf writes into the text: a chip what it points at. */
function sourceOf(leaf: Node): string {
  const { kind, value } = leaf.attrs
  return kind in KINDS ? KINDS[kind as ChipKind].write(String(value)) : ""
}

/** The text `content` shows: its paragraphs, a line each. */
export function textOf(content: Fragment): string {
  const lines: string[] = []
  content.forEach((block) => {
    // A paragraph an edit left alone is the same node, its line known.
    let line = LINES.get(block)
    if (line === undefined) LINES.set(block, (line = lineOf(block)))
    lines.push(line)
  })
  return lines.join("\n")
}

const LINES = new WeakMap<Node, string>()

/** A paragraph's line: its text and its chips as what they write, each
 * style between the delimiters it was written with. */
function lineOf(block: Node): string {
  // Markdown cannot open a style before a space nor close one after it,
  // so the spaces at a styled run's edges are written outside it.
  const pieces: { leaf: Node; marks: readonly Mark[]; blank: boolean }[] = []
  block.forEach((leaf) => {
    if (!leaf.isText || leaf.marks.some(isCode)) {
      pieces.push({ leaf, marks: leaf.marks, blank: false })
      return
    }
    const text = leaf.text ?? ""
    const start = text.length - text.trimStart().length
    const end = Math.max(start, text.trimEnd().length)
    let from = 0
    for (const to of [start, end, text.length]) {
      if (to > from)
        pieces.push({
          leaf: leaf.cut(from, to),
          marks: leaf.marks,
          blank: from !== start || to !== end,
        })
      from = to
    }
  })
  for (const style of ORDER)
    for (const step of [1, -1]) {
      let inside = false
      for (
        let at = step === 1 ? 0 : pieces.length - 1;
        at >= 0 && at < pieces.length;
        at += step
      ) {
        const piece = pieces[at]
        if (!piece.marks.some((mark) => name(mark) === style)) inside = false
        else if (!piece.blank) inside = true
        else if (!inside)
          piece.marks = piece.marks.filter((mark) => name(mark) !== style)
      }
    }

  // Of a piece's styles, the one that runs on longest is written outside,
  // then the one that was outside, and those it shares with the piece
  // before stay in the same order, `kept` of them.
  const order: Mark[][] = []
  let after: { mark: Mark; end: number }[] = []
  for (let at = pieces.length - 1; at >= 0; at -= 1) {
    const runs = pieces[at].marks.map((mark) => ({
      mark,
      end: after.find((run) => run.mark.eq(mark))?.end ?? at,
    }))
    runs.sort(
      (a, b) =>
        b.end - a.end ||
        depth(a.mark) - depth(b.mark) ||
        ORDER.indexOf(name(a.mark)) - ORDER.indexOf(name(b.mark))
    )
    order[at] = runs.map((run) => run.mark)
    after = runs
  }
  const kept = order.map(() => 0)
  for (let at = 1; at < order.length; at += 1) {
    while (order[at - 1][kept[at]]?.isInSet(order[at])) kept[at] += 1
    const shared = order[at - 1].slice(0, kept[at])
    order[at] = [
      ...shared,
      ...order[at].filter((mark) => !mark.isInSet(shared)),
    ]
  }
  return pieces
    .map(({ leaf }, at) => {
      const opens = order[at].slice(kept[at]).map(delimiter)
      const closes = order[at].slice(kept[at + 1] ?? 0).map(delimiter)
      const text = leaf.isText ? (leaf.text ?? "") : sourceOf(leaf)
      return opens.join("") + text + closes.reverse().join("")
    })
    .join("")
}

const name = (mark: Mark) => mark.type.name as MarkName
const isCode = (mark: Mark) => Boolean(mark.type.spec.code)
const depth = (mark: Mark) => Number(mark.attrs.depth)
const delimiter = (mark: Mark) => String(mark.attrs.delimiter)

/** A word being typed that asks for suggestions: `/` and a command's
 * name at a line's start, or `@` and a file's name at a word's start. */
export type Typing = { trigger: "/" | "@"; word: string }

/** The word a line's text before the caret ends with, if it asks for
 * suggestions; a chip in it is {@link CHIP_MARK}, so none is taken for
 * typing. */
export function typingIn(before: string): Typing | undefined {
  const command = /^\/([^\s/]*)$/.exec(before)
  if (command) return { trigger: "/", word: command[1] }
  const file = new RegExp(`(?:^|\\s)@([^\\s@${CHIP_MARK}]*)$`).exec(before)
  if (file) return { trigger: "@", word: file[1] }
  return undefined
}
