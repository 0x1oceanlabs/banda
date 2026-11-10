import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Status } from "./CardStatus"

const MINUTE = 60_000

/** A quiet row's markup, last changed `at`, its machine heard last at
 * `stillAt`, if given. */
const said = (at: number, stillAt?: number) =>
  renderToStaticMarkup(<Status said={{ kind: "ago", at }} stillAt={stillAt} />)

test("a quiet row of a machine the window does not reach says how long ago as of when it was last heard, not as of now", () => {
  const changed = Date.now() - 15 * MINUTE
  // Heard 30 s after it changed: "now", however long ago that was.
  expect(said(changed, changed + 30_000)).toContain(">now<")
  expect(said(changed, changed + 4 * MINUTE)).toContain(">4m<")
  // Reached, it counts on to now.
  expect(said(changed)).toContain(">15m<")
})
