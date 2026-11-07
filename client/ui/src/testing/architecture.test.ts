import { expect, test } from "vitest"
import { imports, layoutMotion } from "./architecture"

test("the check sees every kind of import", () => {
  expect(
    imports(
      `import a from "x"\nimport "y"\nconst z = import("z")\nexport { b } from 'w'`
    )
  ).toEqual(["x", "y", "z", "w"])
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
