import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { describe, expect, test } from "vitest"
import type { Row } from "./rows"
import {
  type By,
  GRACE,
  heldUntil,
  hold,
  holdersAfter,
  KEYS_HOLD,
  type Mine,
  NO_HOLDERS,
  shapeOf,
  wentWords,
} from "./hold"
import { type Block, SHELF } from "./inbox"
import { itemsOf, placesOf } from "./motion"
import { regionsOf } from "./regions"

const project = { id: "s" as ProjectId, name: "S" } as ProjectSummary
const row = (id: string, stand: Stand, more: Partial<Listed> = {}): Row => ({
  project,
  listed: { id, title: id, mark: "rest", changed: 0, ...more } as Listed,
  stand,
})
const head = (key: string, label: string, count?: number): Block => ({
  kind: "head",
  key: `${key}:head`,
  label,
  ...(count === undefined ? {} : { count }),
})
const cards = (key: string, stand: Stand, rows: Row[]): Block => ({
  kind: "rows",
  key,
  stand,
  rows: rows.map((one) => ({ row: one, at: 0 })),
})
/** The Inbox's three parts, as `inbox.ts` lays them out. */
const inbox = (turn: Row[], open: Row[], working: Row[]): Block[] => [
  ...(turn.length > 0
    ? [head("turn", "Your turn", turn.length), cards("turn", "turn", turn)]
    : []),
  ...(turn.length > 0 && open.length > 0
    ? [{ kind: "divider" as const, key: "divider" }]
    : []),
  ...(open.length > 0 ? [cards("open", "open", open)] : []),
  ...(working.length > 0
    ? [
        head("working", "Working", working.length),
        cards("working", "working", working),
      ]
    : []),
]
/** What `blocks` list, with `rows` of the other tabs too. */
const next = (blocks: Block[], ...rows: Row[]) => ({
  blocks,
  rows: [
    ...blocks.flatMap((block) =>
      block.kind === "rows" ? block.rows.map((entry) => entry.row) : []
    ),
    ...rows,
  ],
})
/** Each part's cards, by their Threads. */
const parts = (blocks: Block[]) =>
  Object.fromEntries(
    blocks.flatMap((block) =>
      block.kind === "rows"
        ? [[block.key, block.rows.map(({ row }) => row.listed.id)]]
        : []
    )
  )
/** Where each card stands, from the list's top, in px. */
const tops = (blocks: Block[]) => {
  const items = itemsOf(regionsOf(blocks), () => 2)
  const places = placesOf(items, new Map())
  return new Map(items.map((item, i) => [item.key, places[i]!.top]))
}
const NONE: Mine = new Map()
/** The Person's acts: on each card by its Thread, how, and where it stood
 * as they took it. */
const acts = (...each: [string, By, Stand][]): Mine =>
  new Map(each.map(([id, by, was]) => [`:${id}`, { by, was }]))

// The list as the pointer came: a and b call, c and d are open, e and f
// work.
const [a, b, c, d, e, f] = [
  row("a", "turn"),
  row("b", "turn"),
  row("c", "open"),
  row("d", "open"),
  row("e", "working"),
  row("f", "working"),
]
const drawn = inbox([a, b], [c, d], [e, f])

