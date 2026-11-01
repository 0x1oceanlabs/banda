import { type Mark, markInputRule } from "@tiptap/core"
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
        class: "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
      },
    }),
    [[codeInput, "`"]]
  ),
]
