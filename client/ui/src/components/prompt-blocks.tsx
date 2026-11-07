import {
  Extension,
  InputRule,
  Node,
  nodeInputRule,
  textblockTypeInputRule,
} from "@tiptap/core"
import { splitBlockAs } from "@tiptap/pm/commands"
import type { Node as Block } from "@tiptap/pm/model"
import type { Command, EditorState, Transaction } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

/**
 * The lines of a prompt that are more than text (ADR 0015, decision 3):
 * headings, quotes, items of a list and rules, each one line, each
 * keeping how its line was written so the text comes back as it was.
 * Typing how one starts at a line's start makes the line one;
 * Backspace at its start makes it text again.
 */

/** What every line but a rule is: one block of text. */
const LINE = { group: "block line", content: "inline*", defining: true }

/** Attributes kept for how a line was written, not drawn. */
export function kept(defaults: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      { default: value, rendered: false },
    ])
  )
}

/** `# ` to `###### `. */
export const Heading = Node.create({
  name: "heading",
  ...LINE,
  addAttributes: () => kept({ level: 1, space: " " }),
  renderHTML({ node }) {
    const level = Math.min(Number(node.attrs.level), 3)
    return [`h${node.attrs.level}`, { class: HEADING[level - 1] }, 0]
  },
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^(#{1,6})\s$/,
        type: this.type,
        getAttributes: (match) => ({ level: match[1].length }),
      }),
    ]
  },
})

const HEADING = [
  "text-xl font-semibold",
  "text-lg font-semibold",
  "font-semibold",
]

/** `> `, a line of a quote; lines of one quote run on as one. */
export const Quote = Node.create({
  name: "quote",
  ...LINE,
  addAttributes: () => kept({ prefix: "> " }),
  renderHTML() {
    return [
      "blockquote",
      { class: "border-l-2 border-border pl-3 text-muted-foreground" },
      0,
    ]
  },
  addInputRules() {
    return [textblockTypeInputRule({ find: /^>\s$/, type: this.type })]
  },
})

/** `---`, `***` or `___`, a rule across the box. */
export const Rule = Node.create({
  name: "rule",
  group: "block",
  addAttributes: () => kept({ source: "---" }),
  renderHTML() {
    return ["div", { class: "py-2" }, ["hr", { class: "border-border" }]]
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:---|___\s|\*\*\*\s)$/,
        type: this.type,
        getAttributes: (match) => ({ source: match[0].trim() }),
      }),
    ]
  },
})

/**
 * An item of a list: `- `, `* ` or `+ `, `1. ` or `1) `, and `- [ ] `
 * for a task, whose box is ticked with a click. As far in as the spaces
 * before its marker; Tab takes it in a step, Shift+Tab out ({@link itemKey}).
 */
