import { Node } from "@tiptap/core"
import { Fragment, type Schema } from "@tiptap/pm/model"
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { code as shiki } from "@streamdown/code"
import { kept, step } from "@banda/ui/components/prompt-blocks"
import { ALIASES, LANGUAGES } from "@banda/ui/lib/languages"
import { closes, openingFence, textOf } from "@banda/ui/lib/prompt"

/**
 * A block of code in a prompt (ADR 0015, decision 3): ``` and a language,
 * then Enter, starts one; in it Enter starts a line as far in as the one
 * before, Tab and Shift+Tab move the lines in and out, and Enter after a
 * closing fence or two empty lines leaves it. Its language is picked
 * above it, and Shiki colours it as it does an Agent's code. It keeps
 * its fence, its language as written, the line that closed it or that
 * none did (`null`), and whether it had no lines at all, so the text
 * comes back as it was.
 */
export const CodeBlock = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () =>
    kept({ fence: "```", language: "", close: null, hollow: false }),
  renderHTML() {
    return ["pre", ["code", 0]]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let block = node
      const dom = document.createElement("div")
      dom.dataset.code = ""
      dom.className = "my-1 overflow-hidden rounded-control border bg-muted/40"
      const head = document.createElement("div")
      head.contentEditable = "false"
      head.className = "flex justify-end border-b px-1.5 py-0.5"
      const pick = document.createElement("select")
      pick.ariaLabel = "Language"
      pick.className =
        "cursor-pointer rounded-small bg-transparent text-meta text-muted-foreground outline-none hover:text-foreground"
      pick.append(
        new Option("Plain text", ""),
        ...LANGUAGES.map(({ id, name }) => new Option(name, id))
      )
      // A language Shiki does not know is still the one written.
      const unknown = new Option()
      pick.addEventListener("change", () => {
        const at = getPos()
        if (at === undefined) return
        const { tr } = editor.state
        editor.view.dispatch(tr.setNodeAttribute(at, "language", pick.value))
      })
      head.append(pick)
      const pre = document.createElement("pre")
      pre.className = "overflow-x-auto px-2.5 py-1.5 font-mono text-ui"
      const contentDOM = document.createElement("code")
      pre.append(contentDOM)
      dom.append(head, pre)
      const draw = () => {
        const name = languageOf(block.attrs.language)
        const id = ALIASES.get(name)
        if (name && id === undefined) {
          unknown.value = unknown.text = name
          pick.prepend(unknown)
        } else unknown.remove()
        pick.value = id ?? name
      }
      draw()
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== block.type) return false
          const redraw = next.attrs.language !== block.attrs.language
          block = next
          if (redraw) draw()
          return true
        },
        stopEvent: (event) => head.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" && head.contains(mutation.target),
      }
    }
  },
  addProseMirrorPlugins() {
    return [colours()]
  },
})

/** The language a fence's info names: its first word. */
function languageOf(info: string): string {
  return info.trim().split(/\s/)[0].toLowerCase()
}

/** Whether the caret, and all that is chosen, is in one block of code. */
export function inCode(state: EditorState): boolean {
  const { $from, $to } = state.selection
  return Boolean($from.parent.type.spec.code) && $from.sameParent($to)
}

/**
 * The keys code takes before the box's owner sees them: Enter, which in
 * code starts a line, and after ``` and a language starts code; Tab and
 * Shift+Tab, which move its lines in and out; Backspace at its start,
 * which makes its lines text.
 */
export function codeKey(view: EditorView, event: KeyboardEvent): boolean {
  const { state } = view
  const dispatch = (tr: Transaction) => view.dispatch(tr.scrollIntoView())
  if (!inCode(state)) return event.key === "Enter" && startCode(state, dispatch)
  if (event.key === "Tab") return indent(state, !event.shiftKey, dispatch)
  if (event.key === "Backspace") return unwrap(state, dispatch)
  if (event.key !== "Enter") return false
  return (
    leaveAtFence(state, dispatch) ||
    leaveAfterBlanks(state, dispatch) ||
    lineAsBefore(state, dispatch)
  )
}

type Dispatch = (tr: Transaction) => void