describe("while it holds", () => {
  // Since: f is done and calls, g is new and calls, b was archived on the
  // Mac, d was seen again and comes first, and e was deleted.
  const done = row("f", "turn", { mark: "done" })
  const g = row("g", "turn")
  const archived = row("b", "archived")
  const now = next(inbox([a, done, g], [d, c], []), archived)

  test("no card's place changes", () => {
    const held = hold(now, drawn, NONE)
    const before = tops(drawn)
    const after = tops(held.blocks)
    for (const [key, top] of before) expect(after.get(key), key).toBe(top)
    expect(parts(held.blocks)).toEqual({
      turn: ["a", "b"],
      open: ["c", "d"],
      working: ["e", "f"],
    })
  })

  test("a card that changes part keeps its slot and says what it says now", () => {
    const held = hold(now, drawn, NONE)
    const working = held.blocks.find((block) => block.key === "working")
    expect(working?.kind === "rows" && working.rows[1]?.row).toBe(done)
    expect(held.leaving.has(":f")).toBe(false)
  })

  test("a card that left stays dimmed, saying where it went, and goes as the hold lets go", () => {
    const held = hold(now, drawn, NONE)
    expect(held.leaving.get(":b")).toEqual({ to: "archived", from: "turn" })
    expect(held.leaving.get(":e")).toEqual({ to: "deleted", from: "working" })
    expect(wentWords(held.leaving.get(":b")!, 0)).toBe("Archived")
    expect(wentWords(held.leaving.get(":e")!, 0)).toBe("Deleted")
    // Its content is what the list says of it now.
    const turn = held.blocks.find((block) => block.key === "turn")
    expect(turn?.kind === "rows" && turn.rows[1]?.row).toBe(archived)
    const free = hold(now, undefined, NONE)
    expect(parts(free.blocks).turn).toEqual(["a", "f", "g"])
    expect(free.leaving.size).toBe(0)
  })

  test("a card new to the tab waits, while the counts say it is there", () => {
    const held = hold(now, drawn, NONE)
    expect(held.coming).toEqual([":g"])
    expect(held.blocks[0]).toEqual(head("turn", "Your turn", 3))
    // The Working shelf's head, gone from the list, stays as it was.
    expect(held.blocks).toContainEqual(head("working", "Working", 2))
  })

  test("the Person's own act applies at once: by a key its slot closes, by the pointer a ghost stands in it", () => {
    const byKey = hold(now, drawn, acts(["b", "key", "turn"]))
    expect(parts(byKey.blocks).turn).toEqual(["a"])
    expect(byKey.leaving.has(":b")).toBe(false)
    expect(byKey.closed).toEqual([":b"])
    const byPointer = hold(now, drawn, acts(["b", "pointer", "turn"]))
    expect(parts(byPointer.blocks).turn).toEqual(["a", "b"])
    expect(byPointer.ghosts.get(":b")).toEqual({
      to: "archived",
      from: "turn",
    })
    expect(byPointer.leaving.has(":b")).toBe(false)
    expect(byPointer.closed).toEqual([])
  })

  test("an act that leaves its card where it stands lets its Agent's work hold, as any change from outside", () => {
    // f renamed as it worked, then done; a renamed by its key once its
    // click had seen it, still drawn in Your turn.
    const seen = row("a", "open")
    const held = hold(
      next(inbox([b, done], [seen, c, d], [e])),
      drawn,
      acts(["f", "pointer", "working"], ["a", "key", "open"])
    )
    expect(parts(held.blocks)).toEqual({
      turn: ["a", "b"],
      open: ["c", "d"],
      working: ["e", "f"],
    })
    expect(held.closed).toEqual([])
    // Put off after all, by that same key, it goes at once.
    const later = row("a", "later")
    const putOff = hold(
      next(inbox([b], [c, d], [e, f]), later),
      drawn,
      acts(["a", "key", "open"])
    )
    expect(parts(putOff.blocks).turn).toEqual(["b"])
  })

  test("the Person's own act moves its card to another part drawn, and brings one back where it is now", () => {
    // c marked unread, and h back from the Archive by Undo, between c and
    // d.
    const unread = row("c", "turn")
    const h = row("h", "open")
    const acted = next(inbox([a, b, unread], [h, d], [e, f]))
    const held = hold(
      acted,
      drawn,
      acts(["c", "pointer", "open"], ["h", "key", "archived"])
    )
    expect(parts(held.blocks)).toEqual({
      turn: ["a", "b", "c"],
      open: ["h", "d"],
      working: ["e", "f"],
    })
    expect(held.coming).toEqual([])
  })
})

test("an own act that empties the tab takes its head with it, and brings its empty words at once", () => {
  const archive: Block[] = [
    head("later:today", "Today"),
    cards("archived", "archived", [b]),
  ]
  const empty: Block = { kind: "empty", key: "archive:empty", tab: "archive" }
  const now = next([empty], row("b", "open"))
  expect(hold(now, archive, acts(["b", "key", "archived"])).blocks).toEqual([
    empty,
  ])
  // From outside, it stays dimmed under its head, and the words wait.
  const held = hold(now, archive, NONE)
  expect(held.blocks).toEqual([
    archive[0],
    cards("archived", "archived", [row("b", "open")]),
  ])
  // Its last card gone by a key, Your turn's head goes, and inbox zero
  // comes first.
  const zero: Block = { kind: "zero", key: "zero", working: 2 }
  const left = hold(
    next(
      [
        zero,
        head("working", "Working", 2),
        cards("working", "working", [e, f]),
      ],
      row("a", "archived")
    ),
    inbox([a], [], [e, f]),
    acts(["a", "key", "turn"])
  )
  expect(left.blocks.map((block) => block.key)).toEqual([
    "zero",
    "working:head",
    "working",
  ])
})

