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
 *
 * And main runs an effect only at its edge (ADR 0020): `main.ts`, on its
 * runtime, and the places listed below. A service's layer that registers
 * a handler runs it on a runner of its own scope
 * (`FiberSet.makeRuntimePromise`), which is no run of this kind.
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
const MAIN_LINES = 1059
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

/**
 * The parts of the bridge's table `main.ts` still answers itself, written
 * out in its `serve(…)`: a part answered beside its code, as `acts.ts`
 * answers `act` and `device/files.ts` `files`, is named there by its
 * table alone. The list only falls: a part that leaves the root leaves
 * it, and a new one is answered beside its code from the start (ADR 0089,
 * decision 9). The `engine`, `sign` and `host*` parts wait for the hosts'
 * move to the core (track 1, SE4).
 */
const MAIN_ANSWERS = [
  "engine",
  "hosts",
  "hostEngine",
  "sign",
  "hostStart",
  "hostAdd",
  "hostSet",
  "hostRemove",
  "hostTest",
  "hostInstall",
  "hostInstallCancel",
  "hostTerminal",
  "hostInstalling",
  "hostStop",
  "sshSuggestions",
  "look",
  "frame",
  "menu",
  "quit",
  "update",
  "popped",
]

/** The parts `source` answers itself in its `serve(…)`: those written
 * there as a table or an answer, not named by one made elsewhere. */
function answeredInPlace(source: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    const answers = ts.isCallExpression(node) && node.arguments[3]
    if (
      answers &&
      node.expression.getText() === "serve" &&
      ts.isObjectLiteralExpression(answers)
    )
      for (const part of answers.properties)
        if (
          ts.isPropertyAssignment(part) &&
          (ts.isObjectLiteralExpression(part.initializer) ||
            ts.isArrayLiteralExpression(part.initializer))
        )
          found.push(part.name.getText())
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true))
  return found
}

test("main's root answers no more of the bridge itself than it did", () => {
  const text = readFileSync(join(root, "client/desktop/src/main.ts"), "utf8")
  expect(answeredInPlace(text)).toEqual(MAIN_ANSWERS)
})

test("the lint tells a part answered in place from one named by its table", () => {
  expect(
    answeredInPlace(
      `serve(runtime, fromPage, BRIDGE, {
        engine: [none, () => reached],
        popped: { current: [none, () => now] },
        act: actsAnswers,
        problems: problemsAnswers(state),
        ...modules.answers,
      })`
    )
  ).toEqual(["engine", "popped"])
})

test("main's code is found: the window's, the kit's and the Apps' parts in main", () => {
  const found = new Set(mains.map((file) => relative(root, file)))
  for (const file of [
    "client/desktop/src/main.ts",
    "client/desktop/src/os-window/system.ts",
    "client/desktop/src/os-window/page.ts",
    "client/desktop/src/device/files.ts",
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

/** The ways code runs an effect from outside one. */
const RUNS = new Set([
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "runFork",
  "runCallback",
])

/** How often `source` runs an effect: each `x.runPromise` and its like,
 * read as TypeScript reads it, so none in a comment or a string. */
function effectRuns(source: string, file: string): number {
  let found = 0
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && RUNS.has(node.name.text))
      found += 1
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
  return found
}

/** The edge itself, which registers Electron's callbacks on its runtime. */
const EDGE = "client/desktop/src/main.ts"

/** Where else main runs an effect, and how often. A list that only
 * falls: a place that runs one less lowers its count. */
const RUNS_BESIDE_THE_EDGE: Record<string, number> = {
  // The bridge's table: each of the page's calls runs on the runtime
  // main.ts hands it.
  "client/desktop-kit/src/ipc.ts": 2,
  // Main's one client asks where the engine is as it connects, outside
  // any effect.
  "client/desktop/src/engine.ts": 1,
}

test("main runs an effect only at its edge, and where the list holds", () => {
  const runs = Object.fromEntries(
    mains.flatMap((file) => {
      const name = relative(root, file)
      const count = effectRuns(readFileSync(file, "utf8"), file)
      return name !== EDGE && count > 0 ? [[name, count]] : []
    })
  )
  expect(runs).toEqual(RUNS_BESIDE_THE_EDGE)
})

test("the lint finds each way an effect is run, and none in a comment, nor a stream's run", () => {
  const count = (source: string) => effectRuns(source, "x.ts")
  expect(count("runtime.runPromise(a); Effect.runFork(b)")).toBe(2)
  expect(count("const run = Effect.runSync")).toBe(1)
  expect(count("// Effect.runPromise(a)\nStream.runHead(s)")).toBe(0)
  expect(count("const run = yield* FiberSet.makeRuntimePromise()")).toBe(0)
})
