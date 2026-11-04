import { describe, expect, it } from "vitest"
import type { SpaceId, SpaceSummary } from "@banda/contract"
import { lookInto } from "./look"

const space = (id: string, folder: string, missing = false): SpaceSummary => ({
  id: id as SpaceId,
  name: id,
  folder,
  pinned: false,
  archived: false,
  sees_others: false,
  scratch: false,
  missing,
})

describe("looking into a Problem", () => {
  const spaces = [
    space("work", "/home/p/work"),
    space("banda", "/home/p/code/banda"),
  ]

  it("asks to read it and follow the skill's topic, in the home Space", () => {
    expect(lookInto("3124d1bf35ad", null, spaces)).toEqual({
      ask: "Look into Banda's Problem 3124d1bf35ad: read it with the `problem` tool, and follow the Banda skill's `problems` topic.",
    })
  })

  it("opens in the Space of the checkout Banda runs from", () => {
    expect(lookInto("3124", "/home/p/code/banda", spaces).space).toBe("banda")
  })

  it("opens in the home Space when no Space is the checkout's, or its folder is gone", () => {
    expect(lookInto("3124", "/home/p/code/other", spaces).space).toBeUndefined()
    const gone = [space("banda", "/home/p/code/banda", true)]
    expect(lookInto("3124", "/home/p/code/banda", gone).space).toBeUndefined()
  })
})
