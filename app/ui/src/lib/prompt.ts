/**
 * A prompt is a string; the prompt editor shows it as a document of lines,
 * one block a line, where what the text points at is a chip (ADR 0015,
 * decisions 2 and 3). How a line starts says what it is: `# ` a heading,
 * `> ` a quote, `- `, `1. ` or `- [ ] ` an item of a list, `---` a rule;
 * the rest is text, styled as its markdown says. A list is its items,
 * each as far in as the spaces before its marker say, so a line is always
 * one block. A chip is one atom: what it points at, written into the
 * string in its kind's way, a file as `@path`. Each block keeps how its
 * line started and each style the delimiters it was written with, so the
 * string comes back as it was, character for character. These turn one
 * into the other, and find the word being typed. Pure, so plain tests
 * cover them.
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

/** `text` as the lines of a quote: each `> ` and the line, a blank one
 * `>`. */
export function quoted(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trimEnd()}` : ">"))
    .join("\n")
}

/** What stands for a chip in text read to find the word being typed. */
export const CHIP_MARK = "￼"

/** A chip of `kind` that points at `value`. */
export function chip(kind: ChipKind, value: string): JSONContent {
  return { type: "chip", attrs: { kind, value } }
}

/** The document that shows `text`: a paragraph for each line, styled as
 * its markdown says, what it points at as chips. */
export function docOf(text: string): JSONContent {
  const lines = text.split("\n")
  const content: JSONContent[] = []
  for (let at = 0; at < lines.length; at += 1) {
    const open = openingFence(lines[at])
    if (!open) {
      content.push(blockOf(lines[at]))
      continue
    }
    // A fence's lines are code, as they are, to the line that closes it
    // or the end of the text.
    let end = at + 1
    while (end < lines.length && !closes(lines[end], open.fence)) end += 1
    const code = lines.slice(at + 1, end).join("\n")
    content.push({
      type: "codeBlock",
      attrs: { ...open, close: lines[end] ?? null, hollow: end === at + 1 },
      ...(code && { content: [{ type: "text", text: code }] }),
    })
    at = end
  }
  return { type: "doc", content }
}

/** The fence a line opens, and the language written after it; a fence of
 * backticks cannot have one in its language. */
export function openingFence(
  line: string
): { fence: string; language: string } | undefined {
  const found = /^(`{3,}|~{3,})(.*)$/.exec(line)
  if (!found || (found[1][0] === "`" && found[2].includes("`")))
    return undefined
  return { fence: found[1], language: found[2] }
}

const CLOSE = /^(`{3,}|~{3,})[ \t]*$/
/** Whether `line` closes `fence`: as long a run of the same, or longer. */
export function closes(line: string, fence: string) {
  const run = CLOSE.exec(line)?.[1]
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length
}

const RULE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const HEADING = /^(#{1,6})([ \t]+)/
const QUOTE = /^>[ \t]*/
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/
const CHECK = /^\[([ xX])\]([ \t]+|$)/

/** The block a line is, from how it starts. */
function blockOf(line: string): JSONContent {
  if (RULE.test(line)) return { type: "rule", attrs: { source: line } }
  const heading = HEADING.exec(line)
  if (heading)
    return textblock(
      "heading",
      { level: heading[1].length, space: heading[2] },
      line.slice(heading[0].length)
    )
  const quote = QUOTE.exec(line)
  if (quote)
    return textblock("quote", { prefix: quote[0] }, line.slice(quote[0].length))
  const item = ITEM.exec(line)
  if (item) {
    const [found, indent, marker, space] = item
    const rest = line.slice(found.length)
    // A task's box comes after the marker and a space.
    const check = space ? CHECK.exec(rest) : null
    return textblock(
      "item",
      {
        indent,
        marker,
        space,
        check: check?.[1] ?? null,
        checkSpace: check?.[2] ?? "",
      },
      rest.slice(check?.[0].length ?? 0)
    )
  }
  return textblock("paragraph", {}, line)
}

/** A block of `type` holding `text`, styled unless it is code. */
function textblock(
  type: string,
  attrs: Record<string, unknown>,
  text: string
): JSONContent {
  const content = inline(text)
  return {
    type,
    ...(Object.keys(attrs).length > 0 && { attrs }),
    ...(content.length > 0 && { content }),
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

/** The text `content` shows: its blocks, a line each. */
export function textOf(content: Fragment): string {
  const lines: string[] = []
  content.forEach((block, _, at) => {
    // A block an edit left alone is the same node, its line known.
    let line = LINES.get(block)
    if (line === undefined) LINES.set(block, (line = lineOf(block)))
    // Code that ran to the end closes before what now comes after it.
    const open = block.type.name === "codeBlock" && block.attrs.close === null
    if (open && at < content.childCount - 1) line += `\n${fenceOf(block)}`
    lines.push(line)
  })
  return lines.join("\n")
}

const LINES = new WeakMap<Node, string>()

/** A block's line: how it starts, then its text. */
function lineOf(block: Node): string {
  const { attrs } = block
  if (block.type.name === "rule") return String(attrs.source)
  if (block.type.name === "codeBlock") {
    const code = block.textContent
    const fence = fenceOf(block)
    // A longer fence opens, so it closes too.
    const closed = fence === attrs.fence ? attrs.close : fence
    const close = attrs.close === null ? "" : `\n${closed}`
    const lines = code === "" && attrs.hollow ? "" : `\n${code}`
    return fence + attrs.language + lines + close
  }
  const text = textIn(block)
  // What starts a line with text in it needs a space before the text, or
  // it would be read back as text.
  const gap = (space: string) => space || (text ? " " : "")
  switch (block.type.name) {
    case "heading":
      return "#".repeat(Number(attrs.level)) + String(attrs.space) + text
    case "quote":
      return String(attrs.prefix) + text
    case "item": {
      const start = String(attrs.indent) + String(attrs.marker)
      if (attrs.check === null) return start + gap(String(attrs.space)) + text
      const box = `${String(attrs.space) || " "}[${String(attrs.check)}]`
      return start + box + gap(String(attrs.checkSpace)) + text
    }
    default:
      return text
  }
}

/** The fence a code block is written with: its own, or a longer one if
 * a line of its code would close that. */
function fenceOf(block: Node): string {
  const fence: string = block.attrs.fence
  let longest = fence.length - 1
  for (const line of block.textContent.split("\n"))
    if (closes(line, fence))
      longest = Math.max(longest, /^[`~]+/.exec(line)![0].length)
  return fence[0].repeat(longest + 1)
}

/** A textblock's text and its chips as what they write, each style
 * between the delimiters it was written with. */
function textIn(block: Node): string {
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
