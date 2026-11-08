import type { Call, Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import { expect, test } from "vitest"
import {
  type Column,
  consume,
  current,
  open,
  share,
  start,
  widthIn,
  type Workspaces,
} from "../tiling/model"
import {
  besideOf,
  nextCall,
  type Shows,
  showing,
  type Shown,
  sightOf,
} from "./sight"

const call = (about: string, chime: Chime, since = 0): Call => ({
  key: `s:${about}`,
  project: "s",
  about,
  chime,
  title: about,
  pane: { kind: "agents.thread", args: { thread: about } },
  since,
})

test("the Person looks at the focused Pane of the window in front", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const w = open(
    open(start(), "s", call("t1", "done").pane),
    "s",
    call("t2", "done").pane,
    { place: "right" }
  )
  expect(sightOf(w, { project: "s", about: "t2" }, true, shows)).toBe("looking")
  expect(sightOf(w, { project: "s", about: "t1" }, true, shows)).toBe(
    "on-screen"
  )
  expect(sightOf(w, { project: "s", about: "t3" }, true, shows)).toBe(
    "in-window"
  )
  expect(sightOf(w, { project: "other", about: "t2" }, true, shows)).toBe(
    "in-window"
  )
  expect(sightOf(w, { project: "s", about: "t2" }, false, shows)).toBe("away")
  expect(showing(w, { project: "s", about: "t1" }, shows)?.pane.args).toEqual({
    thread: "t1",
  })
  // In one column as a Deck, the Thread behind the shown Pane is out of sight.
  const grouped = consume(w, "left")
  expect(sightOf(grouped, { project: "s", about: "t1" }, true, shows)).toBe(
    "on-screen"
  )
  const decked = { display: "deck" as const }
  expect(
    sightOf(grouped, { project: "s", about: "t1" }, true, shows, {
      look: decked,
    })
  ).toBe("in-window")
})

/** What of the workspace on screen shows, by column: the share of each
 * that the Tiling measured inside the Strip's clip. */
const measured =
  (shares: Record<string, number>): Shown =>
  () =>
    new Map(Object.entries(shares))

test("a Tile is on screen while at least half of it shows inside the Strip's clip (ADR 0087, decision 9)", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  // t1 | t2 | t3, the last in front.
  let w = open(start(), "s", call("t1", "done").pane)
  w = open(w, "s", call("t2", "done").pane, { place: "right" })
  w = open(w, "s", call("t3", "done").pane, { place: "right" })
  const [c1, c2] = current(w).columns.map((column) => column.id)
  const sight = (about: string, shown?: Shown) =>
    sightOf(w, { project: "s", about }, true, shows, { shown })
  // Half of it in view is enough; less, it is out of sight, and gets its
  // toast as on another workspace.
  expect(sight("t2", measured({ [c2]: 0.5 }))).toBe("on-screen")
  expect(sight("t2", measured({ [c2]: 0.49 }))).toBe("in-window")
  expect(sight("t1", measured({ [c1]: 0, [c2]: 1 }))).toBe("in-window")
  // Nothing measured, as with no Strip drawn: every column shows whole.
  expect(sight("t1", () => undefined)).toBe("on-screen")
  expect(sight("t1")).toBe("on-screen")
  // What shows is measured only for a thing a Tile on screen may show:
  // not for the one in front, one shown nowhere, or a window behind.
  let asked = 0
  const counted: Shown = () => (asked++, undefined)
  expect(sight("t3", counted)).toBe("looking")
  expect(sight("t9", counted)).toBe("in-window")
  expect(
    sightOf(w, { project: "s", about: "t1" }, false, shows, { shown: counted })
  ).toBe("away")
  expect(asked).toBe(0)
  expect(sight("t1", counted)).toBe("on-screen")
  expect(asked).toBe(1)
})

