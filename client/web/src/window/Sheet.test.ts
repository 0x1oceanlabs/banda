import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { open, start } from "../tiling/model"
import { backTo, escAway, sheetEntries, take } from "./Sheet"

/** An element as the Sheet's checks read it: in the page or gone, what
 * it is in, as `[data-tile]`, and whether it is a field. */
const element = ({
  connected = true,
  inside = [] as string[],
  field = false,
} = {}) =>
  ({
    isConnected: connected,
    closest: (selector: string) =>
      selector.split(", ").some((one) => inside.includes(one)) ? {} : null,
    matches: () => field,
  }) as unknown as HTMLElement

test("Esc takes the Sheet away wherever the focus is, but not from a menu over it, nor one a field in it took (ADR 0102, decision 5)", () => {
  // In it, on nothing, or in a composer behind it that took the Esc.
  expect(escAway("Escape", false, element({ inside: ["[data-sheet]"] }))).toBe(
    true
  )
  expect(escAway("Escape", false, null)).toBe(true)
  expect(escAway("Escape", true, element({ inside: ["[data-tile]"] }))).toBe(
    true
  )
  // The search with words clears first; a menu, a dialog or suggestions
  // over it take theirs.
  expect(escAway("Escape", true, element({ inside: ["[data-sheet]"] }))).toBe(
    false
  )
  const listed = element({ inside: ["[data-sheet]", "[role=listbox]"] })
  expect(escAway("Escape", false, listed)).toBe(false)
  expect(escAway("Escape", false, element({ inside: ["[role=dialog]"] }))).toBe(
    false
  )
  expect(escAway("a", false, null)).toBe(false)
})

test("as the Sheet goes, the keys go back to the tile or field they came from, else to the focused Pane's tile", () => {
  const tile = element({ inside: ["[data-tile]"] })
  const composer = element({ inside: ["[data-tile]"], field: true })
  expect(backTo(composer, tile)).toBe(composer)
  // A field outside the tiles, as the sidebar's.
  const field = element({ field: true })
  expect(backTo(field, tile)).toBe(field)
  // The gear, or a menu's row or the Sheet itself, gone as it went, give
  // them to the focused Pane.
  expect(backTo(element(), tile)).toBe(tile)
  const gone = element({ connected: false, inside: ["[data-tile]"] })
  expect(backTo(gone, tile)).toBe(tile)
  expect(backTo(null, null)).toBeNull()
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
