/**
 * What the architecture tests read (docs/architecture.md, "Checks that
 * hold the shape"): the source files of a folder, the modules each one
 * names, the Apps each one names and what each one animates. For tests
 * alone: it reads the disk.
 */
/// <reference types="node" />
import { readdirSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

/** Every `.ts` and `.tsx` file under `folder`, and `.css` with `styles`;
 * without tests when `tests` is false. */
export function sources(
  folder: string,
  { tests = true, styles = false }: { tests?: boolean; styles?: boolean } = {}
): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path, { tests, styles })
    if (!(styles ? /\.(tsx?|css)$/ : /\.tsx?$/).test(entry.name)) return []
    return tests || !entry.name.includes(".test.") ? [path] : []
  })
}

/** Every module a file names: `from "…"`, `import "…"`, `import("…")`.
 * A name is on one line, so words in a string, such as `key="forked-from"`,
 * are not taken for one. */
export function imports(source: string): string[] {
  const found = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g
  )
  return [...found].map((match) => match[1])
}

/**
 * What `source`, the code of `file`, says of an App (ADR 0087, decision
 * 1), once for each place it does: a string that names an action or a
 * kind of the agents module's (`agents.…`) or a Thread's (`thread.…`), a
 * template that starts so, and that module's settings file
 * (`AGENTS_FILE`). Read as TypeScript reads it, by the file's kind, so
 * comments and imports are not taken for a place.
 */
export function appStrings(source: string, file: string): string[] {
  const named = /^(agents|thread)\./
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node) && node.text === "AGENTS_FILE")
      found.push(node.text)
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      named.test(node.text)
    )
      found.push(node.text)
    else if (ts.isTemplateExpression(node) && named.test(node.head.text))
      found.push(`${node.head.text}…`)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest))
  return found
}

/** What lays the page out when it changes; `all` takes it in. */
const LAYOUT =
  /^(?:all|width|height|(?:min|max)-(?:width|height)|inset(?:-[a-z-]+)?|top|right|bottom|left|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|grid-template(?:-[a-z]+)?|flex-basis)$/

/**
 * What `source`, a source file or a stylesheet, animates that lays the
 * page out again on every tick (ADR 0088, decision 2), once for each place
 * it does: Tailwind's `transition-all` and `transition-[…]`, a CSS
 * `transition`, and `@keyframes` by what their steps set.
 */
export function layoutMotion(source: string): string[] {
  const found: string[] = []
  for (const [match] of source.matchAll(/(?<![\w-])transition-all(?![\w-])/g))
    found.push(match)
  for (const [match, list] of source.matchAll(
    /(?<![\w-])transition-\[([^\]\s]+)\]/g
  ))
    if (list.split(",").some((property) => LAYOUT.test(property)))
      found.push(match)
  // A CSS transition's properties come first in each of its parts.
  for (const [match, value] of source.matchAll(
    /(?<![\w-])transition(?:-property)?\s*:\s*([^;{}]+)/g
  ))
    if (
      value
        .split(",")
        .some((part) => LAYOUT.test(part.trim().split(/\s+/)[0] ?? ""))
    )
      found.push(match.trim())
  for (const start of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1
    let end = start.index + start[0].length
    while (depth && end < source.length) {
      if (source[end] === "{") depth++
      else if (source[end] === "}") depth--
      end++
    }
    const steps = source.slice(start.index + start[0].length, end)
    if (
      [...steps.matchAll(/(?<![\w-])([a-z-]+)\s*:/g)].some(([, property]) =>
        LAYOUT.test(property)
      )
    )
      found.push(`@keyframes ${start[1]}`)
  }
  return found
}
