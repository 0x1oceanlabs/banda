import { expect, test } from "vitest"
import { groupState, stillMark } from "./banda-mark"

const colors = { body: "#111", attention: "#f60", destructive: "#e00" }

test("a still mark is one SVG, in its state's colours and eyes", () => {
  const done = stillMark("done", colors)
  expect(done).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  expect(done).toContain('fill="#111"')
  // Happy eyes are strokes; no colour over the body.
  expect(done).toContain('stroke-linecap="round"')
  expect(done).not.toContain("#f60")

  const asking = stillMark("asking", colors)
  expect(asking).toContain('fill="#f60" fill-opacity="1.00"')
  expect(asking).toContain("<ellipse")

  const failed = stillMark("failed", colors)
  expect(failed).toContain('fill="#e00" fill-opacity="1.00"')

  // At rest it has no eyes at all.
  const rest = stillMark("rest", colors)
  expect(rest).not.toContain("<ellipse")
  expect(rest).not.toContain("stroke=")
})

test("a Group's colour, and a lent tab's, is its Agent's state", () => {
  expect(groupState("running")).toBe("working")
  expect(groupState("thinking")).toBe("working")
  expect(groupState("asking")).toBe("asking")
  expect(groupState("done")).toBe("done")
  expect(groupState("offline")).toBe("failed")
  expect(groupState("idle")).toBeUndefined()
  expect(groupState("rest")).toBeUndefined()
})
