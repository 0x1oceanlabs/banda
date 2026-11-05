import { describe, expect, it } from "vitest"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { lookInto } from "./look"

const project = (
  id: string,
  folder: string,
  missing = false
): ProjectSummary => ({
  id: id as ProjectId,
  name: id,
  folder,
  pinned: false,
  archived: false,
  sees_others: false,
  scratch: false,
  missing,
})

describe("looking into a Problem", () => {
  const projects = [
    project("work", "/home/p/work"),
    project("banda", "/home/p/code/banda"),
  ]

  it("asks to read it and follow the skill's topic, in the home Project", () => {
    expect(lookInto("3124d1bf35ad", null, projects)).toEqual({
      ask: "Look into Banda's Problem 3124d1bf35ad: read it with the `problem` tool, and follow the Banda skill's `problems` topic.",
    })
  })

  it("opens in the Project of the checkout Banda runs from", () => {
    expect(lookInto("3124", "/home/p/code/banda", projects).project).toBe(
      "banda"
    )
  })

  it("opens in the home Project when no Project is the checkout's, or its folder is gone", () => {
    expect(
      lookInto("3124", "/home/p/code/other", projects).project
    ).toBeUndefined()
    const gone = [project("banda", "/home/p/code/banda", true)]
    expect(lookInto("3124", "/home/p/code/banda", gone).project).toBeUndefined()
  })
})
