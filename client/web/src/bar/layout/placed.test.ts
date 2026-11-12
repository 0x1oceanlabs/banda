import { describe, expect, it } from "vitest"
import { DEFAULT_BAR } from "@banda/contract/look"
import { type Known, placed } from "./placed"

/** The Bar's own widgets that stand last on the right when no part lists
 * them. */
const OWN = ["window.update", "window.problems", "window.connection"]

const known =
  (theirs: Record<string, Known>) =>
  (id: string): Known =>
    theirs[id]

describe("the bar's widgets", () => {
  it("stand in each part in the look's order, each once", () => {
    const { parts, problems } = placed(
      {
        ...DEFAULT_BAR,
        center: ["sidebar.counts"],
        right: ["git.branch", "harnesses.limits", "git.branch"],
      },
      known({
        "window.flow": "shown",
        "sidebar.counts": "shown",
        "git.branch": "shown",
        "harnesses.limits": "shown",
      })
    )
    expect(parts).toEqual({
      left: ["workspaces.list", "window.flow"],
      center: ["sidebar.counts"],
      right: ["git.branch", "harnesses.limits", ...OWN],
    })
    expect(problems).toEqual([])
  })

  it("leave out one whose module does not run, saying nothing", () => {
    const { parts, problems } = placed(
      {
        ...DEFAULT_BAR,
        center: [],
        right: ["harnesses.limits", "workspaces.aside"],
      },
      known({
        "window.flow": "shown",
        "harnesses.limits": "off",
        "workspaces.aside": "shown",
      })
    )
    expect(parts.right).toEqual(["workspaces.aside", ...OWN])
    expect(problems).toEqual([])
  })

  it("name an id no module has at its line, as keys.toml's are", () => {
    const { parts, problems } = placed(
      { ...DEFAULT_BAR, center: [], right: ["git.brnch"] },
      known({ "window.flow": "shown" }),
      {
        "bar.right": {
          value: ["git.brnch"],
          from: {
            layer: "file",
            path: "/home/me/.config/banda/look.toml",
            line: 3,
          },
        },
      }
    )
    expect(parts.right).toEqual(OWN)
    expect(problems).toEqual([
      {
        path: "/home/me/.config/banda/look.toml",
        line: 3,
        key: "bar.right",
        message: 'bar.right names "git.brnch", and no module has that widget',
      },
    ])
  })

  it("keep the workspaces, first on the left when no part lists them", () => {
    const listed = placed(
      { ...DEFAULT_BAR, left: [], center: ["workspaces.list"], right: [] },
      known({})
    )
    expect(listed.parts.center).toEqual(["workspaces.list"])
    expect(listed.parts.left).toEqual([])
    const unlisted = placed(
      { ...DEFAULT_BAR, left: ["harnesses.limits"], right: [] },
      known({ "harnesses.limits": "shown", "sidebar.counts": "shown" })
    )
    expect(unlisted.parts.left).toEqual(["workspaces.list", "harnesses.limits"])
    expect(unlisted.problems).toEqual([])
  })

  it("keep the update, the look's problems and the connection, last on the right when no part lists them, where a part does lists them", () => {
    // Banda's right lists them last.
    expect(DEFAULT_BAR.right.slice(-3)).toEqual(OWN)
    expect(placed(DEFAULT_BAR, known({})).parts.right.slice(-3)).toEqual(OWN)
    // A right of the Person's own, written before they were widgets, hides
    // none of them.
    const theirs = placed(
      { ...DEFAULT_BAR, right: ["harnesses.limits"] },
      known({ "window.flow": "shown", "harnesses.limits": "shown" })
    )
    expect(theirs.parts.right).toEqual(["harnesses.limits", ...OWN])
    expect(theirs.problems).toEqual([])
    // Listed, one stands where its part says, and only there.
    const moved = placed(
      { ...DEFAULT_BAR, left: ["window.connection"], right: ["window.update"] },
      known({})
    )
    expect(moved.parts.left).toEqual(["workspaces.list", "window.connection"])
    expect(moved.parts.right).toEqual(["window.update", "window.problems"])
  })

  it("show the Flow after the workspaces, as Banda's left lists it, and not where a left of the Person's own leaves it out", () => {
    const flow = known({ "window.flow": "shown" })
    const left = { ...DEFAULT_BAR, center: [], right: [] }
    expect(DEFAULT_BAR.left).toEqual(["workspaces.list", "window.flow"])
    expect(placed(left, flow).parts.left).toEqual([
      "workspaces.list",
      "window.flow",
    ])
    // A left written before the Flow came replaces Banda's whole (ADR
    // 0098, decision 20): Alt+Shift+M still reaches it.
    const theirs = placed({ ...left, left: ["workspaces.list"] }, flow)
    expect(theirs.parts.left).toEqual(["workspaces.list"])
    expect(theirs.problems).toEqual([])
  })
})