/** The lines of `text` as paragraphs. */
function paragraphs(schema: Schema, text: string) {
  return text
    .split("\n")
    .map((line) =>
      schema.nodes.paragraph.create(null, line ? schema.text(line) : null)
    )
}

/** Where the lines from `from` to `to` in `text` start and end. */
function lineAround(text: string, from: number, to = from) {
  const start = text.lastIndexOf("\n", from - 1) + 1
  const after = text.indexOf("\n", to)
  return { start, end: after === -1 ? text.length : after }
}

/** Enter at the end of a line that is ``` and a language makes it code. */
function startCode(state: EditorState, dispatch: Dispatch) {
  const { $from, empty } = state.selection
  const line = $from.parent
  if (!empty || line.type.name !== "paragraph") return false
  if ($from.parentOffset !== line.content.size) return false
  const open = openingFence(textOf(Fragment.from(line)))
  if (!open) return false
  const start = $from.before()
  const block = state.schema.nodes.codeBlock.create({
    ...open,
    close: open.fence,
  })
  const tr = state.tr.replaceWith(start, $from.after(), block)
  dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)))
  return true
}

/** Backspace at the code's start makes its lines text, as they say. */
function unwrap(state: EditorState, dispatch: Dispatch) {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  const start = $from.before()
  const lines = paragraphs(state.schema, $from.parent.textContent)
  const tr = state.tr.replaceWith(start, $from.after(), lines)
  dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)))
  return true
}

/** Enter at the end of a line that closes the fence leaves the code: what
 * was after it is text again. */
function leaveAtFence(state: EditorState, dispatch: Dispatch) {
  const { $from, empty } = state.selection
  const block = $from.parent
  const text = block.textContent
  const caret = $from.parentOffset
  const { start, end } = lineAround(text, caret)
  const line = text.slice(start, end)
  if (!empty || caret !== end || !closes(line, block.attrs.fence)) return false
  const { schema } = state
  const code = text.slice(0, Math.max(0, start - 1))
  const closed = block.type.create(
    { ...block.attrs, close: line, hollow: start === 0 },
    code ? schema.text(code) : null
  )
  const at = $from.before()
  const tr = state.tr.replaceWith(at, $from.after(), [
    closed,
    ...paragraphs(schema, end < text.length ? `\n${text.slice(end + 1)}` : ""),
  ])
  dispatch(
    tr.setSelection(TextSelection.create(tr.doc, at + closed.nodeSize + 1))
  )
  return true
}

/** Enter after two empty lines at the code's end leaves it, without them. */
function leaveAfterBlanks(state: EditorState, dispatch: Dispatch) {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== $from.parent.content.size) return false
  const blanks = /\n[ \t]*\n[ \t]*$/.exec($from.parent.textContent)
  if (!blanks) return false
  const tr = state.tr.delete($from.pos - blanks[0].length, $from.pos)
  const after = tr.mapping.map($from.after())
  tr.insert(after, state.schema.nodes.paragraph.create())
  dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)))
  return true
}

/** Enter starts a line as far in as the one the caret is on. */
function lineAsBefore(state: EditorState, dispatch: Dispatch) {
  const { $from, from, to } = state.selection
  const text = $from.parent.textContent
  const { start } = lineAround(text, $from.parentOffset)
  const room = /^[ \t]*/.exec(text.slice(start, $from.parentOffset))![0]
  dispatch(state.tr.insertText(`\n${room}`, from, to))
  return true
}

/** Tab moves the chosen lines in a step, or puts a step at the caret;
 * Shift+Tab moves them out, if it can. */
function indent(state: EditorState, deeper: boolean, dispatch: Dispatch) {
  const { $from, from, to, empty } = state.selection
  if (empty && deeper) {
    dispatch(state.tr.insertText(step("", true), from, to))
    return true
  }
  const base = $from.start()
  const text = $from.parent.textContent
  const { start, end } = lineAround(
    text,
    from - base,
    Math.max(from, to - 1) - base
  )
  const lines = text.slice(start, end).split("\n")
  const moved = lines.map((line) => (line ? step(line, deeper) : line))
  const was = lines.join("\n")
  const now = moved.join("\n")
  // Lines at the start leave Shift+Tab to the box's owner.
  if (now === was) return deeper
  const tr = state.tr.insertText(now, base + start, base + end)
  const head = Math.max(base + start, from + moved[0].length - lines[0].length)
  const tail = Math.max(head, to + now.length - was.length)
  dispatch(tr.setSelection(TextSelection.create(tr.doc, head, tail)))
  return true
}

