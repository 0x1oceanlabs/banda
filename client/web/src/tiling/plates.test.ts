import { describe, expect, test } from "vitest"
import { arrivals, LONG_AGO, spans } from "./plates"

describe("arrivals", () => {
  test("a state the Strip first sees came long ago: no swell", () => {
    const seen = arrivals(new Map(), new Map([["g", "done"]]), 500)
    expect(seen.get("g")).toEqual({ state: "done", at: LONG_AGO })
  })

  test("a state that changes came now, and keeps its time after", () => {
    const first = arrivals(new Map(), new Map([["g", "working"]]), 100)
    const asked = arrivals(first, new Map([["g", "asking"]]), 900)
    expect(asked.get("g")).toEqual({ state: "asking", at: 900 })
    const later = arrivals(asked, new Map([["g", "asking"]]), 4000)
    expect(later.get("g")).toEqual({ state: "asking", at: 900 })
  })

  test("a Group gone is forgotten, and comes back as new", () => {
    const first = arrivals(new Map(), new Map([["g", "working"]]), 100)
    const gone = arrivals(first, new Map(), 200)
    expect(gone.has("g")).toBe(false)
    const back = arrivals(gone, new Map([["g", "done"]]), 300)
    expect(back.get("g")?.at).toBe(LONG_AGO)
  })
})

describe("spans", () => {
  test("each piece stands at its place in its Group, the Group's width", () => {
    const pieces = [
      { first: true, width: 100 },
      { first: false, width: 50 },
      { first: false, width: 30 },
      { first: true, width: 40 },
    ]
    expect(spans(pieces)).toEqual([
      { x: 0, span: 180 },
      { x: 100, span: 180 },
      { x: 150, span: 180 },
      { x: 0, span: 40 },
    ])
  })
})
