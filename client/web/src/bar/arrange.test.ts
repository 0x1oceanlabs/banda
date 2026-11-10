import { describe, expect, it } from "vitest"
import { moved, same, written } from "./arrange"

const shown = {
  left: ["workspaces.list", "window.flow"],
  center: ["sidebar.counts"],
  right: ["terminal.ports", "harnesses.limits"],
}

describe("a widget moved with Alt", () => {
  it("goes to its part, among the others", () => {
    expect(moved(shown, "harnesses.limits", "left", 0)).toEqual({
      left: ["harnesses.limits", "workspaces.list", "window.flow"],
      center: ["sidebar.counts"],
      right: ["terminal.ports"],
    })
    expect(moved(shown, "terminal.ports", "right", 9).right).toEqual([
      "harnesses.limits",
      "terminal.ports",
    ])
  })

  it("put back where it was changes nothing", () => {
    expect(same(moved(shown, "terminal.ports", "right", 0), shown)).toBe(true)
    expect(same(moved(shown, "terminal.ports", "center", 0), shown)).toBe(false)
  })

  it("writes the shown order, and keeps the ids the bar did not show", () => {
    // The bar draws the workspaces first on the left, though its left
    // names only the Flow.
    const bar = {
      left: ["window.flow"],
      center: ["sidebar.counts"],
      right: ["terminal.ports", "git.branch", "harnesses.limits"],
    }
    const after = moved(shown, "workspaces.list", "center", 1)
    expect(written(bar, shown, after)).toEqual({
      left: ["window.flow"],
      center: ["sidebar.counts", "workspaces.list"],
      right: ["terminal.ports", "harnesses.limits", "git.branch"],
    })
  })

  it("moves the Flow as any other, from Banda's place after the workspaces", () => {
    // Banda's own [bar] stands as it is shown (ADR 0098, decision 20).
    const before = moved(shown, "window.flow", "left", 0)
    expect(written(shown, shown, before).left).toEqual([
      "window.flow",
      "workspaces.list",
    ])
    const middle = moved(shown, "window.flow", "center", 0)
    expect(written(shown, shown, middle)).toEqual({
      left: ["workspaces.list"],
      center: ["window.flow", "sidebar.counts"],
      right: ["terminal.ports", "harnesses.limits"],
    })
  })
})
