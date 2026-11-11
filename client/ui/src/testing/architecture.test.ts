import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"
import { expect, test } from "vitest"
import {
  MANIFEST_NAMES,
  componentProps,
  desktopReads,
  drawingFiles,
  hostReads,
  imports,
  kindReaches,
  kindsIn,
  layoutMotion,
  parts,
  pastHandles,
  programOver,
  valuesTaken,
  workspaceResolver,
} from "./architecture"

test("the check sees every kind of import", () => {
  expect(
    imports(
      `import a from "x"\nimport "y"\nconst z = import("z")\nexport { b } from 'w'`
    )
  ).toEqual(["x", "y", "z", "w"])
})

test("the check sees each way code reads the desktop's bridge, and not what only names it", () => {
  expect(
    desktopReads(
      [
        `const host = window.banda`,
        `window.banda?.quit()`,
        `globalThis.banda?.popped.close(id)`,
        `self.banda?.update.check()`,
        `const b = window["banda"]`,
        `const { banda, location } = window`,
        `const { banda: bridge } = globalThis`,
        `const view = <Pane quit={() => window.banda?.quit()} />`,
        `const cast = (window as unknown as { banda?: Host }).banda`,
      ].join("\n"),
      "reads.tsx"
    )
  ).toBe(9)
  expect(
    desktopReads(
      [
        `// window.banda is the desktop's`,
        `declare global { interface Window { banda?: Host } }`,
        `const banda = "window.banda"`,
        `host.banda.quit()`,
      ].join("\n"),
      "names.ts"
    )
  ).toBe(0)
})

/** A strict TypeScript that finds no package: `lib` alone has types. */
const STRICT = JSON.stringify({
  compilerOptions: {
    strict: true,
    lib: ["ES2023", "DOM"],
    types: [],
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "preserve",
    noEmit: true,
  },
})

/**
 * What `read` makes of a program over `file`, of `files` written by
 * their names into a folder of their own beside that tsconfig.
 */
