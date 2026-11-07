/**
 * No string of the window writes a key in its own words (ADR 0068,
 * decision 4): a tooltip, a menu's row, a setting's description or a
 * Problem names a key by its action's id, from the keys in force, so it
 * follows `keys.toml` and is written as it is pressed, ⌥ on a Mac. A
 * string that wrote `Alt+W` stayed so after the Person moved the key.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { sources } from "@banda/ui/testing/architecture"
import ts from "typescript"
import { expect, test } from "vitest"

const root = join(import.meta.dirname, "../../..")
const WRITES = /\bAlt\+/

/** The window's code: the page, its parts, and the modules' Panes. */
const folders = [
  join(root, "client/web/src"),
  join(root, "client/ui/src"),
  ...["apps", "platform"]
    .flatMap((bucket) =>
      readdirSync(join(root, bucket)).map((module) =>
        join(root, bucket, module, "pane/src")
      )
    )
    .filter((folder) => existsSync(folder)),
]

/** The words of each string and JSX text in a source file. */
function strings(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      found.push(node.text)
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

/** Every `description` in a settings file's schema, as Settings shows
 * it under its row. */
function descriptions(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "description" && typeof inner === "string"
      ? [inner]
      : descriptions(inner)
  )
}

test("no string writes one of Banda's keys in its own words", () => {
  const written = folders
    .flatMap((folder) => sources(folder, { tests: false }))
    .flatMap((file) => {
      const text = readFileSync(file, "utf8")
      if (!WRITES.test(text)) return []
      return strings(file, text)
        .filter((words) => WRITES.test(words))
        .map((words) => `${relative(root, file)}: ${words.trim()}`)
    })
  expect(written).toEqual([])
})

test("no setting's description writes one of Banda's keys", () => {
  const folder = join(root, "sdk/contract/src/generated/schema")
  const written = readdirSync(folder)
    // keys.toml's own says how a key is written there.
    .filter((file) => file !== "keys.schema.json")
    .flatMap((file) =>
      descriptions(JSON.parse(readFileSync(join(folder, file), "utf8")))
        .filter((words) => WRITES.test(words))
        .map((words) => `${basename(file)}: ${words}`)
    )
  expect(written).toEqual([])
})
