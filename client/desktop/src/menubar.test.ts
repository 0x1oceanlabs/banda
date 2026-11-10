import { existsSync } from "node:fs"
import { join } from "node:path"
import type { EngineStatus } from "@banda/contract"
import type { CountedAs, CountedThread } from "@banda/contract/agents"
import { describe, expect, it } from "vitest"
import {
  hasMenuBar,
  iconOf,
  lookOf,
  menuOf,
  menuSetter,
  rowIconOf,
  shortOf,
  type Sign,
  statusOf,
} from "./menubar"

/** A Thread as `banda status` lists it. */
const thread = (
  title: string,
  project_name: string,
  state: CountedAs
): CountedThread => ({
  thread: `t-${title}`,
  title,
  project: `p-${project_name}`,
  project_name,
  state,
})

/** A running engine's line with `threads`, counted as the bar counts. */
const running = (...threads: CountedThread[]): EngineStatus => {
  const of = (state: CountedAs) =>
    threads.filter((one) => one.state === state).length
  const asking = of("asking") + of("failed")
  return {
    running: true,
    version: "0.4.0-dev.458",
    agents: {
      working: of("working"),
      asking,
      failed: of("failed"),
      done: of("done"),
      waiting: asking + of("done") + of("woke"),
      threads,
    },
  }
}

// The mock's states (mac-menubar-v1, frames 1 and 2).
const quiet = running()
const oneWorking = running(thread("Fix tile resize", "banda", "working"))
const twoWorkingOneWaiting = running(
  thread("Pricing page copy", "bandaso-site", "asking"),
  thread("Fix tile resize", "banda", "working"),
  thread("Release notes dev.459", "banda", "working")
)
const failed = running(
  thread("Run the tests", "banda", "failed"),
  thread("Fix tile resize", "banda", "working")
)
const notRunning: EngineStatus = { running: false }

describe("the menu bar icon (ADR 0086, decision 4)", () => {
  it("is the mark at rest with no number while nobody works", () => {
    expect(lookOf(quiet)).toEqual({
      sign: "rest",
      count: "",
      said: "Nothing runs",
    })
  })

  it("has a round hat and how many work while Agents work", () => {
    expect(lookOf(oneWorking)).toEqual({
      sign: "working",
      count: "1",
      said: "1 working",
    })
  })

  it("lights its hat and says how many wait while one asks, whoever works", () => {
    expect(lookOf(twoWorkingOneWaiting)).toEqual({
      sign: "asking",
      count: "1",
      said: "1 wait for you",
    })
    // One asks, one is done: two wait, lit while one asks (frame 1).
    const asksAndDone = running(
      thread("Pricing page copy", "bandaso-site", "asking"),
      thread("Sidebar for arc", "banda", "done")
    )
    expect(lookOf(asksAndDone)).toMatchObject({ sign: "asking", count: "2" })
  })

  it("is lit for a failure too, and only done waits unlit", () => {
    expect(lookOf(failed)).toMatchObject({ sign: "asking", count: "1" })
    const done = running(thread("Sidebar for arc", "banda", "done"))
    expect(lookOf(done)).toEqual({
      sign: "done",
      count: "1",
      said: "1 wait for you",
    })
  })

  it("sleeps, dimmed, while the engine does not run or no line came", () => {
    const asleep = { sign: "asleep", count: "", said: "Offline" }
    expect(lookOf(notRunning)).toEqual(asleep)
    expect(lookOf(null)).toEqual(asleep)
  })

  it("says no number where the engine's list could not be read", () => {
    expect(lookOf({ running: true })).toMatchObject({ sign: "rest" })
  })

  it("is a template where it is one colour, in colour only where it asks", () => {
    expect(iconOf("rest", false)).toEqual({
      file: "restTemplate.png",
      template: true,
    })
    expect(iconOf("working", true)).toEqual({
      file: "workingTemplate.png",
      template: true,
    })
    expect(iconOf("asleep", false).template).toBe(true)
    expect(iconOf("done", false).template).toBe(true)
    expect(iconOf("asking", false)).toEqual({
      file: "asking-light.png",
      template: false,
    })
    expect(iconOf("asking", true)).toEqual({
      file: "asking-dark.png",
      template: false,
    })
    expect(rowIconOf("working").template).toBe(true)
    for (const state of ["asking", "failed", "done"] as const)
      expect(rowIconOf(state)).toEqual({
        file: `row-${state}.png`,
        template: false,
      })
  })

  it("has every icon it names drawn, at 1x and 2x (icons/menu-bar/draw.mjs)", () => {
    const signs: Sign[] = ["rest", "working", "asking", "done", "asleep"]
    const states: CountedAs[] = ["working", "asking", "failed", "done", "woke"]
    const files = [
      ...signs.flatMap((sign) => [iconOf(sign, false), iconOf(sign, true)]),
      ...states.map(rowIconOf),
    ].map((icon) => icon.file)
    const drawn = join(import.meta.dirname, "../icons/menu-bar")
    for (const file of new Set(files))
      for (const one of [file, file.replace(/\.png$/, "@2x.png")])
        expect(existsSync(join(drawn, one)), one).toBe(true)
  })
})

