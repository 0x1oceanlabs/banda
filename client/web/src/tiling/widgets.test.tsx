/**
 * The Tiling's widgets on the Bar read the workspaces by selector from what
 * the Window keeps (`kept.ts`), and a number acts by an action's id (ADR
 * 0087, decision 11). They are drawn to text, with React's
 * `useSyncExternalStore` played by hand: a reader asks to be drawn again
 * as React's does, once what it selects is another value, and what it
 * selected then is kept in `asked`.
 */
import type { Engine, ProjectId } from "@banda/contract"
import { type Run, Store } from "@banda/core/react"
import type { PaneState } from "@banda/ui/pane"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, test, vi } from "vitest"
import { TilingContext } from "./kept"
import { fresh, go, inBar, move, open, start, type Workspaces } from "./model"
import { WORKSPACES } from "./widget-ids"
import { picked, tilingWidgets } from "./widgets"

const asked = vi.hoisted(() => [] as unknown[])
vi.mock("react", async (actual) => ({
  ...(await actual<typeof import("react")>()),
  useSyncExternalStore: <T,>(
    subscribe: (listener: () => void) => () => void,
    read: () => T
  ) => {
    let last = read()
    subscribe(() => {
      const next = read()
      if (Object.is(next, last)) return
      last = next
      asked.push(next)
    })
    return last
  },
}))

beforeEach(() => {
  asked.length = 0
})

const terminal = (n: number): PaneState => ({
  kind: "terminal.shell",
  args: { n },
})
const right = { place: "right" } as const
const project = "p1" as ProjectId

/** The workspaces' widget, drawn from a store that holds `state`, as the
 * Window's `Kept` gives the Tiling's: its markup, and the store. */
function drawn(state: Workspaces) {
  const { Widget } = tilingWidgets.find((widget) => widget.id === WORKSPACES)!
  const store = new Store(state)
  const markup = renderToStaticMarkup(
    <TilingContext value={store}>
      <Widget engine={{} as Engine} projects={[]} />
    </TilingContext>
  )
  return {
    markup,
    draw: (state: Workspaces) => store.set(state),
  }
}

test("the numbers draw the workspaces the bar shows from the Tiling's store, past the ninth", () => {
  let state = start()
  for (let n = 1; n <= 11; n++)
    state = open(fresh(state), project, terminal(n), right)
  const { markup } = drawn(go(state, 0))
  const named = [...markup.matchAll(/aria-label="([^"]+)"/g)].map(
    ([, name]) => name
  )
  expect(named).toEqual([
    "Workspaces",
    ...Array.from({ length: 11 }, (_, i) => `Workspace ${i + 1}`),
    "New workspace",
  ])
  // The first is on screen; the eleventh, which no key reaches, says its
  // name alone.
  expect(markup).toMatch(/aria-current="true" aria-label="Workspace 1"/)
  expect(markup).toContain('aria-label="Workspace 11" title="Workspace 11"')
})

test("a number runs an action by its id: the one on screen the overview, another a go by its place, past the ninth too", () => {
  const ran: unknown[][] = []
  const run: Run = (...call) => void ran.push(call)
  picked(run, 10, 0)
  picked(run, 0, 0)
  picked(run, 3, 4)
  expect(ran).toEqual([
    ["workspace.go", { index: 10 }],
    ["overview.toggle"],
    ["workspace.go", { index: 3 }],
  ])
})

test("a key that moves only the focus draws the numbers not again", () => {
  const two = open(
    open(start(), project, terminal(1), right),
    project,
    terminal(2),
    right
  )
  const { draw } = drawn(two)
  const moved = move(two, "left")
  draw(moved)
  expect(asked).toHaveLength(0)
  // A workspace that comes draws the numbers again, and one that goes on
  // screen too.
  const grown = open(fresh(moved), project, terminal(3), right)
  for (const state of [grown, go(grown, 0)]) {
    asked.length = 0
    draw(state)
    expect(asked).toContainEqual({ list: inBar(state), current: state.current })
  }
})
