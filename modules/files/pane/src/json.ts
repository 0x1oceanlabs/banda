/**
 * A JSON as a tree that folds (ADR 0073, decision 6): its values as rows,
 * those of the folders open only, each with its path as `jq` writes it,
 * so it pastes into `jq`. JSONC loses its comments and trailing commas
 * first; JSON Lines is a row per line, each its own document. Pure, so
 * plain tests cover it.
 */
import { countWords } from "./words"

/** What a JSON value is, as its row colours it. */
export type Kind = "object" | "array" | "string" | "number" | "boolean" | "null"

/** One document: a JSON's whole, or one line of JSON Lines. */
export type Doc = {
  value: unknown
  /** Its line, in JSON Lines; none for a JSON's one document. */
  line?: number
  /** A line that does not parse: its text, and why. */
  broken?: { text: string; why: string }
}

/** One row of the tree. */
export type Row = {
  /** Unique among the rows: the document's line, then the path. */
  id: string
  /** As `jq` names it: `.`, `.users[0].name`, `.["a b"]`. */
  path: string
  depth: number
  /** Its key in an object, its index in an array; none for a document. */
  key?: string | number
  /** A document's line, in JSON Lines. */
  line?: number
  value: unknown
  kind: Kind
  /** How many it holds, for an object or an array. */
  size?: number
  /** Whether it is open, for an object or an array that holds any. */
  open?: boolean
  broken?: Doc["broken"]
}

export function kindOf(value: unknown): Kind {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  const type = typeof value
  return type === "object"
    ? "object"
    : type === "string" || type === "number" || type === "boolean"
      ? type
      : "null"
}

/** The path of `key` in what is at `parent`, as `jq` writes it. */
export function pathOf(parent: string, key: string | number): string {
  const base = parent === "." ? "" : parent
  if (typeof key === "number") return `${base || "."}[${key}]`
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${base}.${key}`
    : `${base || "."}[${JSON.stringify(key)}]`
}

/** A document's row's id, and its descendants'. */
export function idOf(path: string, line?: number): string {
  return line === undefined ? path : `${line}:${path}`
}

/** What `value` holds, each with its key. */
function children(value: unknown): [string | number, unknown][] {
  if (Array.isArray(value)) return value.map((one, index) => [index, one])
  if (value && typeof value === "object") return Object.entries(value)
  return []
}

/** The rows shown of `docs`: each value, and what an open one holds. */
export function rowsOf(docs: readonly Doc[], open: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const add = (
    value: unknown,
    path: string,
    depth: number,
    key: string | number | undefined,
    line: number | undefined
  ) => {
    const kind = kindOf(value)
    const id = idOf(path, line)
    const held = kind === "object" || kind === "array" ? children(value) : null
    const isOpen = held !== null && held.length > 0 && open.has(id)
    rows.push({
      id,
      path,
      depth,
      ...(key !== undefined && { key }),
      ...(line !== undefined && { line }),
      value,
      kind,
      ...(held && { size: held.length, open: isOpen }),
    })
    if (isOpen)
      for (const [childKey, child] of held)
        add(child, pathOf(path, childKey), depth + 1, childKey, line)
  }
  for (const doc of docs) {
    if (doc.broken) {
      rows.push({
        id: idOf(".", doc.line),
        path: ".",
        depth: 0,
        ...(doc.line !== undefined && { line: doc.line }),
        value: doc.broken.text,
        kind: "string",
        broken: doc.broken,
      })
      continue
    }
    add(doc.value, ".", 0, undefined, doc.line)
  }
  return rows
}

/** The ids of every object and array of `docs` above depth `depth`, so
 * opening them shows the tree to that depth; every one for none. */
export function openTo(docs: readonly Doc[], depth = Infinity): Set<string> {
  const open = new Set<string>()
  const walk = (value: unknown, path: string, at: number, line?: number) => {
    if (at >= depth) return
    const held = children(value)
    if (held.length === 0) return
    open.add(idOf(path, line))
    for (const [key, child] of held)
      walk(child, pathOf(path, key), at + 1, line)
  }
  for (const doc of docs) if (!doc.broken) walk(doc.value, ".", 0, doc.line)
  return open
}

/** Whether `docs` hold at most `most` values in all: the rows of their
 * tree opened whole. It stops counting past them. */
export function holdsAtMost(docs: readonly Doc[], most: number): boolean {
  let count = 0
  const walk = (value: unknown): boolean =>
    ++count <= most && children(value).every(([, child]) => walk(child))
  return docs.every((doc) => (doc.broken ? ++count <= most : walk(doc.value)))
}

/** A value as a row shows it, on one line: a string quoted, an object or
 * an array only by what it holds. */
export function valueText(row: Pick<Row, "kind" | "value" | "size">): string {
  switch (row.kind) {
    case "object":
      return row.size === 0 ? "{}" : `{…} ${countWords(row.size ?? 0, "key")}`
    case "array":
      return row.size === 0 ? "[]" : `[…] ${countWords(row.size ?? 0, "item")}`
    case "string":
      return JSON.stringify(row.value)
    default:
      return String(row.value)
  }
}

/** A value as Copy value puts it: a string as it is, the rest as JSON. */
export function copyValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

/** JSONC as JSON: its comments and its trailing commas gone, its strings
 * as they are. */
export function stripJsonc(text: string): string {
  let out = ""
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === '"') {
      // A string, to its closing quote; an escaped one does not close it.
      let end = at + 1
      while (end < text.length && text[end] !== '"')
        end += text[end] === "\\" ? 2 : 1
      out += text.slice(at, end + 1)
      at = end + 1
    } else if (char === "/" && text[at + 1] === "/") {
      while (at < text.length && text[at] !== "\n") at++
    } else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2)
      at = end < 0 ? text.length : end + 2
    } else {
      out += char
      at++
    }
  }
  // A comma before a closing bracket, outside a string.
  return out.replace(
    /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g,
    (_, string?: string, close?: string) => string ?? close ?? ""
  )
}

/** Whether a file of `extension` is JSON Lines. */
export const isLines = (extension: string) =>
  extension === "jsonl" || extension === "ndjson"

/** The documents of a JSON file's text: one for JSON and JSONC, one per
 * line that holds any for JSON Lines, a line that does not parse kept
 * as its text. A JSON with comments parses as JSONC, as a `tsconfig.json`
 * has them; one that does not parse throws its error. */
export function docsOf(text: string, extension: string): Doc[] {
  if (isLines(extension))
    return text.split("\n").flatMap((raw, index) => {
      const line = raw.trim()
      if (!line) return []
      try {
        return [{ value: JSON.parse(line) as unknown, line: index + 1 }]
      } catch (error) {
        const why = (error as Error).message
        return [{ value: null, line: index + 1, broken: { text: line, why } }]
      }
    })
  try {
    return [{ value: JSON.parse(text) as unknown }]
  } catch (error) {
    try {
      return [{ value: JSON.parse(stripJsonc(text)) as unknown }]
    } catch {
      throw error
    }
  }
}
