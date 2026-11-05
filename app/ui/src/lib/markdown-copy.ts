/**
 * Copying from a reply copies Markdown (ADR 0063, decision 4): what is
 * selected is read back from the page into Markdown, with its code
 * fences, links, lists, notes and math, and into clean HTML beside it,
 * as T3 Code does.
 */
import type { Element as HastElement, ElementContent, Nodes, Root } from "hast"
import { fromDom } from "hast-util-from-dom"
import { toHtml } from "hast-util-to-html"
import { defaultHandlers, type Handle, toMdast } from "hast-util-to-mdast"
import type { FootnoteDefinition } from "mdast"
import { gfmToMarkdown } from "mdast-util-gfm"
import { type InlineMath, type Math, mathToMarkdown } from "mdast-util-math"
import { toHast } from "mdast-util-to-hast"
import { type Options, toMarkdown } from "mdast-util-to-markdown"
import type { Copied } from "./clipboard"
import { FIELDS } from "./keys"

/** What a reply's Markdown is drawn in. */
const REPLY = "[data-slot=markdown]"

/** The elements whose parts need them around: an item its list, a cell
 * its table, a note its notes. */
const SHELLS = "ul, ol, table, thead, tbody, tfoot, tr, section[data-footnotes]"

const MARKDOWN: Options = {
  bullet: "-",
  rule: "-",
  extensions: [gfmToMarkdown(), mathToMarkdown()],
}

/**
 * A copy in what holds replies: what is selected there copies as Markdown
 * and HTML. A field keeps its own, and so does a selection {@link
 * rangeMarkdown} leaves to the page.
 */
export function copyAsMarkdown(event: {
  target: EventTarget
  currentTarget: Element
  clipboardData: DataTransfer | null
  preventDefault: () => void
}): void {
  if ((event.target as Element).closest?.(FIELDS)) return
  const selection = event.currentTarget.ownerDocument.getSelection()
  if (!selection?.rangeCount || !event.clipboardData) return
  const copied = rangeMarkdown(selection.getRangeAt(0), event.currentTarget)
  if (!copied) return
  event.preventDefault()
  event.clipboardData.setData("text/plain", copied.text)
  event.clipboardData.setData("text/html", copied.html)
}

/**
 * The Markdown `selected` in `within` holds, and its HTML. None where the
 * page's own copy is right: no reply's Markdown is selected, or the words
 * are of one text, of a code block, or of a diagram. A part of a formula
 * copies the formula.
 */
export function rangeMarkdown(
  selected: Range,
  within: Element
): Required<Copied> | null {
  if (selected.collapsed) return null
  const range = selected.cloneRange()
  const at = range.commonAncestorContainer
  const element =
    at.nodeType === Node.ELEMENT_NODE ? (at as Element) : at.parentElement
  if (!element || !within.contains(element)) return null
  const formula = element.closest(".katex-display") ?? element.closest(".katex")
  if (formula) range.selectNode(formula)
  else if (at !== element || element.closest("pre, [data-source]")) return null
  if (
    !element.closest(REPLY) &&
    ![...element.querySelectorAll(REPLY)].some((reply) =>
      range.intersectsNode(reply)
    )
  )
    return null

  let content: Node = range.cloneContents()
  for (
    let up: Element | null = formula ? null : element;
    up?.matches(SHELLS);
    up = up.parentElement
  ) {
    const shell = up.cloneNode(false)
    shell.appendChild(content)
    content = shell
  }
  const tree = fromDom(content)
  return copiedOf(
    tree.type === "root"
      ? tree
      : { type: "root", children: [tree as ElementContent] }
  )
}

/** A reply's page, or a part of it, as Markdown and as clean HTML; none
 * for no words. */
export function copiedOf(tree: Root): Required<Copied> | null {
  plain(tree)
  const mdast = toMdast(tree, { handlers })
  const text = toMarkdown(mdast, MARKDOWN).trim()
  if (!text) return null
  return { text, html: `<meta charset="utf-8">${toHtml(toHast(mdast))}` }
}

/**
 * Makes the page plain HTML, as the Agent wrote it, before it is read as
 * Markdown. What the Person neither sees nor selects goes: buttons, what
 * is hidden from them, hints that cannot be selected, hover titles, a
 * note's way back. What Streamdown and Banda draw their own way becomes
 * what it stands for: a code block or a diagram its code, a formula its
 * TeX, a path its words, a link or a picture what was written.
 */