describe("its menu", () => {
  const labels = (status: EngineStatus | null) =>
    menuOf(status, "Banda Dev", "0.4.0-dev.457").map((item) =>
      item.kind === "separator"
        ? "—"
        : item.kind === "thread"
          ? `${item.label} (${item.sublabel})`
          : item.label
    )

  it("says nothing runs, then Open Banda, the version and Quit Banda", () => {
    expect(labels(quiet)).toEqual([
      "Nothing runs",
      "—",
      "Open Banda",
      "—",
      "Banda Dev dev.458",
      "Quit Banda",
    ])
  })

  it("lists who waits first, then who works, each under its heading", () => {
    expect(labels(twoWorkingOneWaiting)).toEqual([
      "Wait for you",
      "Pricing page copy (bandaso-site · Asks you)",
      "Working",
      "Fix tile resize (banda · Working)",
      "Release notes dev.459 (banda · Working)",
      "—",
      "Open Banda",
      "—",
      "Banda Dev dev.458",
      "Quit Banda",
    ])
    expect(labels(oneWorking).slice(0, 2)).toEqual([
      "Working",
      "Fix tile resize (banda · Working)",
    ])
    expect(labels(failed).slice(0, 2)).toEqual([
      "Wait for you",
      "Run the tests (banda · Failed)",
    ])
  })

  it("each row names the Thread it opens, in its Project", () => {
    const row = menuOf(twoWorkingOneWaiting, "Banda Dev", "x").find(
      (item) => item.kind === "thread"
    )
    expect(row).toMatchObject({
      project: "p-bandaso-site",
      thread: "t-Pricing page copy",
      title: "Pricing page copy",
      state: "asking",
    })
  })

  it("lists one that woke from Later with those that wait, and counts it", () => {
    const woke = running(thread("Renew the certs", "banda", "woke"))
    expect(lookOf(woke)).toMatchObject({ count: "1" })
    expect(menuOf(woke, "Banda", "0.4.0")[1]).toMatchObject({
      kind: "thread",
      sublabel: "banda · Woke",
    })
  })

  it("cuts a long title, so the menu stays narrow", () => {
    const long = "A".repeat(80)
    const [, row] = menuOf(
      running(thread(long, "banda", "working")),
      "Banda",
      "0.4.0"
    )
    expect(row).toMatchObject({ kind: "thread", title: long })
    expect(row?.kind === "thread" && row.label).toBe(`${"A".repeat(43)}…`)
  })

  it("says the engine does not answer, and the app's own version, while it does not run", () => {
    for (const status of [notRunning, null])
      expect(labels(status)).toEqual([
        "Banda's engine does not answer",
        "—",
        "Open Banda",
        "—",
        "Banda Dev dev.457",
        "Quit Banda",
      ])
  })

  it("lists nobody where the engine's list could not be read, and never says nothing runs", () => {
    expect(labels({ running: true, version: "0.4.0" })).toEqual([
      "Open Banda",
      "—",
      "Banda Dev 0.4.0",
      "Quit Banda",
    ])
  })

  it("names a Dev by its number, a Stable whole", () => {
    expect(shortOf("0.4.0-dev.458")).toBe("dev.458")
    expect(shortOf("0.4.0")).toBe("0.4.0")
  })
})

describe("setting its menu", () => {
  it("sets it as its items change, and the same items again set nothing", () => {
    const set: string[][] = []
    const menu = menuSetter((items: string[]) => set.push(items))
    menu.items(["Nothing runs"])
    menu.items(["Nothing runs"])
    menu.items(["Working", "Fix the login"])
    expect(set).toEqual([["Nothing runs"], ["Working", "Fix the login"]])
  })

  it("never while it is open, as that closes it: the last items come as it closes", () => {
    const set: string[][] = []
    const menu = menuSetter((items: string[]) => set.push(items))
    menu.items(["Working", "Fix the login"])
    menu.opened()
    menu.items(["Wait for you", "Fix the login"])
    menu.items(["Wait for you", "Fix the login", "Working", "Docs"])
    expect(set).toHaveLength(1)
    menu.closed()
    expect(set).toEqual([
      ["Working", "Fix the login"],
      ["Wait for you", "Fix the login", "Working", "Docs"],
    ])
    // Opened and closed with nothing new: nothing is set.
    menu.opened()
    menu.closed()
    expect(set).toHaveLength(2)
  })

  it("sets nothing as it closes where the items came back to what it shows", () => {
    const set: string[][] = []
    const menu = menuSetter((items: string[]) => set.push(items))
    menu.items(["Nothing runs"])
    menu.opened()
    menu.items(["Working", "Fix the login"])
    menu.items(["Nothing runs"])
    menu.closed()
    expect(set).toEqual([["Nothing runs"]])
  })
})

describe("what it reads", () => {
  it("takes a line of banda status as the status it says, and nothing else", () => {
    expect(statusOf('{"running":false,"system":"macOS 26.1"}')).toEqual({
      running: false,
      system: "macOS 26.1",
    })
    expect(statusOf(JSON.stringify(quiet))).toEqual(quiet)
    for (const line of ["", "banda: no", "[]", "null", '{"running":"yes"}'])
      expect(statusOf(line)).toBeNull()
  })
})

describe("on Linux and Windows, as before", () => {
  it("Banda has no menu bar icon: macOS alone has one in this step", () => {
    expect(hasMenuBar("darwin")).toBe(true)
    expect(hasMenuBar("linux")).toBe(false)
    expect(hasMenuBar("win32")).toBe(false)
  })
})
