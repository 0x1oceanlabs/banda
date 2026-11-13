import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { LAYERS } from "./layers"

/** The layers' tokens, as Banda UI's theme names them. */
const theme = readFileSync(
  new URL("../../../../ui/src/styles/theme.css", import.meta.url),
  "utf8"
)
const valueOf = (layer: string) => {
  const found = new RegExp(`--z-index-${layer}: (\\d+);`).exec(theme)
  return found ? Number(found[1]) : undefined
}

test("each of the Window's layers is a token of Banda UI, and none lies under one before it (ADR 0110, step 3; ADR 0113, decision 5)", () => {
  const values = LAYERS.map(valueOf)
  expect(values).not.toContain(undefined)
  expect(values).toEqual([...values].sort((a, b) => a! - b!))
})

test("the layers keep the values they had as numbers", () => {
  expect(
    Object.fromEntries(LAYERS.map((layer) => [layer, valueOf(layer)]))
  ).toEqual({
    sidebar: 20,
    peek: 20,
    drawer: 30,
    sheet: 30,
    top: 50,
    carried: 50,
  })
})
