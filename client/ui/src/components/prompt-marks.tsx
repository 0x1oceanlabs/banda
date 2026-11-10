import { type Mark, markInputRule } from "@tiptap/core"
import type { Mark as Style, Node as Block } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import Bold, {
  starInputRegex as boldStar,
  underscoreInputRegex as boldUnderscore,
} from "@tiptap/extension-bold"
import Code, { inputRegex as codeInput } from "@tiptap/extension-code"
import Italic, { starInputRegex as italicStar } from "@tiptap/extension-italic"
import Strike, { inputRegex as strikeInput } from "@tiptap/extension-strike"

/**
 * A style in a prompt (ADR 0015, decision 3) that keeps the delimiter it
 * was written with, and how many styles it was written inside, so the
 * text comes back as it was typed. Typing a pair
 * of one of its `typed` delimiters styles what is between them as the
 * second is typed, the first of them the one a style takes by default;
 * pasted text is read in full by the editor, so no paste rule is needed.
 */
function written(base: Mark, typed: [RegExp, string][]) {
  return base.extend({
    addAttributes() {
      return {
        delimiter: {
          default: typed[0][1],
          rendered: false,
        },
        depth: { default: 0, rendered: false },
      }
    },
    addInputRules() {
      return typed.map(([find, delimiter]) =>
        markInputRule({ find, type: this.type, getAttributes: { delimiter } })
      )
    },
    addPasteRules: () => [],
  })
}

/** Bold, italic, strike and code, as markdown writes them. Italic is
 * typed with `*` alone: `_` would take a name such as node_modules. Code
 * may be bold, as `**\`x\`**` reads. */
export const PROMPT_MARKS = [
  written(Bold, [
    [boldStar, "**"],
    [boldUnderscore, "__"],
  ]),
  written(Italic, [[italicStar, "*"]]),
  written(Strike, [[strikeInput, "~~"]]),
  written(
    Code.extend({ excludes: "code" }).configure({
      HTMLAttributes: {
        class: "rounded-small bg-muted px-1.5 py-0.5 font-mono text-sm",
      },
    }),
    [[codeInput, "`"]]
  ),
]

/** What a character typed over chosen text puts after it, as in T3 Code. */
const CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "<": ">",
  "«": "»",
}

/**
 * Typed with text chosen, `*` and `_` make it italic, and bold if it was
 * italic with them; `` ` `` makes it code; a bracket or a quote goes
 * around it. What was chosen stays chosen. Code is as it is typed.
 */
export function wrap(
  view: EditorView,
  from: number,
  to: number,
  typed: string
): boolean {
  const { state } = view
  const { selection, schema } = state
  const close = CLOSE[typed]
  if (
    (close === undefined && !STYLES.includes(typed)) ||
    view.composing ||
    !(selection instanceof TextSelection) ||
    selection.empty ||
    selection.from !== from ||
    selection.to !== to
  )
    return false
  const { italic, bold, code } = schema.marks
  let text = false
  let chips = false
  let blocked = false
  let italics = true
  state.doc.nodesBetween(from, to, (node) => {
    if (blocked) return false
    if (node.type.spec.code) blocked = true
    else if (!node.isInline) return true
    else if (!node.isText) chips = true
    else {
      text = true
      italics &&= node.marks.some(
        (style) => style.type === italic && style.attrs.delimiter === typed
      )
    }
    return false
  })
  // A chip must start a word and end one, so what goes round it would make
  // it text; code holds a chip's text, not a chip.
  if (blocked || !text || (chips && (close !== undefined || typed === "`")))
    return false
  const tr = state.tr
  if (close !== undefined) {
    // What goes round takes the styles that run on across its place.
    tr.insert(to, schema.text(close, across(state.doc, to)))
    tr.insert(from, schema.text(typed, across(state.doc, from)))
    tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1))
  } else if (typed === "`")
    tr.addMark(from, to, code.create({ delimiter: "`" }))
  else {
    if (italics) tr.removeMark(from, to, italic)
    const style = italics
      ? bold.create({ delimiter: typed.repeat(2) })
      : italic.create({ delimiter: typed })
    tr.addMark(from, to, style)
  }
  view.dispatch(tr)
  return true
}

/** What styles chosen text when typed over it. */
const STYLES = ["*", "_", "`"]

/** The styles of both sides of `at`. */
function across(doc: Block, at: number): readonly Style[] {
  const $at = doc.resolve(at)
  const after = $at.nodeAfter?.marks ?? []
  return ($at.nodeBefore?.marks ?? []).filter((style) => style.isInSet(after))
}
