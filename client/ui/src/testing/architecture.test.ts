import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import {
  MANIFEST_NAMES,
  desktopReads,
  functionProps,
  imports,
  layoutMotion,
  parts,
  propNames,
  valuesTaken,
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

test("the check sees a component's props that are code, through the file's aliases, and not its data", () => {
  const source = [
    `type Pick = (id: string) => void`,
    `type Shown = { label: string }`,
    `interface Folding { onFold(): void; folded: boolean }`,
    `export function List({ onPick, label }: { onPick: Pick; label: string; done?: (() => void) | undefined }) {}`,
    `function Header(props: Shown & Folding & { onMore: () => void }) {}`,
    `const Item = ({ row }: { row: Shown; mark: Pick | undefined }) => null`,
    `const Row = (props: Omit<ComponentProps<typeof Other>, "x">) => null`,
    `function lower({ onOpen }: { onOpen: () => void }) {}`,
    `function Empty() {}`,
  ].join("\n")
  expect(functionProps(source, "list.tsx")).toEqual({
    List: ["onPick", "done"],
    Header: ["onFold", "onMore"],
    Item: ["mark"],
    Row: [],
    Empty: [],
  })
})

test("the check sees every prop of a component, whatever its type, and each it takes apart", () => {
  const source = [
    `import type { Dispatch } from "react"`,
    `type Shown = { label: string }`,
    `interface Folding { onFold(): void; folded: boolean }`,
    `interface Pinning extends Folding { onPin?: VoidFunction }`,
    `export function Menu({ project }: { project: string; onPin?: VoidFunction; onRename: Dispatch<string>; "onWake": typeof wake }) {}`,
    `function Header(props: Shown & Pinning) {}`,
    `const Row = ({ row, onOpen: open, ...rest }: Omit<ComponentProps<typeof Other>, "x">) => null`,
    `const Item = memo(function Item({ onArchive }: { onArchive: Archive }) { return null })`,
    `function lower({ onOpen }: { onOpen: VoidFunction }) {}`,
    // Not TypeScript, as each extends the other, yet the check ends.
    `interface Looping extends Looped { onLoop: VoidFunction }`,
    `interface Looped extends Looping { looped: boolean }`,
    `function Loop(props: Looping) {}`,
  ].join("\n")
  expect(propNames(source, "menu.tsx")).toEqual({
    Menu: ["project", "onPin", "onRename", "onWake"],
    Header: ["label", "onFold", "folded", "onPin"],
    Row: ["row", "onOpen"],
    Item: ["onArchive"],
    Loop: ["looped", "onLoop"],
  })
  // Of these, only a method is surely code, read in the file alone.
  expect(functionProps(source, "menu.tsx")).toEqual({
    Menu: [],
    Header: ["onFold"],
    Row: [],
    Item: [],
    Loop: [],
  })
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
