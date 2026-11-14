import { expect, test } from "vitest"
import { pickAfter, pickIn, stepped } from "./pick"

// Your turn's a b c, then Open's d e: one drawn order across parts.
const order = ["a", "b", "c", "d", "e"]
const after = (picked: string, ...gone: string[]) =>
  pickAfter(order, new Set(gone.length > 0 ? gone : [picked]), picked)

test("after an act the pick goes on to the card below, as in a mail inbox (spec §2.7)", () => {
  // The middle: the one below.
  expect(after("b")).toBe("c")
  // The first: the one below too.
  expect(after("a")).toBe("b")
  // Across parts: the last of Your turn goes on to Open's first.
  expect(after("c")).toBe("d")
  // The last: the nearest above.
  expect(after("e")).toBe("d")
  // Several gone at once: below the last of them, else above the first.
  expect(after("b", "b", "c")).toBe("d")
  expect(after("d", "c", "d", "e")).toBe("b")
  // All gone: none, and the list says inbox zero.
  expect(after("c", ...order)).toBeUndefined()
  expect(pickAfter(["a"], new Set(["a"]), "a")).toBeUndefined()
})

test("a pick whose card did not go stays: a U, or an S refused", () => {
  expect(pickAfter(order, new Set(), "b")).toBe("b")
  expect(after("b", "d")).toBe("b")
})

test("on the way in the pick is the open Thread's card, else the tab's last, else the first", () => {
  expect(pickIn(order, "d", "b")).toBe("d")
  // The open Thread is not in this tab.
  expect(pickIn(order, "x", "b")).toBe("b")
  // Nor is the last pick any more.
  expect(pickIn(order, "x", "y")).toBe("a")
  expect(pickIn(order, undefined, undefined)).toBe("a")
  expect(pickIn([], "a", "a")).toBeUndefined()
})

test("the arrows move the pick from stop to stop and stop at the ends", () => {
  expect(stepped(order, "b", 1)).toBe("c")
  expect(stepped(order, "b", -1)).toBe("a")
  // They do not wrap.
  expect(stepped(order, "e", 1)).toBe("e")
  expect(stepped(order, "a", -1)).toBe("a")
  // A page is several stops, and stops at the ends too.
  expect(stepped(order, "b", 9)).toBe("e")
  expect(stepped(order, "d", -9)).toBe("a")
  expect(stepped(order, "c", "first")).toBe("a")
  expect(stepped(order, "c", "last")).toBe("e")
  // From a pick no longer drawn: down starts at the top, up at the foot.
  expect(stepped(order, "gone", 1)).toBe("a")
  expect(stepped(order, undefined, -1)).toBe("e")
  expect(stepped([], "a", 1)).toBeUndefined()
})
