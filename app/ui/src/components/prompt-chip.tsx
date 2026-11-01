import { Node } from "@tiptap/core"
import { type ChipKind, KINDS } from "@banda/ui/lib/prompt"

/**
 * A chip in a prompt (ADR 0015, decision 2): one atom, which the caret
 * steps over and Backspace takes whole, showing what it points at with an
 * icon and a short name, the whole of it on hover, and writing it into
 * the text in its kind's way.
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
  renderHTML({ node, HTMLAttributes }) {
    return ["span", HTMLAttributes, String(node.attrs.value)]
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
      dom.append(fileIcon(), kind.label(value))
      return { dom }
    }
  },
})

const CHIP =
  "mx-px inline-flex items-baseline gap-1 rounded-md bg-muted px-1 align-baseline font-medium [&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-ring/50"

/** lucide's file icon, drawn as the window's other icons are. */
function fileIcon(): SVGSVGElement {
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
  for (const d of FILE_ICON) {
    const path = document.createElementNS(SVG, "path")
    path.setAttribute("d", d)
    svg.append(path)
  }
  return svg
}

const SVG = "http://www.w3.org/2000/svg"
const FILE_ICON = [
  "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
  "M14 2v5a1 1 0 0 0 1 1h5",
]
