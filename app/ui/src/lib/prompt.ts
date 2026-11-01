/**
 * A prompt is a string; the prompt editor shows it as a document of
 * paragraphs, one a line, where what the text points at is a chip (ADR
 * 0015, decision 2). A chip is one atom: what it points at, written into
 * the string in its kind's way, a file as `@path`. These turn one into
 * the other, and find the word being typed. Pure, so plain tests cover
 * them.
 */
import type { JSONContent } from "@tiptap/core"
import type { Fragment, Node } from "@tiptap/pm/model"

/** What a chip points at, and how each kind is written and read. */
export const KINDS = {
  file: {
    write: (path: string) => `@${path}`,
    /** `@` at a word's start, then a path with a folder or an extension
     * in it, so a name such as `@here` stays text; a full stop or comma
     * after it is not part of it. */
    read: /(^|\s)@([^\s@]*[./][^\s@]*[^\s@.,;:!?)\]])(?=[.,;:!?)\]]*(?:\s|$))/g,
    /** Its name, the last part of its path. */
    label: (path: string) => path.slice(path.lastIndexOf("/") + 1),
  },
} as const

export type ChipKind = keyof typeof KINDS

/** What stands for a chip in text read to find the word being typed. */
export const CHIP_MARK = "￼"

/** A chip of `kind` that points at `value`. */
export function chip(kind: ChipKind, value: string): JSONContent {
  return { type: "chip", attrs: { kind, value } }
}

/** The document that shows `text`: a paragraph for each line, what it
 * points at as chips. */
export function docOf(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => {
      const content = inline(line)
      return { type: "paragraph", ...(content.length > 0 && { content }) }
    }),
  }
}

function inline(line: string): JSONContent[] {
  const parts: JSONContent[] = []
  let from = 0
  for (const found of line.matchAll(KINDS.file.read)) {
    const start = found.index + found[1].length
    if (start > from)
      parts.push({ type: "text", text: line.slice(from, start) })
    parts.push(chip("file", found[2]))
    from = start + found[2].length + 1
  }
  if (from < line.length) parts.push({ type: "text", text: line.slice(from) })
  return parts
}

/** What a leaf writes into the text: a chip what it points at. */
function sourceOf(leaf: Node): string {
  const { kind, value } = leaf.attrs
  return kind in KINDS ? KINDS[kind as ChipKind].write(String(value)) : ""
}

/** The text `content` shows: its paragraphs, a line each, its chips as
 * what they write. */
export function textOf(content: Fragment): string {
  return content.textBetween(0, content.size, "\n", sourceOf)
}

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
