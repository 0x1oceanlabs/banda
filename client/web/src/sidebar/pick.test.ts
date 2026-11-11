import { expect, test } from "vitest"
import {
  allChecked,
  type Checks,
  checksOf,
  NO_CHECKS,
  pickAfter,
  pickIn,
  ranged,
  stepped,
  stillDrawn,
  type Stop,
  toggled,
} from "./pick"

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

// Your turn's a b, a folded group g, then c d and "+ 2 more": the stops
// drawn, the cards alone selectable.
const stops: Stop[] = [
  { key: "a", card: true },
  { key: "b", card: true },
  { key: "#g", card: false },
  { key: "c", card: true },
  { key: "d", card: true },
  { key: "#more", card: false },
]
const keys = (checks: Checks) => [...checks.selected]

test("X and Ctrl+click check a card or no longer; the last checked anchors a range", () => {
  const one = toggled(NO_CHECKS, "b")
  expect(keys(one)).toEqual(["b"])
  expect(one.anchor).toBe("b")
  const two = toggled(one, "d")
  expect(keys(two)).toEqual(["b", "d"])
  expect(two.anchor).toBe("d")
  // Unchecked, the last one leaves no selection: plain again.
  expect(toggled(toggled(one, "b"), "x")).toEqual(toggled(NO_CHECKS, "x"))
  expect(toggled(one, "b")).toBe(NO_CHECKS)
})

test("Shift+↓ and Shift+click check the range from the anchor, cards alone, and Shift+↑ gives back what it took", () => {
  // No anchor yet: from the pick it moved from.
  const down = ranged(NO_CHECKS, stops, "b", "a")
  expect(keys(down)).toEqual(["a", "b"])
  // On past a folded group: the group is no card.
  const further = ranged(down, stops, "c")
  expect(keys(further)).toEqual(["a", "b", "c"])
  // And back up: the range shrinks.
  expect(keys(ranged(further, stops, "b"))).toEqual(["a", "b"])
  // Upwards from the anchor.
  expect(keys(ranged(toggled(NO_CHECKS, "c"), stops, "a"))).toEqual([
    "c",
    "a",
    "b",
  ])
  // What was checked before the range stays.
  const kept = ranged(toggled(toggled(NO_CHECKS, "a"), "c"), stops, "d")
  expect(keys(kept).sort()).toEqual(["a", "c", "d"])
  // To a stop no longer drawn: as it was.
  expect(ranged(down, stops, "gone")).toBe(down)
})

test("Ctrl+A checks every card drawn: a folded group and + N more stay out", () => {
  expect(keys(allChecked(stops))).toEqual(["a", "b", "c", "d"])
  expect(allChecked([{ key: "#g", card: false }])).toBe(NO_CHECKS)
})

test("a card no longer drawn leaves the selection; none left, plain again", () => {
  const all = allChecked(stops)
  expect(stillDrawn(all, stops)).toBe(all)
  const fewer = stillDrawn(all, stops.slice(2))
  expect(keys(fewer)).toEqual(["c", "d"])
  expect(fewer.anchor).toBeUndefined()
  expect(stillDrawn(all, [])).toBe(NO_CHECKS)
  expect(keys(checksOf(["d", "a"]))).toEqual(["d", "a"])
  expect(checksOf([])).toBe(NO_CHECKS)
})