/** Code longer than this is left plain: colouring it would stall typing. */
const LONGEST = 20_000

const COLOURS = new PluginKey<DecorationSet>("prompt-code-colours")

/** A token's colour, as a part of its block's text. */
type Span = { from: number; to: number; style: string }

/**
 * Colours each block of code as Shiki reads it in the language it
 * names, in the theme's light and dark as an Agent's code is. Shiki
 * reads in the background, once for each text a block has; until it
 * has, what was coloured before stays, moved with the edit. What it read
 * is kept here, for the blocks there are, not in the cache the Thread's
 * code shares.
 */
function colours() {
  let view: EditorView | undefined
  const read = new Map<string, Span[]>()
  const asked = new Set<string>()
  const told = () => view?.dispatch(view.state.tr.setMeta(COLOURS, true))
  // Shiki's spans for `code`, if it has read it; if not, it is asked to,
  // once. Code the Thread has coloured comes at once, without a call back.
  const spansFor = (key: string, code: string, language: string) => {
    const known = read.get(key)
    if (known || asked.has(key)) return known
    const options = {
      code,
      language,
      themes: shiki.getThemes(),
      isIncomplete: true,
    }
    const now = shiki.highlight(
      options as Parameters<typeof shiki.highlight>[0],
      (result) => {
        asked.delete(key)
        read.set(key, spansOf(result.tokens))
        told()
      }
    )
    if (!now) return void asked.add(key)
    const spans = spansOf(now.tokens)
    read.set(key, spans)
    return spans
  }
  const paint = (state: EditorState, moved: DecorationSet) => {
    const marks: Decoration[] = []
    const live = new Set<string>()
    state.doc.forEach((block, at) => {
      if (block.type.name !== "codeBlock") return
      const code = block.textContent
      const language = ALIASES.get(languageOf(block.attrs.language))
      if (!code || code.length > LONGEST || language === undefined) return
      const key = `${language}\n${code}`
      live.add(key)
      const start = at + 1
      const spans = spansFor(key, code, language)
      if (!spans) {
        marks.push(...moved.find(start, start + block.content.size))
        return
      }
      for (const { from, to, style } of spans)
        marks.push(
          Decoration.inline(start + from, start + to, { style, class: TOKEN })
        )
    })
    for (const key of read.keys()) if (!live.has(key)) read.delete(key)
    return DecorationSet.create(state.doc, marks)
  }
  return new Plugin<DecorationSet>({
    key: COLOURS,
    state: {
      init: (_, state) => paint(state, DecorationSet.empty),
      apply(tr, old, _, state) {
        const moved = old.map(tr.mapping, tr.doc)
        if (!tr.docChanged && !tr.getMeta(COLOURS)) return moved
        return paint(state, moved)
      },
    },
    props: { decorations: (state) => COLOURS.getState(state) },
    view(editorView) {
      view = editorView
      return { destroy: () => (view = undefined) }
    },
  })
}

/** Shiki's tokens, a line each, as spans of the text they colour. */
function spansOf(
  tokens: { content: string; htmlStyle?: Record<string, string> }[][]
): Span[] {
  const spans: Span[] = []
  let offset = 0
  for (const line of tokens) {
    for (const { content, htmlStyle = {} } of line) {
      const style = Object.entries(htmlStyle)
        .map(([key, value]) => `${key === "color" ? "--sdm-c" : key}:${value}`)
        .join(";")
      if (style)
        spans.push({ from: offset, to: offset + content.length, style })
      offset += content.length
    }
    offset += 1
  }
  return spans
}

/** A token's colour, the dark one in the dark, as an Agent's code has. */
const TOKEN =
  "text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]"
