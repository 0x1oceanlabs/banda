import { existsSync, readFileSync } from "node:fs"
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
      said: "1 at work",
    })
  })

  it("lights its hat and says how many wait while one asks, whoever works", () => {
    expect(lookOf(twoWorkingOneWaiting)).toEqual({
      sign: "asking",
      count: "1",
      said: "1 your turn",
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
      said: "1 your turn",
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
    expect(iconOf("rest", false, "darwin")).toEqual({
      file: "restTemplate.png",
      template: true,
    })
    expect(iconOf("working", true, "darwin")).toEqual({
      file: "workingTemplate.png",
      template: true,
    })
    expect(iconOf("asleep", false, "darwin").template).toBe(true)
    expect(iconOf("done", false, "darwin").template).toBe(true)
    expect(iconOf("asking", false, "darwin")).toEqual({
      file: "asking-light.png",
      template: false,
    })
    expect(iconOf("asking", true, "darwin")).toEqual({
      file: "asking-dark.png",
      template: false,
    })
    expect(rowIconOf("working", "darwin")?.template).toBe(true)
    for (const state of ["asking", "failed", "done"] as const)
      expect(rowIconOf(state, "darwin")).toEqual({
        file: `row-${state}.png`,
        template: false,
      })
  })

  it("has every icon it names drawn, at 1x and 2x (icons/menu-bar/draw.mjs)", () => {
    const signs: Sign[] = ["rest", "working", "asking", "done", "asleep"]
    const states: CountedAs[] = ["working", "asking", "failed", "done", "woke"]
    const files = [
      ...signs.flatMap((sign) => [
        iconOf(sign, false, "darwin"),
        iconOf(sign, true, "darwin"),
      ]),
      ...states.map((state) => rowIconOf(state, "darwin")),
    ].map((icon) => icon?.file ?? "")
    const drawn = join(import.meta.dirname, "../icons/menu-bar")
    for (const file of new Set(files))
      for (const one of [file, file.replace(/\.png$/, "@2x.png")])
        expect(existsSync(join(drawn, one)), one).toBe(true)
  })

  it("has every sign drawn for Linux and Windows, for a light bar and a dark one (icons/menu-bar/draw.mjs)", () => {
    const signs: Sign[] = ["rest", "working", "asking", "done", "asleep"]
    const drawn = join(import.meta.dirname, "../icons/menu-bar/tray")
    /** A PNG's width and height, read from its header. */
    const sizeOf = (png: Buffer) => {
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG")
      return [png.readUInt32BE(16), png.readUInt32BE(20)]
    }
    for (const sign of signs)
      for (const bar of ["light", "dark"]) {
        const name = join(drawn, `${sign}-${bar}`)
        expect(sizeOf(readFileSync(`${name}.png`)), name).toEqual([16, 16])
        expect(sizeOf(readFileSync(`${name}@2x.png`)), name).toEqual([32, 32])
        // The `.ico`: 6 bytes, an entry of 16 for each picture, the PNGs.
        const ico = readFileSync(`${name}.ico`)
        expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], name).toEqual([0, 1])
        const held = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
          const entry = 6 + 16 * index
          const at = ico.readUInt32LE(entry + 12)
          const png = ico.subarray(at, at + ico.readUInt32LE(entry + 8))
          expect(sizeOf(png), name).toEqual([ico[entry], ico[entry + 1]])
          return ico[entry]
        })
        expect(held, name).toEqual([16, 20, 24, 32])
      }
  })
})

