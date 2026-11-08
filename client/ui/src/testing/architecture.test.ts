import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import {
  MANIFEST_NAMES,
  desktopReads,
  imports,
  layoutMotion,
  parts,
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
        `const b = window["banda"]`,
        `const { banda, location } = window`,
        `const { banda: bridge } = globalThis`,
        `const view = <Pane quit={() => window.banda?.quit()} />`,
        `const cast = (window as unknown as { banda?: Host }).banda`,
      ].join("\n"),
      "reads.tsx"
    )
  ).toBe(8)
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
