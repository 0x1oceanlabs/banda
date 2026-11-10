import { readFileSync } from "node:fs"
import { TOKENS } from "@banda/contract/look"
import { expect, test } from "vitest"

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8")

/** The bodies of globals.css's rules for the root itself, in light and
 * dark: where a token's default would be written by hand. The glass's
 * rules (`html[data-glass]`) still say their own (ADR 0100, step 4). */
const defaults = [...css.matchAll(/^(?::root|\.dark) \{\n([^}]*)\}/gm)].map(
  ([, body]) => body
)

test("globals.css writes no token by hand: tokens.css has Banda's own (ADR 0080, decision 7)", () => {
  expect(defaults.length).toBeGreaterThan(0)
  const written = Object.entries(TOKENS)
    // The radii are the page's until the five levels (ADR 0100, step 3).
    .filter(([, { group }]) => group !== "radius")
    .map(([name]) => name)
    .filter((name) =>
      defaults.some((body) => new RegExp(`^\\s*--${name}:`, "m").test(body))
    )
  expect(written).toEqual([])
  expect(css).toContain('@import "@banda/contract/tokens.css";')
})
