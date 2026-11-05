import { describe, expect, it } from "vitest"
import { DEFAULT_BAR } from "@banda/contract/look"
import { type Known, placed } from "./placed"

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
        "sidebar.counts": "shown",
        "git.branch": "shown",
        "harnesses.limits": "shown",
      })
    )
    expect(parts).toEqual({
      left: ["workspaces.list"],
      center: ["sidebar.counts"],
      right: ["git.branch", "harnesses.limits"],
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
      known({ "harnesses.limits": "off", "workspaces.aside": "shown" })
    )
    expect(parts.right).toEqual(["workspaces.aside"])
    expect(problems).toEqual([])
  })

  it("name an id no module has at its line, as keys.toml's are", () => {
    const { parts, problems } = placed(
      { ...DEFAULT_BAR, center: [], right: ["git.brnch"] },
      known({}),
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
    expect(parts.right).toEqual([])
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
})
