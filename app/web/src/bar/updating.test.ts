import { describe, expect, it } from "vitest"
import type { Update } from "../host"
import { lineOf, shortOf, workingWords } from "./updating"

const known = { name: "Banda Dev", have: "0.1.0-dev.62" }

describe("the update's line on hover", () => {
  it("says what downloads, how far, and what is ready", () => {
    const downloading: Update = {
      ...known,
      state: "downloading",
      version: "0.1.0-dev.66",
      share: 0.384,
    }
    expect(lineOf(downloading)).toBe("Downloading Banda Dev 0.1.0-dev.66 · 38%")
    expect(
      lineOf({ ...known, state: "ready", version: "0.1.0-dev.66", notes: [] })
    ).toBe(
      "Banda Dev 0.1.0-dev.66 is ready: it installs when you quit Banda Dev"
    )
    expect(
      lineOf({ ...known, state: "failed", reason: "Banda cannot write /opt" })
    ).toBe("Banda Dev cannot update itself: Banda cannot write /opt")
  })
})

it("names a Dev by its number and a Stable whole", () => {
  expect(shortOf("0.1.0-dev.66")).toBe("dev.66")
  expect(shortOf("0.2.0")).toBe("0.2.0")
})

it("warns only while Threads work", () => {
  expect(workingWords(0)).toBeUndefined()
  expect(workingWords(1)).toBe("A Thread works: a restart stops its turn.")
  expect(workingWords(3)).toBe("3 Threads work: a restart stops their turns.")
})