test("in Solo the filled Group takes the whole clip, so the Tiles beside it are out of sight (ADR 0087, decision 9)", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const column = (about: string, group?: string): Column => ({
    id: about,
    entries: [
      { id: `e${about}`, project: "s", pane: call(about, "done").pane },
    ],
    active: 0,
    ...(group !== undefined && { group }),
  })
  // t1's Group | t2 and its second column in t2's Group | a column alone.
  const columns = [
    column("t1", "g1"),
    column("t2", "g2"),
    column("t2b", "g2"),
    column("t3"),
  ]
  const at = (focus: number, filled?: string): Workspaces => ({
    list: [
      { id: "w", columns, focus, project: "s", ...(filled && { filled }) },
      { id: "below", columns: [], focus: 0 },
    ],
    current: 0,
  })
  // What shows with the Strip scrolled to column `from`'s left, one screen
  // wide: each column as wide as the model draws it, gaps aside.
  const scrolledTo =
    (w: Workspaces, from: string): Shown =>
    () => {
      const workspace = current(w)
      let left = 0
      const placed = workspace.columns.map((one) => {
        const width = share(widthIn(workspace, one)) ?? 0.5
        left += width
        return { id: one.id, left: left - width, right: left }
      })
      const view = placed.find((one) => one.id === from)!.left
      return new Map(
        placed.map((one) => {
          const shown = Math.min(one.right, view + 1) - Math.max(one.left, view)
          return [one.id, Math.max(0, shown) / (one.right - one.left)]
        })
      )
    }
  const sight = (w: Workspaces, about: string, shown?: Shown) =>
    sightOf(w, { project: "s", about }, true, shows, { shown })
  // Solo on t2: its Group fills the screen, and the rest is past its
  // edges.
  const solo = at(1, "g2")
  const filled = scrolledTo(solo, "t2")
  expect([...filled()!.values()]).toEqual([0, 1, 1, 0])
  expect(sight(solo, "t2", filled)).toBe("looking")
  expect(sight(solo, "t2b", filled)).toBe("on-screen")
  expect(sight(solo, "t1", filled)).toBe("in-window")
  expect(sight(solo, "t3", filled)).toBe("in-window")
  // What shows decides, as the Strip has it: the focus out of the Group,
  // on t3, which the Strip brings into view.
  const out = at(3, "g2")
  expect(sight(out, "t2b", scrolledTo(out, "t2b"))).toBe("on-screen")
  expect(sight(out, "t1", scrolledTo(out, "t2b"))).toBe("in-window")
  // The overview shows the Strip whole, and measures nothing.
  expect(sight(solo, "t1", () => undefined)).toBe("on-screen")
})

test("under a zoom only the zoomed Pane shows; a Pane in a window of its own shows there", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  let w = open(start(), "s", call("t1", "done").pane)
  w = open(w, "s", call("t2", "done").pane, { place: "right" })
  const [c1] = current(w).columns.map((column) => column.id)
  const t1 = current(w).columns[0].entries[0].id
  const sight = (about: string, screen: Parameters<typeof sightOf>[4]) =>
    sightOf(w, { project: "s", about }, true, shows, screen)
  let asked = 0
  const whole: Shown = () => (asked++, undefined)
  // Zoomed, t2 has the focus and covers the window: t1 is hidden.
  expect(sight("t2", { zoomed: true, shown: whole })).toBe("looking")
  expect(sight("t1", { zoomed: true, shown: whole })).toBe("in-window")
  expect(asked).toBe(0)
  // Popped out, t1's own window shows it, wherever its stand-in is.
  const out = measured({ [c1]: 0 })
  expect(sight("t1", { shown: out })).toBe("in-window")
  expect(sight("t1", { shown: out, away: new Set([t1]) })).toBe("on-screen")
  expect(sight("t1", { zoomed: true, away: new Set([t1]) })).toBe("on-screen")
})

test("what an Agent opens goes beside the Pane of the Thread it works in", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const listed = (id: string, agent: string): Listed => ({
    id,
    title: id,
    mark: "rest",
    changed: 0,
    agent,
    pane: call(id, "done").pane,
  })
  const browser = { kind: "browser", args: { url: "a" } }
  const lists = { s: [listed("t1", "a1"), listed("t2", "a2")] }
  // t1 | browser | t2, and t2 is shown nowhere else.
  let w = open(start(), "s", call("t1", "done").pane)
  w = open(w, "s", browser, { place: "right" })
  w = open(w, "s", call("t2", "done").pane, { place: "right" })
  const t1 = showing(w, { project: "s", about: "t1" }, shows)!
  expect(besideOf(w, lists, "a1", shows)).toEqual({
    project: "s",
    from: t1.id,
    right: [browser],
  })
  // The last column has none right of it.
  expect(besideOf(w, lists, "a2", shows)?.right).toEqual([])
  // A Thread no Pane shows has its Project alone; no Thread, nothing.
  const gone = open(start(), "s", browser)
  expect(besideOf(gone, lists, "a1", shows)).toEqual({
    project: "s",
    right: [],
  })
  expect(besideOf(w, lists, "a3", shows)).toBeNull()
})

test("Alt+U goes to the next call below, in the sidebar's order, and round", () => {
  const order = ["s:t1", "s:t2", "s:t3", "s:t4"]
  const calling = [
    call("t3", "asking", 5),
    call("t1", "done", 1),
    call("t4", "done", 9),
  ]
  // From nowhere, the first the sidebar lists, however loud the rest.
  expect(nextCall(calling, order)?.about).toBe("t1")
  // Below the Thread you are at, and from the end back to the top.
  expect(nextCall(calling, order, "s:t2")?.about).toBe("t3")
  expect(nextCall(calling, order, "s:t3")?.about).toBe("t4")
  expect(nextCall(calling, order, "s:t4")?.about).toBe("t1")
  // A call the sidebar lists nowhere comes last.
  expect(nextCall([call("t9", "asking", 0)], order, "s:t4")?.about).toBe("t9")
  expect(nextCall([], order)).toBeUndefined()
})
