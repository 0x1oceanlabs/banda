import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { open, start } from "../tiling/model"
import { awayTo, sheetEntries, take } from "./Sheet"

/** An element as the Sheet's check reads it: what it is in, as
 * `[data-stack]`. */
const element = ({ inside = [] as string[] } = {}) =>
  ({
    closest: (selector: string) =>
      selector.split(", ").some((one) => inside.includes(one)) ? {} : null,
  }) as unknown as HTMLElement

test("the keys going to a Pane take the Sheet away: a tile, the dropped drawer's, the overview, or a page a tile holds (ADR 0102, decision 5)", () => {
  expect(awayTo(element({ inside: ["[data-stack]"] }))).toBe(true)
  expect(awayTo(element({ inside: ["[data-drawer]"] }))).toBe(true)
  expect(awayTo(element({ inside: ["[data-overview-state]"] }))).toBe(true)
  // The Sheet itself, the sidebar and the bar keep it.
  expect(awayTo(element({ inside: ["[data-sheet]"] }))).toBe(false)
  expect(awayTo(element())).toBe(false)
  expect(awayTo(null)).toBe(false)
  // A browser's page, in the layer over the workspaces, held by its tile.
  vi.stubGlobal("CSS", { escape: (id: string) => id })
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector === '[data-holds="page-1"]' ? {} : null,
  })
  const page = {
    closest: (selector: string) =>
      selector === "[data-held-by]" ? { getAttribute: () => "page-1" } : null,
  } as unknown as Element
  expect(awayTo(page)).toBe(true)
  vi.unstubAllGlobals()
})

test("the Sheet takes the keys, though a toast's button gives them back to the composer as it blurs", () => {
  const keys = { activeElement: null as unknown }
  vi.stubGlobal("document", keys)
  const composer = {}
  let handed = false
  const panel = {
    // The first time, the toast's button hands them on as it blurs.
    focus: () => {
      keys.activeElement = handed ? panel : composer
      handed = true
    },
    contains: (at: unknown) => at === panel,
  }
  take(panel as unknown as HTMLElement)
  expect(keys.activeElement).toBe(panel)
  vi.unstubAllGlobals()
})

test("the tiles kept from before the Sheet came are those of the kinds that come as it", () => {
  const right = { place: "right" } as const
  const panes: PaneState[] = [
    { kind: "agents.thread", args: { thread: "t1" } },
    { kind: "window.settings", args: { link: "" } },
    { kind: "harnesses.usage", args: {} },
    { kind: "terminal.terminal", args: {} },
  ]
  const state = panes.reduce(
    (state, pane) => open(state, "project-a", pane, right),
    start()
  )
  expect(sheetEntries(state).map((entry) => entry.pane.kind)).toEqual([
    "window.settings",
    "harnesses.usage",
  ])
})
