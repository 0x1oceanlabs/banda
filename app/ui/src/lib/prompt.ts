/**
 * A prompt is a string; the prompt editor shows it as a document of
 * paragraphs, one a line. These turn one into the other and map the
 * caret between them. Pure, so plain tests cover them.
 */
import type { JSONContent } from "@tiptap/core"
import type { Node } from "@tiptap/pm/model"

/** The document that shows `text`: a paragraph for each line. */
export function docOf(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line && { content: [{ type: "text", text: line }] }),
    })),
  }
}

/** The text `doc` shows: its paragraphs, a line each. */
export function textOf(doc: Node): string {
  return doc.textBetween(0, doc.content.size, "\n")
}

/** How far into the text the document's position `pos` is. */
export function offsetOf(doc: Node, pos: number): number {
  return doc.textBetween(0, pos, "\n").length
}

/** The document's position `offset` into its text is at. */
export function posOf(doc: Node, offset: number): number {
  let left = Math.max(0, offset)
  let found: number | undefined
  doc.forEach((block, start) => {
    if (found !== undefined) return
    const size = block.textContent.length
    if (left <= size) found = start + 1 + left
    else left -= size + 1
  })
  return found ?? doc.content.size - 1
}