function readFrom<T>(
  files: Record<string, string>,
  file: string,
  read: (program: ts.Program, path: string) => T
): T {
  const folder = mkdtempSync(join(tmpdir(), "banda-props-"))
  try {
    writeFileSync(join(folder, "tsconfig.json"), STRICT)
    for (const [name, source] of Object.entries(files))
      writeFileSync(join(folder, name), source)
    const path = join(folder, file)
    return read(programOver([path], join(folder, "tsconfig.json")), path)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

const propsOf = (files: Record<string, string>, file: string) =>
  readFrom(files, file, componentProps)

test("the check sees a component's props that are code, by whatever name they are typed, and not its data", () => {
  const source = [
    `import type { Dispatch } from "./dispatch"`,
    `type Pick = (id: string) => void`,
    `type Shown = { label: string }`,
    `interface Folding { onFold(): void; folded: boolean }`,
    `interface Pinning extends Folding { onPin?: VoidFunction }`,
    `declare function wake(): void`,
    `declare function memo<C>(component: C): C`,
    `export function List({ onPick, label }: { onPick: Pick; label: string; done?: (() => void) | undefined }) { return null }`,
    `function Header(props: Shown & Pinning & { onMore: () => void }) { return null }`,
    `const Item = ({ row }: { row: Shown; mark: Pick | boolean | undefined }) => null`,
    `export function Menu({ project }: { project: string; onPin?: VoidFunction; onRename: Dispatch<string>; "onWake": typeof wake }) { return null }`,
    `const Kept = memo(function Kept({ onArchive: archive }: { onArchive: Dispatch<number> }) { return null })`,
    // An index signature names no prop: what is taken apart is read.
    `function Bag({ onGo, ...rest }: Record<string, VoidFunction>) { return null }`,
    `function lower({ onOpen }: { onOpen: () => void }) { return null }`,
    `function Empty() { return null }`,
  ].join("\n")
  expect(
    propsOf(
      {
        "dispatch.ts": `export type Dispatch<A> = (value: A) => void`,
        "list.tsx": source,
      },
      "list.tsx"
    )
  ).toEqual({
    List: { props: ["done", "label", "onPick"], code: ["done", "onPick"] },
    Header: {
      props: ["folded", "label", "onFold", "onMore", "onPin"],
      code: ["onFold", "onMore", "onPin"],
    },
    Item: { props: ["mark", "row"], code: ["mark"] },
    Menu: {
      props: ["onPin", "onRename", "onWake", "project"],
      code: ["onPin", "onRename", "onWake"],
    },
    Kept: { props: ["onArchive"], code: ["onArchive"] },
    Bag: { props: ["onGo"], code: ["onGo"] },
    Empty: { props: [], code: [] },
  })
})

test("the check reads a component's props whose type is declared in another file", () => {
  const files = {
    "types.ts": [
      `export type Dispatch<A> = (value: A) => void`,
      `export type ComponentProps<C> = C extends (props: infer P) => unknown ? P : never`,
      `export interface MenuProps { project: string; onPin(): void; onGo: Dispatch<string> }`,
    ].join("\n"),
    "row.tsx": `export function Row(props: { row: string; x: number; onOpen: () => void }) { return null }`,
    "menu.tsx": [
      `import type { ComponentProps, MenuProps } from "./types"`,
      `import type { Row } from "./row"`,
      `function ProjectMenu(props: MenuProps) { return null }`,
      `const Line = ({ row, ...rest }: Omit<ComponentProps<typeof Row>, "x">) => null`,
    ].join("\n"),
  }
  expect(propsOf(files, "menu.tsx")).toEqual({
    ProjectMenu: {
      props: ["onGo", "onPin", "project"],
      code: ["onGo", "onPin"],
    },
    Line: { props: ["onOpen", "row"], code: ["onOpen"] },
  })
})

test("the check ends on an interface that extends itself", () => {
  // Not TypeScript, as each extends the other, yet the check ends.
  const source = [
    `interface Looping extends Looped { onLoop: VoidFunction }`,
    `interface Looped extends Looping { looped: boolean }`,
    `function Loop(props: Looping) { return null }`,
  ].join("\n")
  expect(propsOf({ "loop.tsx": source }, "loop.tsx")).toEqual({
    Loop: { props: ["onLoop"], code: ["onLoop"] },
  })
})

test("the check refuses a module that is not there, and props typed any", () => {
  expect(() =>
    propsOf(
      {
        "stale.tsx": [
          `import type { Gone } from "gone"`,
          `import "./look.css"`,
          `export function Stale(props: { gone: Gone }) { return null }`,
        ].join("\n"),
      },
      "stale.tsx"
    )
  ).toThrow(/stale\.tsx: gone$/)
  // A module named inside a type is as missing as one at the top.
  expect(() =>
    propsOf(
      {
        "late.tsx": `export function Late(props: { onGo: typeof import("gone").go }) { return null }`,
      },
      "late.tsx"
    )
  ).toThrow(/late\.tsx: gone$/)
  expect(() =>
    propsOf(
      { "loose.tsx": `export function Loose(props: any) { return null }` },
      "loose.tsx"
    )
  ).toThrow(/Loose's props are any/)
  expect(() =>
    propsOf(
      {
        "loose.tsx": `export function Loose(props: { label: string; onPin: any }) { return null }`,
      },
      "loose.tsx"
    )
  ).toThrow(/Loose takes onPin as any/)
})

test("the check sees what a file takes of a module in each form, and no type", () => {
  const folder = join("/web", "sidebar")
  const source = [
    `import { arrange as sorted, type Row } from "./arrange"`,
    `import type { Arranged } from "./arrange"`,
    `import order, { keysOf } from "../sidebar/order.ts"`,
    `import * as whole from "./tally"`,
    `export { placeIn as at, type View } from "./order"`,
    `export * from "./width"`,
    `export type { Line } from "./line"`,
    `import "./look.css"`,
    `const later = () => import("./later")`,
    `import { useState } from "react"`,
    `// import { hidden } from "./hidden"`,
    `const words = 'import { said } from "./said"'`,
  ].join("\n")
  expect(valuesTaken(source, join(folder, "Counts.tsx"))).toEqual({
    [join(folder, "arrange")]: ["arrange"],
    [join(folder, "order")]: ["default", "keysOf", "placeIn"],
    [join(folder, "tally")]: ["*"],
    [join(folder, "width")]: ["*"],
    [join(folder, "look.css")]: [],
    [join(folder, "later")]: ["*"],
    react: ["useState"],
  })
})

test("the check sees a Tailwind class that animates layout, each time", () => {
  expect(
    layoutMotion(
      `<a className="transition-all" /><b className="transition-[width,opacity]" />` +
        `<c className="transition-all duration-200" />` +
        `<d className="transition-[opacity,translate] transition-colors" />`
    )
  ).toEqual(["transition-all", "transition-all", "transition-[width,opacity]"])
})

test("the check sees a CSS transition of layout, and not one of the compositor's", () => {
  expect(
    layoutMotion(
      `.a { transition: height 0.2s ease, opacity 0.2s }\n` +
        `.b { transition: transform 0.2s, opacity 0.2s }\n` +
        `.c { transition-property: margin-left }`
    )
  ).toEqual([
    "transition: height 0.2s ease, opacity 0.2s",
    "transition-property: margin-left",
  ])
})

test("the check sees keyframes by what their steps set", () => {
  expect(
    layoutMotion(
      `@keyframes grow { from { width: 0 } to { width: 10px } }\n` +
        `@keyframes fade { from { opacity: 0; translate: 0 4px } to { opacity: 1 } }`
    )
  ).toEqual(["@keyframes grow"])
})

test("the files that draw are the Window's and the Panes', stylesheets too, and no test", () => {
  const root = join(import.meta.dirname, "../../../..")
  const drawing = drawingFiles(root)
  expect(drawing).toContain(join(root, "client/ui/src/styles/globals.css"))
  expect(drawing).toContain(join(root, "apps/agents/pane/src/thread/Find.tsx"))
  expect(drawing.filter((file) => /\.test\.|\/testing\//.test(file))).toEqual(
    []
  )
})

test("a part is found by each name of its manifest, not by the old module.toml, finding none throws, and so does one id twice", () => {
  const root = mkdtempSync(join(tmpdir(), "banda-parts-"))
  const folder = (path: string, manifest?: string) => {
    mkdirSync(join(root, path), { recursive: true })
    if (manifest) writeFileSync(join(root, path, manifest), "")
    return join(root, path)
  }
  try {
    expect(MANIFEST_NAMES).toContain("app.toml")
    folder("apps")
    folder("platform/look")
    folder("apps/old", "module.toml")
    expect(() => parts(root)).toThrow(/no folder of apps\/ or platform\//)
    const named = MANIFEST_NAMES.map(
      (name, at) => [`p${at}`, folder(`apps/p${at}`, name)] as const
    )
    expect([...parts(root)]).toEqual(named)
    folder("platform/p0", MANIFEST_NAMES[0])
    expect(() => parts(root)).toThrow(/two folders are the part p0/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the kind checker sees each way code reaches past a Pane's handles, and not a parameter named window", () => {
  const places = (source: string) =>
    pastHandles(source, "pane.tsx").map(({ what, line }) => `${line} ${what}`)
  expect(
    places(
      [
        `const host = window.banda`,
        `navigator.clipboard.writeText("a")`,
        `window.navigator.clipboard.readText()`,
        `const { clipboard } = navigator`,
        `window.open("https://a", "_blank")`,
        `globalThis.open?.("https://b")`,
        `open("https://c")`,
        `const engine = new Engine(address)`,
        `const other = new contract.Engine(address)`,
        `const view = <a onClick={() => window.open(url)} />`,
        `import { Engine as Session } from "@banda/contract"`,
        `const renamed = new Session(address)`,
        `class Mine extends Session {}`,
      ].join("\n")
    )
  ).toEqual([
    "1 window.banda",
    "2 navigator.clipboard",
    "3 navigator.clipboard",
    "4 navigator.clipboard",
    "5 window.open",
    "6 window.open",
    "7 window.open",
    "8 new Engine",
    "9 new Engine",
    "10 window.open",
    "12 new Engine",
    "13 new Engine",
  ])
  expect(
    places(
      [
        `// window.open(url) in a comment`,
        `const words = "window.open(url)"`,
        `type Opens = typeof window.open`,
        `function act(window: WindowApi) { window.open(pane) }`,
        `const run = (window: WindowApi) => window.open(pane, project)`,
        `import { open } from "./open"`,
        `open(pane)`,
        `function own({ open }: Props) { open(pane) }`,
        `function inner() { const window = api(); window.open(pane) }`,
        `tab.open(url)`,
        `const navigator = keys(); navigator.clipboard`,
      ].join("\n")
    )
  ).toEqual([])
})

/**
 * What `kindReaches` finds from `start` in `files`, written as code by
 * their paths: each place as `what at file:line, by a → b`. `@banda/ui/
 * desktop` is `desktop.ts`, the core is under `core/`, the contract under
 * `contract/`, and a module named bare is a package from outside.
 */
function reachedIn(
  files: Record<string, string>,
  start: string,
  name?: string
): string[] {
  const resolve = (module: string, from: string) => {
    if (module === "@banda/ui/desktop") return "/desktop.ts"
    if (module === "@banda/core") return "/core/index.ts"
    if (module === "@banda/contract") return "/contract/index.ts"
    if (!module.startsWith(".")) return undefined
    const path = join(from, "..", module)
    return [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(
      (file) => file in files
    )
  }
  return kindReaches(start, resolve, {
    name,
    read: (file) => files[file],
  }).map(
    ({ what, file, line, chain }) =>
      `${what} at ${file}:${line}, by ${chain.join(" → ")}`
  )
}

test("the kind checker follows a kind's code through what it takes, and only that", () => {
  const files = {
    "/kind.tsx": [
      `import { quiet, loud } from "./helpers"`,
      `import { Pick } from "./index"`,
      `import type { Bridge } from "./bridge"`,
      `import { useState } from "react"`,
      `import { twice } from "./named"`,
      `export const kind = definePane({ kind: "a.kind", Pane })`,
      `function Pane() { quiet(); loud(); twice(); return <Pick /> }`,
    ].join("\n"),
    // A default function is said by its own name in its file too.
    "/named.ts": [
      `export const twice = () => opens() + opens()`,
      `export default function opens() { return window.banda?.files }`,
    ].join("\n"),
    // Of a file, the kind's code is what it names, and what that names.
    "/helpers.ts": [
      `import { filesHost } from "@banda/ui/desktop"`,
      `export function quiet() { return 1 }`,
      `export function loud() { return opens() }`,
      `function opens() { window.open("https://a") }`,
      `export function unused() { filesHost()?.outside("/a") }`,
    ].join("\n"),
    // An index gives again only what is taken of it.
    "/index.ts": [
      `export { Pick } from "./pick"`,
      `export * from "./more"`,
    ].join("\n"),
    "/pick.tsx": [
      `import { copy } from "./copy"`,
      `export function Pick() { return <b onClick={copy} /> }`,
    ].join("\n"),
    "/more.ts": `export function more() { navigator.clipboard.readText() }`,
    "/copy.ts": `export const copy = () => navigator.clipboard.writeText("a")`,
    "/bridge.ts": `export type Bridge = typeof window.banda`,
  }
  expect(reachedIn(files, "/kind.tsx", "kind")).toEqual([
    "window.open at /helpers.ts:4, by /kind.tsx → /helpers.ts",
    "window.banda at /named.ts:2, by /kind.tsx → /named.ts",
    "navigator.clipboard at /copy.ts:1, by /kind.tsx → /index.ts → /pick.tsx → /copy.ts",
  ])
  // The function that reaches the bridge is the kind's once it calls it.
  files["/kind.tsx"] = files["/kind.tsx"]
    .replace("quiet, loud", "quiet, loud, unused")
    .replace("loud();", "loud(); unused();")
  expect(reachedIn(files, "/kind.tsx", "kind")).toContain(
    "@banda/ui/desktop at /helpers.ts:1, by /kind.tsx → /helpers.ts"
  )
})

test("the kind checker takes what runs as a file loads, what a call is handed then, a dynamic import, and stops at the core and the contract", () => {
  const files = {
    "/kind.tsx": [
      `import { store } from "./store"`,
      `import { paneHost } from "@banda/core"`,
      `import { bridge } from "@banda/contract"`,
      `export const kind = definePane({ Pane: () => store.get() + paneHost(pane) + bridge() })`,
      `export const other = definePane({ Pane: () => import("./later") })`,
    ].join("\n"),
    // Made as it loads: what the call names runs then, and what it is
    // handed may; a function it only holds does not.
    "/store.ts": [
      `import { made } from "./made"`,
      `export const store = made()`,
      `export function idle() { window.open("https://idle") }`,
      `export const watched = made().watch(() => window.banda?.files)`,
      `export const held = made({ open: () => window.open("https://held") })`,
      `void import("./side")`,
      // Taken only to run, it runs all the same.
      `import "./setup"`,
    ].join("\n"),
    "/side.ts": `export const side = () => navigator.clipboard.readText()`,
    "/setup.ts": `globalThis.open?.("https://setup")`,
    "/made.ts": `export function made() { return { get: () => new Engine(at) } }`,
    "/later.ts": `export default function later() { window.open("https://b") }`,
    "/core/index.ts": `export { paneHost } from "./hosts"`,
    "/core/hosts.ts": `export const paneHost = () => new Engine(at)`,
    "/contract/index.ts": `export const bridge = () => window.banda`,
  }
  expect(reachedIn(files, "/kind.tsx", "kind")).toEqual([
    "window.banda at /store.ts:4, by /kind.tsx → /store.ts",
    "new Engine at /made.ts:1, by /kind.tsx → /store.ts → /made.ts",
    "navigator.clipboard at /side.ts:1, by /kind.tsx → /store.ts → /side.ts",
    "window.open at /setup.ts:1, by /kind.tsx → /store.ts → /setup.ts",
  ])
  // All of the file: the other kind's Pane loads its page when it shows.
  expect(reachedIn(files, "/kind.tsx")).toEqual([
    "window.banda at /store.ts:4, by /kind.tsx → /store.ts",
    "window.open at /later.ts:1, by /kind.tsx → /later.ts",
    "new Engine at /made.ts:1, by /kind.tsx → /store.ts → /made.ts",
    "navigator.clipboard at /side.ts:1, by /kind.tsx → /store.ts → /side.ts",
    "window.open at /setup.ts:1, by /kind.tsx → /store.ts → /setup.ts",
  ])
})

test("the kind checker finds each kind a file declares, by the name it exports it as", () => {
  expect(
    kindsIn(
      [
        `export const threadPane = definePane<ThreadArgs>({ kind: "agents.thread", title })`,
        `export const launcher: AnyPaneKind = definePane({ kind: "window.launcher" })`,
        `const made = definePane({ kind: prefix + ".made" })`,
        `const other = makePane({ kind: "not.a.kind" })`,
      ].join("\n"),
      "kinds.tsx"
    )
  ).toEqual([
    { kind: "agents.thread", name: "threadPane" },
    { kind: "window.launcher", name: "launcher" },
  ])
})

test("the resolver finds a workspace package by its exports, and a folder by its index", () => {
  const root = join(import.meta.dirname, "../../../..")
  const resolve = workspaceResolver(root)
  const from = join(root, "apps/agents/pane/src/ThreadPane.tsx")
  expect(resolve("@banda/ui/lib/look", from)).toBe(
    join(root, "client/ui/src/lib/look.ts")
  )
  expect(resolve("@banda/ui/desktop", from)).toBe(
    join(root, "client/ui/src/desktop.ts")
  )
  expect(resolve("@banda/core", from)).toBe(
    join(root, "client/core/src/index.ts")
  )
  expect(resolve("./thread/Thread", from)).toBe(
    join(root, "apps/agents/pane/src/thread/Thread.tsx")
  )
  expect(
    resolve("../entries", join(root, "apps/agents/pane/src/lines/entry.tsx"))
  ).toBe(join(root, "apps/agents/pane/src/entries/index.tsx"))
  expect(resolve("react", from)).toBeUndefined()
  expect(resolve("@banda/ui/globals.css", from)).toBeUndefined()
})

test("the check sees where a Pane asks where it is, and each check of what it read", () => {
  const asks = (source: string) => hostReads(source, "pane.tsx")
  expect(
    asks(
      [
        `function Pane(props: PaneProps<Args>) {`,
        `  const here = props.args.host === undefined`,
        `  return here ? <A /> : here && <B />`,
        `}`,
        `function Thread({ args }: PaneProps<Args>) {`,
        `  const { thread, host } = args`,
        `  const shown = useShownOf(host)`,
        `  const away = host !== undefined && shown`,
        `  return away ? null : thread`,
        `}`,
        `const said = (call: Call) => paneHost(call.pane)`,
        `const picked = (window: WindowApi) => window.here.get().pane?.host`,
        `function Moved({ args: { host } }: Props) { return host }`,
        `const keyed = props.args["host"]`,
      ].join("\n")
    )
  ).toEqual([
    "args.host",
    "args.host",
    "paneHost",
    "pane.host",
    "args.host",
    "args.host",
    "here",
    "here",
    "host",
    "host",
    "away",
    "host",
  ])
  expect(
    asks(
      [
        `const mine = groups.find((group) => group.host === host)`,
        `const url = new URL(page).host`,
        `function Picker({ host }: { host: string }) { return host }`,
        `// args.host in a comment`,
        `function Other() { const host = "arc"; return host }`,
      ].join("\n")
    )
  ).toEqual([])
})
