// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest"
import { focusedTile } from "./pane"

afterEach(() => {
  document.body.replaceChildren()
})

/** A workspace of tiles, `inert` when it is out of view, as the window
 * draws them (Workspaces.tsx). */
function workspace(live: boolean, ...tiles: [id: string, focused: boolean][]) {
  const group = document.body.appendChild(document.createElement("div"))
  group.inert = !live
  for (const [id, focused] of tiles) {
    const tile = group.appendChild(document.createElement("section"))
    tile.dataset.tile = id
    tile.dataset.focused = String(focused)
  }
}

test("the focused tile is the live workspace's, though a workspace out of view comes first and keeps one", () => {
  workspace(false, ["a", false], ["b", true])
  workspace(true, ["c", false], ["d", true])
  expect(focusedTile()?.dataset.tile).toBe("d")
})

test("no live workspace's tile is focused: none, not one the focus cannot go to", () => {
  workspace(false, ["b", true])
  expect(focusedTile()).toBeNull()
})

test("while the Sheet shows, it is the Sheet", () => {
  workspace(true, ["d", true])
  const sheet = document.body.appendChild(document.createElement("div"))
  sheet.dataset.sheet = ""
  expect(focusedTile()).toBe(sheet)
})
