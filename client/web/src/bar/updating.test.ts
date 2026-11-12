import { describe, expect, it } from "vitest"
import type { Update } from "@banda/core"
import {
  firstOf,
  groupsOf,
  lineOf,
  lookedWords,
  pillOf,
  shortOf,
  sizeWords,
  versionsWords,
} from "./updating"

const known = { name: "Banda Dev", have: "0.1.0-dev.62", always: true }

describe("the update's line on hover, which says what a click does", () => {
  it("on macOS, says what is out", () => {
    const out: Update = {
      ...known,
      state: "out",
      version: "0.1.0-dev.66",
      notes: [],
      command: "brew update && brew upgrade --cask banda-dev",
    }
    expect(lineOf(out)).toBe("dev.66 is out · install it with brew")
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
    expect(lineOf(downloading)).toBe("Downloading dev.66 · 38%")
    const ready: Update = {
      ...known,
      state: "ready",
      version: "0.1.0-dev.66",
      notes: [],
    }
    expect(lineOf(ready)).toBe("dev.66 is ready · click to restart")
    expect(
      lineOf({ ...known, state: "failed", reason: "Banda cannot write /opt" })
    ).toBe("Banda Dev cannot update itself: Banda cannot write /opt")
  })

  it("says the new Banda updated (ADR 0072)", () => {
    expect(
      lineOf({
        ...known,
        have: "0.1.0-dev.66",
        state: "updated",
        from: "0.1.0-dev.62",
        notes: [],
      })
    ).toBe("Updated to dev.66")
  })
})

it("names the version beside the icon only once one is there (ADR 0072)", () => {
  expect(
    pillOf({
      ...known,
      state: "ready",
      version: "0.1.0-dev.66",
      notes: [],
    })
  ).toBe("dev.66")
  expect(
    pillOf({
      ...known,
      state: "downloading",
      version: "0.1.0-dev.66",
      share: 0.5,
      notes: [],
      restarts: false,
    })
  ).toBeUndefined()
  expect(pillOf({ ...known, state: "none" })).toBeUndefined()
})

it("names a Dev by its number and a Stable whole", () => {
  expect(shortOf("0.1.0-dev.66")).toBe("dev.66")
  expect(shortOf("0.2.0")).toBe("0.2.0")
})

it("says how many versions lie between, when several do", () => {
  const note = { version: "0.1.0-dev.66", text: "x" }
  expect(versionsWords([note])).toBeUndefined()
  expect(versionsWords([note, note, note])).toBe("3 versions newer")
})

it("says how much is down, when electron-updater says", () => {
  const downloading = {
    ...known,
    state: "downloading" as const,
    version: "0.1.0-dev.66",
    share: 0.38,
    notes: [],
    restarts: false,
  }
  expect(sizeWords(downloading)).toBeUndefined()
  expect(
    sizeWords({ ...downloading, down: 11_800_000, size: 31_000_000 })
  ).toBe("12 of 31 MB")
  expect(sizeWords({ ...downloading, down: 1_200_000, size: 4_000_000 })).toBe(
    "1.2 of 4.0 MB"
  )
})

describe("what changed, by kind (ADR 0072, decision 5)", () => {
  const notes = [
    {
      version: "0.1.0-dev.66",
      text: "Built from 6e9145f: feat(window): every key is named as it is pressed",
    },
    { version: "0.1.0-dev.65", text: "Built from 1ceb27c: fix(usage): ×2" },
    { version: "0.1.0-dev.64", text: "Built from 3e145b7: chore: bump" },
    { version: "0.1.0-dev.63", text: "Built from 9a1b2c3: the README" },
    { version: "0.2.0", text: "Note: a Stable's own words" },
  ]

  it("groups a Dev's commit titles into New, Fixed and Other", () => {
    expect(groupsOf(notes)).toEqual([
      {
        title: "New",
        lines: [
          {
            version: "0.1.0-dev.66",
            scope: "window",
            text: "every key is named as it is pressed",
          },
        ],
      },
      {
        title: "Fixed",
        lines: [{ version: "0.1.0-dev.65", scope: "usage", text: "×2" }],
      },
      {
        title: "Other",
        lines: [
          { version: "0.1.0-dev.64", scope: undefined, text: "bump" },
          { version: "0.1.0-dev.63", scope: undefined, text: "the README" },
          {
            version: "0.2.0",
            scope: undefined,
            text: "Note: a Stable's own words",
          },
        ],
      },
    ])
  })

  it("lists the first few, in order", () => {
    expect(
      firstOf(groupsOf(notes), 2).map((group) => [
        group.title,
        group.lines.length,
      ])
    ).toEqual([
      ["New", 1],
      ["Fixed", 1],
    ])
  })
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
    ).toBe("You have the newest · looked 4m ago")
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
})
