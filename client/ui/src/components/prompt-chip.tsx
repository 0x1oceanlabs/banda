import { Node } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import type { Transaction } from "@tiptap/pm/state"
import { type ChipKind, KINDS } from "@banda/ui/lib/prompt"

/**
 * A chip in a prompt (ADR 0015, decision 2): one atom, which the caret
 * steps over and Backspace takes whole, showing what it points at with an
 * icon and a short name, the whole of it on hover, and writing it into
 * the text in its kind's way. A chip's removal is a step of its own to
 * undo, which brings it back with what it pointed at.
 */
export const Chip = Node.create({
  name: "chip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: {
        default: "file",
        parseHTML: (el) => el.dataset.chip,
        renderHTML: ({ kind }) => ({ "data-chip": kind }),
      },
      value: {
        default: "",
        parseHTML: (el) => el.dataset.value,
        renderHTML: ({ value }) => ({ "data-value": value }),
      },
    }
  },
  parseHTML() {
    return [{ tag: "span[data-chip]" }]
  },
  // However it goes, a chip's removal is a step of its own to undo, apart
  // from the typing before and after it.
  dispatchTransaction({ transaction, next }) {
    if (!removesChip(transaction)) return next(transaction)
    next(closeHistory(transaction))
    next(closeHistory(this.editor.state.tr))
  },
  // A chip never changes, so its view is plain DOM, not React.
  addNodeView() {
    return ({ node }) => {
      const kind = KINDS[node.attrs.kind as ChipKind] ?? KINDS.file
      const value = String(node.attrs.value)
      const dom = document.createElement("span")
      dom.dataset.chip = node.attrs.kind
      dom.dataset.value = value
      dom.title = value
      dom.className = CHIP
      dom.append(icon(kind.icon), kind.label(value))
      return { dom }
    }
  },
})

/** Whether `tr` takes away a chip: one in what a step of it replaced. */
function removesChip(tr: Transaction): boolean {
  return tr.steps.some((step, at) => {
    let found = false
    step.getMap().forEach((from, to) =>
      tr.docs[at].nodesBetween(from, to, (node) => {
        found ||= node.type.name === "chip"
        return !found
      })
    )
    return found
  })
}

/** As inline code in a reply (ADR 0058, decision 1): a chip's corner, the
 * raised fill, and the weight of the text it sits in. */
const CHIP =
  "mx-px inline-flex items-baseline gap-1 rounded-sm bg-raised px-1 align-baseline [&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-ring/50"

/** A chip's icon, drawn as the window's other icons are. */
function icon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg")
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "size-3.5 shrink-0 self-center text-muted-foreground",
  }))
    svg.setAttribute(name, value)
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path")
    path.setAttribute("d", d)
    svg.append(path)
  }
  return svg
}

const SVG = "http://www.w3.org/2000/svg"