function plain(parent: Root | HastElement): void {
  parent.children = parent.children.flatMap((child): ElementContent[] => {
    if (child.type !== "element") return [child as ElementContent]
    const { properties } = child
    const classes = classesOf(child)
    if (
      child.tagName === "button" ||
      properties.dataFootnoteBackref !== undefined ||
      String(properties.ariaHidden) === "true" ||
      classes.some((name) => name === "select-none" || name === "sr-only")
    )
      return []
    if (properties.dataMedia !== undefined)
      return [
        element("img", {
          src: String(properties.dataMedia),
          alt: String(properties.dataAlt ?? ""),
        }),
      ]
    if (properties.dataSource !== undefined)
      return [code("mermaid", String(properties.dataSource))]
    if (properties.dataStreamdown === "code-block") {
      const lines = find(child, (one) => one.tagName === "code")
      if (!lines) return []
      const each = lines.children.every(isLine) ? "\n" : ""
      return [
        code(
          String(properties.dataLanguage ?? ""),
          lines.children.map(textOf).join(each)
        ),
      ]
    }
    const display = classes.includes("katex-display")
    if (display || classes.includes("katex")) {
      const tex = find(
        child,
        (one) =>
          one.tagName === "annotation" &&
          one.properties.encoding === "application/x-tex"
      )
      return [
        element("span", { className: [display ? "katex-display" : "katex"] }, [
          { type: "text", value: textOf(tex ?? child).trim() },
        ]),
      ]
    }
    delete properties.title
    plain(child)
    if (properties.dataWritten !== undefined)
      return [
        element("a", { href: String(properties.dataWritten) }, child.children),
      ]
    if (properties.dataFile !== undefined) return child.children
    if (properties.dataStreamdown === "strong") child.tagName = "strong"
    return [child]
  })
}

/** What plain HTML cannot say: a formula, a note and its citation. */
const handlers: Record<string, Handle> = {
  span(state, node) {
    const classes = classesOf(node)
    if (classes.includes("katex-display")) return formula("math", textOf(node))
    if (classes.includes("katex")) return formula("inlineMath", textOf(node))
    return state.all(node)
  },

  a(state, node) {
    const label = noteLabel(node.properties.href)
    if (node.properties.dataFootnoteRef === undefined || !label)
      return defaultHandlers.a(state, node)
    return { type: "footnoteReference", identifier: label, label }
  },

  /** A reply's notes, each written as its definition. */
  section(state, node) {
    if (node.properties.dataFootnotes === undefined)
      return defaultHandlers.section(state, node)
    return node.children.flatMap((list) =>
      list.type !== "element" || list.tagName !== "ol"
        ? []
        : list.children.flatMap((item): FootnoteDefinition[] => {
            const label =
              item.type === "element" ? noteLabel(item.properties.id) : null
            return label
              ? [
                  {
                    type: "footnoteDefinition",
                    identifier: label,
                    label,
                    children: state.toFlow(
                      state.all(item as HastElement)
                    ) as FootnoteDefinition["children"],
                  },
                ]
              : []
          })
    )
  },
}

/** A formula by its TeX. Its HTML is its TeX as code, as remark-math
 * writes it. */
function formula(
  type: "math" | "inlineMath",
  value: string
): Math | InlineMath {
  const className = [
    "language-math",
    type === "math" ? "math-display" : "math-inline",
  ]
  const text = { type: "text" as const, value }
  return {
    type,
    value,
    data:
      type === "math"
        ? { hName: "pre", hChildren: [element("code", { className }, [text])] }
        : { hName: "code", hProperties: { className }, hChildren: [text] },
  } as Math | InlineMath
}

/** A note's label, from its id or a link to it: Markdown gives each
 * reply's ids its own prefix (`Markdown`). */
const noteLabel = (id: unknown) => /-fn-(.+)$/.exec(String(id ?? ""))?.[1]

/** A code block, as plain HTML writes one. */
function code(language: string, value: string): HastElement {
  const className = language ? [`language-${language}`] : []
  return element("pre", {}, [
    element("code", { className }, [{ type: "text", value }]),
  ])
}

function element(
  tagName: string,
  properties: HastElement["properties"],
  children: ElementContent[] = []
): HastElement {
  return { type: "element", tagName, properties, children }
}

/** Streamdown draws each line of code as an element of its own. */
const isLine = (node: ElementContent) =>
  node.type === "element" && node.tagName === "span"

function classesOf(node: HastElement): string[] {
  const names = node.properties.className
  return Array.isArray(names) ? names.map(String) : []
}

/** The first element under `node` that `is`, depth first. */
function find(
  node: HastElement,
  is: (one: HastElement) => boolean
): HastElement | null {
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (is(child)) return child
    const found = find(child, is)
    if (found) return found
  }
  return null
}

function textOf(node: Nodes): string {
  if ("value" in node) return String(node.value)
  return "children" in node
    ? (node.children as Nodes[]).map(textOf).join("")
    : ""
}
