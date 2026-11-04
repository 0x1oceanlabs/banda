import { describe, expect, it } from "vitest"
import type { Update } from "../host"
import {
  downloadWords,
  lineOf,
  lookedWords,
  shortOf,
  workingWords,
} from "./updating"

const known = { name: "Banda Dev", have: "0.1.0-dev.62", always: true }

describe("the update's line on hover", () => {
  it("on macOS, says what is out and the command that installs it", () => {
    const out: Update = {
      ...known,
      state: "out",
      version: "0.1.0-dev.66",
      notes: [],
      command: "brew update && brew upgrade --cask banda-dev",
    }
    expect(lineOf(out)).toBe(
      "Banda Dev 0.1.0-dev.66 is out: brew update && brew upgrade --cask banda-dev"
    )
  })

  it("says what downloads, how far, and what is ready", () => {
    const downloading: Update = {
      ...known,
      state: "downloading",
      version: "0.1.0-dev.66",
      share: 0.384,
      notes: [],
      restarts: false,
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

describe("Banda Dev's widget with nothing new (ADR 0045)", () => {
  const at = Date.UTC(2026, 10, 3, 22, 0)
  it("names the version that runs, and what a look found", () => {
    expect(lineOf({ ...known, state: "none" })).toBe("Banda Dev 0.1.0-dev.62")
    expect(lineOf({ ...known, state: "looking" })).toBe(
      "Looking for a new Banda Dev…"
    )
    expect(lookedWords({ ...known, state: "none" }, at)).toBe(
      "Banda Dev looks every hour, and when you ask"
    )
    expect(
      lookedWords({ ...known, state: "none", looked: at - 4 * 60_000 }, at)
    ).toBe("You have the newest Banda Dev · looked 4m ago")
    expect(
      lookedWords(
        {
          ...known,
          state: "none",
          looked: at,
          missed: "net::ERR_INTERNET_DISCONNECTED",
        },
        at
      )
    ).toBe("Could not update: net::ERR_INTERNET_DISCONNECTED")
  })

  it("says whether a download restarts Banda or waits for the quit", () => {
    const downloading = {
      ...known,
      state: "downloading" as const,
      version: "0.1.0-dev.66",
      share: 0.38,
      notes: [],
    }
    expect(downloadWords({ ...downloading, restarts: true })).toBe(
      "Downloading · 38% · restarts when it is down"
    )
    expect(downloadWords({ ...downloading, restarts: false })).toBe(
      "Downloading · 38% · installs when you quit Banda Dev"
    )
  })
})
