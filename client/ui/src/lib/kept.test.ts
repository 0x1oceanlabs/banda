import { afterEach, expect, test, vi } from "vitest"
import { kept } from "./kept"

afterEach(() => vi.unstubAllGlobals())

const isText = (value: unknown): value is string => typeof value === "string"

/** The window's storage, which another window changes too, and which
 * refuses what it is given while `full` is set. */
function storage() {
  const stored = new Map<string, string>()
  const shared = { stored, full: false }
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (shared.full) throw new Error("full")
      stored.set(key, value)
    },
  })
  return shared
}

test("a change starts from what another window kept while none here heard, so neither loses the other's", () => {
  storage()
  const here = kept("record", isText)
  const there = kept("record", isText)
  here.read()
  there.put("a", "from there")
  here.put("b", "from here")
  expect(there.read()).toEqual({ a: "from there" })
  expect(kept("record", isText).read()).toEqual({
    a: "from there",
    b: "from here",
  })
})

test("a window whose storage will not take a change keeps it, and the next change with it", () => {
  const shared = storage()
  const here = kept("record", isText)
  here.put("a", "kept")
  shared.full = true
  here.put("b", "only here")
  here.put("c", "only here too")
  expect(here.read()).toEqual({
    a: "kept",
    b: "only here",
    c: "only here too",
  })
  here.drop("b")
  expect(here.read()).toEqual({ a: "kept", c: "only here too" })
  // The storage taking it again has all of it.
  shared.full = false
  here.put("d", "back")
  expect(kept("record", isText).read()).toEqual({
    a: "kept",
    c: "only here too",
    d: "back",
  })
})
