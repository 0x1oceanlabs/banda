/**
 * The Markdown steps for paths in a reply (ADR 0063, decision 2): a
 * `file://` link becomes its path, and a path in plain text is marked for
 * the window to look at. What they mark is drawn by `markdown-file.tsx`.
 */
import { filePath, textPaths } from "./file-links"

type Mdast = { type: string; url?: string; children?: Mdast[] }
type Hast = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Hast[]
}

/** The tag a path in plain text is marked with. */
export const TEXT_PATH = "banda-path"

/** A remark step: a link to a `file://` URL links to its path instead, as
 * one to a path does; the window shows no `file:` link otherwise. */
export function fileUrls() {
  return (tree: Mdast) => {
    const visit = (node: Mdast) => {
      if ((node.type === "link" || node.type === "definition") && node.url)
        node.url = filePath(node.url) ?? node.url
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/** Where a path in text is no path: in code, or a link. */
const APART = new Set(["a", "code", "pre"])

/** A rehype step, after the sanitizer: each path in plain text is marked
 * as a {@link TEXT_PATH} element of its words. */
export function proseFiles() {
  return (tree: Hast) => {
    const visit = (node: Hast) => {
      if (!node.children || (node.tagName && APART.has(node.tagName))) return
      let marks = false
      const children = node.children.flatMap((child) => {
        if (child.type !== "text") {
          visit(child)
          return [child]
        }
        const found = marked(child.value ?? "")
        marks ||= found !== null
        return found ?? [child]
      })
      if (marks) node.children = children
    }
    visit(tree)
  }
}

/** `text` as text and the paths in it, each marked; none when it has
 * none. */
function marked(text: string): Hast[] | null {
  const paths = text.includes("/") ? textPaths(text) : []
  if (paths.length === 0) return null
  const nodes: Hast[] = []
  let at = 0
  for (const { start, text: path } of paths) {
    if (start > at) nodes.push({ type: "text", value: text.slice(at, start) })
    nodes.push({
      type: "element",
      tagName: TEXT_PATH,
      properties: {},
      children: [{ type: "text", value: path }],
    })
    at = start + path.length
  }
  if (at < text.length) nodes.push({ type: "text", value: text.slice(at) })
  return nodes
}