export const Item = Node.create({
  name: "item",
  ...LINE,
  addAttributes: () =>
    kept({ indent: "", marker: "-", space: " ", check: null, checkSpace: " " }),
  renderHTML() {
    return ["li", 0]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let item = node
      const dom = document.createElement("div")
      dom.dataset.item = ""
      dom.className = "flex items-baseline gap-1.5"
      const marker = document.createElement("span")
      marker.contentEditable = "false"
      marker.className =
        "flex min-w-4 shrink-0 justify-center text-muted-foreground tabular-nums select-none"
      const contentDOM = document.createElement("div")
      contentDOM.className = "min-w-0 flex-1"
      dom.append(marker, contentDOM)
      const box = document.createElement("input")
      box.type = "checkbox"
      box.className = "size-3.5 translate-y-0.5 accent-primary"
      // The box ticks itself as it is clicked, and the item says so; the
      // caret stays in the box.
      box.addEventListener("mousedown", (event) => event.preventDefault())
      box.addEventListener("click", () => {
        const at = getPos()
        if (at === undefined) return
        const check = item.attrs.check === " " ? "x" : " "
        editor.view.dispatch(
          editor.state.tr.setNodeAttribute(at, "check", check)
        )
      })
      const draw = () => {
        const { indent, marker: written, check } = item.attrs
        dom.style.paddingInlineStart = `${widthOf(indent)}ch`
        const done = check !== null && check !== " "
        contentDOM.classList.toggle("text-muted-foreground", done)
        contentDOM.classList.toggle("line-through", done)
        if (check === null) {
          marker.textContent = /\d/.test(written) ? written : "•"
          return
        }
        box.checked = done
        box.ariaLabel = done ? "Done" : "To do"
        if (box.parentNode !== marker) marker.replaceChildren(box)
      }
      draw()
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== item.type) return false
          // Typing in it leaves its attributes as they were.
          const redraw = next.attrs !== item.attrs
          item = next
          if (redraw) draw()
          return true
        },
        stopEvent: (event) => marker.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" && marker.contains(mutation.target),
      }
    }
  },
  addInputRules() {
    const type = this.type
    return [
      textblockTypeInputRule({
        find: /^([-*+]|\d{1,9}[.)])\s$/,
        type,
        getAttributes: (match) => ({ marker: match[1] }),
      }),
      // `[ ] ` or `[x] ` at an item's start makes it a task.
      new InputRule({
        find: /^\[([ xX])\]\s$/,
        handler({ state, range, match }) {
          const $from = state.doc.resolve(range.from)
          const block = $from.parent
          if (block.type !== type || block.attrs.check !== null) return null
          state.tr
            .delete(range.from, range.to)
            .setNodeAttribute($from.before(), "check", match[1])
            .setNodeAttribute($from.before(), "checkSpace", " ")
        },
      }),
    ]
  },
})

/**
 * Tab takes the caret's item a step in, and Shift+Tab out, before the
 * box's owner sees them; on an item already at the start Shift+Tab is
 * left to the owner.
 */
export function itemKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false
  const { state } = view
  const { $from } = state.selection
  if ($from.parent.type.name !== "item") return false
  const indent: string = $from.parent.attrs.indent
  const next = step(indent, !event.shiftKey)
  if (next === indent) return false
  view.dispatch(state.tr.setNodeAttribute($from.before(), "indent", next))
  return true
}

/** `line` a step further in, two spaces, or out, a tab or up to two. */
export function step(line: string, deeper: boolean) {
  return deeper ? STEP + line : line.replace(/^(\t| {1,2})/, "")
}

const STEP = "  "

/** How wide the spaces before a marker are, a tab four. */
function widthOf(indent: string) {
  return indent.replaceAll("\t", "    ").length * 1.25
}

/** Backspace at the start of a heading, a quote or an item makes it text,
 * keeping what it says. */
const Unstyle = Extension.create({
  name: "unstyle",
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parentOffset !== 0) return false
        if (!$from.parent.type.isInGroup("line")) return false
        view.dispatch(toText(state))
        return true
      },
    }
  },
})

/** Makes the caret's line text, keeping what it says. */
function toText(state: EditorState): Transaction {
  const { $from } = state.selection
  return state.tr.setNodeMarkup($from.before(), state.schema.nodes.paragraph)
}

/**
 * Starts a line, as Shift+Enter does: a list and a quote go on, the next
 * item numbered on and its box not ticked; an empty item or line of a
 * quote ends them; after a heading comes text.
 */
export const newLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  const block = $from.parent
  const { paragraph } = state.schema.nodes
  if (
    empty &&
    block.content.size === 0 &&
    (block.type.name === "item" || block.type.name === "quote")
  ) {
    dispatch?.(toText(state))
    return true
  }
  return splitBlockAs((node: Block, atEnd) => {
    if (node.type.name === "item")
      return { type: node.type, attrs: nextItem(node.attrs) }
    if (node.type.name === "quote")
      return { type: node.type, attrs: node.attrs }
    if (node.type.name === "heading" && atEnd) return { type: paragraph }
    return null
  })(state, dispatch)
}

/** The item after one: numbered on, its box, if it has one, not ticked. */
function nextItem(attrs: Record<string, unknown>) {
  const marker = String(attrs.marker).replace(/\d+/, (n) =>
    String(Number(n) + 1)
  )
  return { ...attrs, marker, check: attrs.check === null ? null : " " }
}

/** Headings, quotes, rules and lists, and Backspace to undo them. */
export const PROMPT_BLOCKS = [Heading, Quote, Rule, Item, Unstyle]