test("a card that drops past the Working shelf's cut changed part, not tab: it stays live in its slot", () => {
  // a is answered from its composer and works again, the newest at work,
  // past the shelf's first six.
  const shelf = Array.from({ length: SHELF }, (_, i) => row(`w${i}`, "working"))
  const working = row("a", "working")
  const now = next([
    head("working", "Working", SHELF + 1),
    cards("working", "working", shelf),
    { kind: "more", key: "working:more", of: "working", count: 1 },
  ])
  const held = hold(
    { ...now, rows: [...now.rows, working] },
    inbox([a], [], shelf),
    NONE
  )
  expect(parts(held.blocks)).toEqual({
    turn: ["a"],
    working: shelf.map(({ listed }) => listed.id),
  })
  const turn = held.blocks.find((block) => block.key === "turn")
  expect(turn?.kind === "rows" && turn.rows[0]?.row).toBe(working)
  expect(held.leaving.size).toBe(0)
  expect(held.coming).toEqual([])
})

test("where a card went, in words", () => {
  expect(wentWords({ to: "later", from: "turn", someday: true }, 0)).toBe(
    "Later · someday"
  )
  expect(wentWords({ to: "later", from: "working" }, 0)).toBe(
    "Later · when it's done"
  )
  expect(wentWords({ to: "later", from: "open", until: 3_600_000 }, 0)).toMatch(
    /^Later · .*\d/
  )
  expect(wentWords({ to: "open", from: "later" }, 0)).toBe("Woke")
  expect(wentWords({ to: "open", from: "archived" }, 0)).toBe("Unarchived")
  expect(wentWords({ to: "turn", from: "working" }, 0)).toBeUndefined()
})

test("a list's shape is its parts, their cards in order and the groups folded, not what the cards say", () => {
  const said = inbox(
    [row("a", "turn", { title: "a, again" }), b],
    [c, d],
    [e, f]
  )
  expect(shapeOf(said)).toBe(shapeOf(drawn))
  expect(shapeOf(inbox([b, a], [c, d], [e, f]))).not.toBe(shapeOf(drawn))
  const group = (folded: boolean): Block => ({
    kind: "group",
    key: "project:s",
    by: "project",
    folded,
    mark: "rest",
    waiting: 0,
    working: 0,
  })
  expect(shapeOf([group(true)])).not.toBe(shapeOf([group(false)]))
})

test("it holds while the pointer, a popup or check mode lasts, and lets go 150 ms after the last of them ends", () => {
  expect(heldUntil(NO_HOLDERS)).toBe(-Infinity)
  let holders = holdersAfter(NO_HOLDERS, { pointer: true }, 1000)
  expect(heldUntil(holders)).toBe(Infinity)
  holders = holdersAfter(holders, { popups: 1 }, 1100)
  holders = holdersAfter(holders, { pointer: false }, 1200)
  expect(heldUntil(holders)).toBe(Infinity)
  holders = holdersAfter(holders, { popups: 0 }, 1300)
  expect(heldUntil(holders)).toBe(1300 + GRACE)
  holders = holdersAfter(holders, { checking: true }, 1400)
  expect(heldUntil(holders)).toBe(Infinity)
  holders = holdersAfter(holders, { checking: false }, 1500)
  expect(heldUntil(holders)).toBe(1500 + GRACE)
})

test("a list key holds it for 2 s, and the window going away lets go at once, until the pointer comes back", () => {
  const keyed = holdersAfter(NO_HOLDERS, { keyed: 5000 }, 5000)
  expect(heldUntil(keyed)).toBe(5000 + KEYS_HOLD + GRACE)
  const pointed = holdersAfter(keyed, { pointer: true }, 5100)
  const away = holdersAfter(pointed, { away: true, pointer: false }, 5200)
  expect(heldUntil(away)).toBe(-Infinity)
  const back = holdersAfter(away, { pointer: true, away: false }, 9000)
  expect(heldUntil(back)).toBe(Infinity)
})
