/**
 * The window's main process reads no Project's path (ADR 0089, decision
 * 9; ADR 0106, decision 6): a Project's files are its machine's engine's
 * to read and serve, and main only relays their bytes by a token
 * (`@banda/desktop-kit`'s `relay`). So no code of main, `client/desktop`,
 * the kit or an App's or a platform part's `desktop`, asks the engine
 * where a Project is: it names no `projects.*` method, whose answers say
 * a Project's folder, and asks no `Engine.folderOf`.
 *
 * The check is a lint: it reads names as written, so a method named by a
 * computed string, or a folder handed in from outside, it does not see.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { parts, sources } from "@banda/ui/testing/architecture"
import ts from "typescript"
import { expect, test } from "vitest"

const root = resolve(import.meta.dirname, "../../..")

/** Main's code: the window's, the kit's, and each App's and platform
 * part's part in main, without tests, which fake the engine. */
const mains = [
  join(root, "client/desktop/src"),
  join(root, "client/desktop-kit/src"),
  ...[...parts(root).values()]
    .map((folder) => join(folder, "desktop/src"))
    .filter(existsSync),
].flatMap((folder) => sources(folder, { tests: false }))

/**
 * Where `source`, the code of `file`, asks where a Project is: each
 * string or template that names a `projects.*` method, and each
 * `folderOf` it takes of a value, as `Engine.folderOf`,
 * `Engine["folderOf"]` or `const { folderOf } = Engine`. Read as
 * TypeScript reads it, so comments and a function of its own by that
 * name, as the channel's `folderOf` of Banda's own folders, are not taken
 * for one.
 */
function projectReads(source: string, file: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /^projects\./.test(node.text))
      found.push(node.text)
    else if (
      ts.isTemplateExpression(node) &&
      /^projects\./.test(node.head.text)
    )
      found.push(`${node.head.text}…`)
    else if (
      (ts.isPropertyAccessExpression(node) && node.name.text === "folderOf") ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "folderOf")
    )
      found.push(`${node.expression.getText()}.folderOf`)
    else if (
      ts.isBindingElement(node) &&
      (node.propertyName ?? node.name).getText() === "folderOf"
    )
      found.push("{ folderOf }")
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  return found
}

/**
 * The ceiling on main's root, `main.ts`, in lines: Electron main becomes
 * the window's parts and the device's capabilities, each a file of its
 * own (`os-window/`, `device/`), and the root only builds the runtime
 * from them and hands Electron's events on (ADR 0089, decision 9; the
 * window's plan, WS10). The file stays under it, and a PR that cuts the
 * file more than `SLACK` lines below it lowers it; what main gains goes
 * into a part, not the root.
 */
const MAIN_LINES = 1289
const SLACK = 20

test("main's root keeps under its ceiling, and the ceiling follows it down", () => {
  const text = readFileSync(join(root, "client/desktop/src/main.ts"), "utf8")
  const lines = text.split("\n").length - 1
  expect(lines).toBeLessThanOrEqual(MAIN_LINES)
  expect(
    MAIN_LINES - lines,
    `main.ts has ${lines} lines: lower MAIN_LINES to it`
  ).toBeLessThanOrEqual(SLACK)
})

test("main's code is found: the window's, the kit's and the Apps' parts in main", () => {
  const found = new Set(mains.map((file) => relative(root, file)))
  for (const file of [
    "client/desktop/src/main.ts",
    "client/desktop/src/os-window/system.ts",
    "client/desktop-kit/src/files.ts",
    "apps/agents/desktop/src/index.ts",
    "apps/browser/desktop/src/index.ts",
  ])
    expect(found, file).toContain(file)
})

test("client/desktop reads no Project path: no code of main asks where a Project is", () => {
  const reads = Object.fromEntries(
    mains.flatMap((file) => {
      const places = projectReads(readFileSync(file, "utf8"), file)
      return places.length > 0 ? [[relative(root, file), places]] : []
    })
  )
  expect(reads).toEqual({})
})

test("the lint finds a projects method and a folderOf asked of a value, and nothing in a comment or of a function of its own", () => {
  const read = (source: string) => projectReads(source, "x.ts")
  expect(read(`client.call("projects.list", {})`)).toEqual(["projects.list"])
  expect(read("const folder = yield* Engine.folderOf(project)")).toEqual([
    "Engine.folderOf",
  ])
  expect(read('Engine["folderOf"](project)')).toEqual(["Engine.folderOf"])
  expect(read("const { folderOf: where } = Engine")).toEqual(["{ folderOf }"])
  expect(read("client.call(`projects.${which}`, {})")).toEqual(["projects.…"])
  expect(
    read(
      `// Engine.folderOf("p") and "projects.list"\nfolderOf("state", system)`
    )
  ).toEqual([])
})