describe("its menu", () => {
  const labels = (status: EngineStatus | null) =>
    menuOf(status, "Banda Dev", "0.4.0-dev.457", "darwin").map((item) =>
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
      "Your turn",
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
      "Your turn",
      "Run the tests (banda · Failed)",
    ])
  })

  it("each row names the Thread it opens, in its Project", () => {
    const row = menuOf(twoWorkingOneWaiting, "Banda Dev", "x", "darwin").find(
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
    expect(menuOf(woke, "Banda", "0.4.0", "darwin")[1]).toMatchObject({
      kind: "thread",
      sublabel: "banda · Woke",
    })
  })

  it("cuts a long title, so the menu stays narrow", () => {
    const long = "A".repeat(80)
    const [, row] = menuOf(
      running(thread(long, "banda", "working")),
      "Banda",
      "0.4.0",
      "darwin"
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
    menu.items(["Your turn", "Fix the login"])
    menu.items(["Your turn", "Fix the login", "Working", "Docs"])
    expect(set).toHaveLength(1)
    menu.closed()
    expect(set).toEqual([
      ["Working", "Fix the login"],
      ["Your turn", "Fix the login", "Working", "Docs"],
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

describe("on Linux and Windows (ADR 0136, proposed in #1871)", () => {
  const signs: Sign[] = ["rest", "working", "asking", "done", "asleep"]
  const labels = (status: EngineStatus | null, platform: NodeJS.Platform) =>
    menuOf(status, "Banda Dev", "0.4.0-dev.457", platform).map((item) =>
      item.kind === "separator" ? "—" : `${item.kind}: ${item.label}`
    )
  const twoWaitTwoWork = running(
    thread("Pricing page copy", "bandaso-site", "asking"),
    thread("Sidebar for arc", "banda", "done"),
    thread("Fix tile resize", "banda", "working"),
    thread("Release notes dev.459", "banda", "working")
  )

  it("Banda's icon is in the tray, as it is in macOS's menu bar, and nowhere else", () => {
    for (const platform of ["darwin", "linux", "win32"] as const)
      expect(hasMenuBar(platform, false), platform).toBe(true)
    expect(hasMenuBar("freebsd", false)).toBe(false)
  })

  it("a Linux window with no screen has none: GTK, which Electron falls back to with no tray host, ends the app there", () => {
    expect(hasMenuBar("linux", true)).toBe(false)
    // Only Linux has such a window.
    expect(hasMenuBar("darwin", true)).toBe(true)
    expect(hasMenuBar("win32", true)).toBe(true)
  })

  it("each sign is a picture in the bar's ink, a PNG on Linux and an .ico on Windows, never a template", () => {
    for (const sign of signs) {
      expect(iconOf(sign, false, "linux")).toEqual({
        file: `tray/${sign}-light.png`,
        template: false,
      })
      expect(iconOf(sign, true, "linux")).toEqual({
        file: `tray/${sign}-dark.png`,
        template: false,
      })
      expect(iconOf(sign, false, "win32")).toEqual({
        file: `tray/${sign}-light.ico`,
        template: false,
      })
      expect(iconOf(sign, true, "win32")).toEqual({
        file: `tray/${sign}-dark.ico`,
        template: false,
      })
    }
  })

  it("has every icon it names there drawn (icons/menu-bar/draw.mjs)", () => {
    const states: CountedAs[] = ["working", "asking", "failed", "done", "woke"]
    const drawn = join(import.meta.dirname, "../icons/menu-bar")
    for (const platform of ["linux", "win32"] as const) {
      const files = [
        ...signs.flatMap((sign) => [
          iconOf(sign, false, platform),
          iconOf(sign, true, platform),
        ]),
        ...states.map((state) => rowIconOf(state, platform)),
      ].flatMap((icon) => (icon ? [icon.file] : []))
      for (const file of files)
        expect(existsSync(join(drawn, file)), file).toBe(true)
    }
  })

  it("a row that works has no mark, as nothing there colours one as the menu is; the rest keep theirs", () => {
    for (const platform of ["linux", "win32"] as const) {
      expect(rowIconOf("working", platform)).toBeNull()
      for (const state of ["asking", "failed", "done", "woke"] as const)
        expect(rowIconOf(state, platform)).toEqual({
          file: `row-${state}.png`,
          template: false,
        })
    }
  })

  it("the number is in the words the tooltip says, the same as on macOS", () => {
    expect(lookOf(twoWaitTwoWork).said).toBe("2 your turn")
    expect(lookOf(oneWorking).said).toBe("1 at work")
    expect(lookOf(quiet).said).toBe("Nothing runs")
    expect(lookOf(null).said).toBe("Offline")
  })

  it("a heading is a line that cannot be picked, with its count, and a row is one line, its title and its state, with no Project", () => {
    for (const platform of ["linux", "win32"] as const) {
      expect(labels(twoWaitTwoWork, platform)).toEqual([
        "line: Your turn · 2",
        "thread: Pricing page copy · Asks you",
        "thread: Sidebar for arc · Done",
        "line: Working · 2",
        "thread: Fix tile resize · Working",
        "thread: Release notes dev.459 · Working",
        "—",
        "open: Open Banda",
        "—",
        "line: Banda Dev dev.458",
        "quit: Quit Banda",
      ])
      for (const item of menuOf(twoWaitTwoWork, "Banda", "x", platform))
        expect(item).not.toHaveProperty("sublabel")
    }
    expect(labels(failed, "linux").slice(0, 4)).toEqual([
      "line: Your turn · 1",
      "thread: Run the tests · Failed",
      "line: Working · 1",
      "thread: Fix tile resize · Working",
    ])
  })

  it("a row still names the Thread it opens, and cuts only its title", () => {
    const long = "A".repeat(80)
    const [, row] = menuOf(
      running(thread(long, "banda", "working")),
      "Banda",
      "0.4.0",
      "win32"
    )
    expect(row).toMatchObject({
      kind: "thread",
      label: `${"A".repeat(43)}… · Working`,
      project: "p-banda",
      thread: `t-${long}`,
      title: long,
    })
  })

  it("says nothing runs, and that the engine does not answer, as on macOS", () => {
    expect(labels(quiet, "linux").slice(0, 2)).toEqual([
      "line: Nothing runs",
      "—",
    ])
    expect(labels(null, "win32").slice(0, 2)).toEqual([
      "line: Banda's engine does not answer",
      "—",
    ])
  })
})
