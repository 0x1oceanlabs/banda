import { expect, test } from "vitest"
import { PRESENT_FOR, presence } from "./presence"

/** A window's inputs, and its clock, as a test moves them. */
function aWindow() {
  const target = new EventTarget()
  let at = 1_000
  const when = presence(target, () => at)
  const input = (type: string, fields: object = {}) =>
    target.dispatchEvent(Object.assign(new Event(type), fields))
  return {
    when,
    input,
    later: (ms: number) => void (at += ms),
  }
}

test("with no input yet, it waits for the first one", () => {
  const { when, input } = aWindow()
  const acted: string[] = []
  when(() => acted.push("seen"))
  expect(acted).toEqual([])
  input("keydown")
  expect(acted).toEqual(["seen"])
  // Once: the next input does nothing more.
  input("keydown")
  expect(acted).toEqual(["seen"])
})

test("an input within the last minute counts; one older does not", () => {
  const { when, input, later } = aWindow()
  const acted: string[] = []
  input("pointerdown")
  later(PRESENT_FOR - 1)
  when(() => acted.push("at once"))
  expect(acted).toEqual(["at once"])
  later(1)
  when(() => acted.push("after"))
  expect(acted).toEqual(["at once"])
  input("wheel")
  expect(acted).toEqual(["at once", "after"])
})

test("a wait called off never acts", () => {
  const { when, input } = aWindow()
  const acted: string[] = []
  const off = when(() => acted.push("seen"))
  off()
  input("keydown")
  expect(acted).toEqual([])
})

test("a pointer that did not move is no one", () => {
  const { when, input, later } = aWindow()
  const acted: string[] = []
  input("pointermove", { screenX: 10, screenY: 20 })
  later(PRESENT_FOR)
  when(() => acted.push("seen"))
  // The page scrolled under it: the same place.
  input("pointermove", { screenX: 10, screenY: 20 })
  expect(acted).toEqual([])
  input("pointermove", { screenX: 11, screenY: 20 })
  expect(acted).toEqual(["seen"])
})

test("the first pointer move says only where the pointer is", () => {
  const { when, input } = aWindow()
  const acted: string[] = []
  when(() => acted.push("seen"))
  // The window started again under a pointer at rest: no one moved it.
  input("pointermove", { screenX: 10, screenY: 20 })
  expect(acted).toEqual([])
  input("pointermove", { screenX: 10, screenY: 21 })
  expect(acted).toEqual(["seen"])
})

test("what is not an input counts for nothing", () => {
  const { when, input } = aWindow()
  const acted: string[] = []
  when(() => acted.push("seen"))
  input("focus")
  input("scroll")
  expect(acted).toEqual([])
})
