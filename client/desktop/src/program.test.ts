import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import {
  CARRIED,
  ELECTRON,
  NODE_FOLDER,
  ownCopy,
  PAGE_FOLDER,
  Program,
  programsOf,
  prune,
  pruneAside,
  renaming,
  runningPrograms,
  UPDATER,
  type Where,
  whereOf,
} from "./program"
import { script } from "./testing"

/** A fresh folder, by its real path: macOS's tmpdir is a link. */
const folder = (name: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), `banda-${name}-`)))

/** A `banda` whose `--version` says `line`, and, run from a folder a copy
 * is made in (its name starts with a dot), what `copied` says. */
function banda(line: string, copied = `echo '${line}'`): string {
  return script(
    `case "$0" in */.*/banda) ${copied} ;; *) echo '${line}' ;; esac`
  )
}

/** What `folder` holds, the copies made in it as they are left. */
const listed = (folder: string) => readdirSync(folder).sort()

const copyOf = (program: string, into: string) =>
  ownCopy(program, into).pipe(Effect.provide(NodeServices.layer))

describe("where the window's banda is", () => {
  const data = "/home/p/.local/share/banda"

  it("a trial's runs where it names it, a checkout's where cargo built it", () => {
    const checkout = "/src/banda/target/debug/banda"
    expect(
      whereOf({ named: "/trial/bin/banda", checkout, resources: "/r", data })
    ).toEqual({ program: "/trial/bin/banda" })
    expect(
      whereOf({ named: undefined, checkout, resources: undefined, data })
    ).toEqual({ program: checkout })
  })

  it("a packed one runs from a copy in the data folder", () => {
    const resources = folder("resources")
    expect(
      whereOf({ named: undefined, checkout: "/c", resources, data })
    ).toEqual({
      program: join(resources, "banda"),
      copies: join(data, "engine"),
    })
  })

  it("one a package manager owns runs where it put it", () => {
    const resources = folder("resources")
    writeFileSync(join(resources, "package-type"), "pacman\n")
    expect(
      whereOf({ named: undefined, checkout: "/c", resources, data })
    ).toEqual({ program: join(resources, "banda") })
  })
})

describe("the copy", () => {
  it.live("is put in place, beside what its --version said", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const line = "banda 1.2.3 (build aa)"
      const copy = yield* copyOf(banda(line), copies)
      expect(copy).toBe(join(copies, "1.2.3", "banda"))
      expect(readFileSync(join(copies, "1.2.3", "version"), "utf8")).toBe(
        `${line}\n`
      )
      accessSync(copy, constants.X_OK)
      expect(listed(copies)).toEqual(["1.2.3"])
    })
  )

  it.live("of the same build is run again, not made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const first = yield* copyOf(program, copies)
      const made = statSync(first).ino
      const again = yield* copyOf(program, copies)
      expect(again).toBe(first)
      expect(statSync(again).ino).toBe(made)
    })
  )

  it.live("in place, but cut short or gone, is made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const copy = yield* copyOf(program, copies)
      truncateSync(copy, 10)
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(copy)).toEqual(readFileSync(program))
      rmSync(copy)
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(copy)).toEqual(readFileSync(program))
    })
  )

  it.live("in place, whole but not starting, is made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const copy = yield* copyOf(program, copies)
      const size = statSync(copy).size
      writeFileSync(copy, "#!/bin/sh\nexit 4\n".padEnd(size, "#"))
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(copy)).toEqual(readFileSync(program))
    })
  )

  it.live(
    "of another build of the same version takes the place of the last",
    () =>
      Effect.gen(function* () {
        const copies = join(folder("data"), "engine")
        yield* copyOf(banda("banda 1.2.3 (build aa)"), copies)
        const copy = yield* copyOf(banda("banda 1.2.3 (build bb)"), copies)
        expect(readFileSync(join(copies, "1.2.3", "version"), "utf8")).toBe(
          "banda 1.2.3 (build bb)\n"
        )
        expect(copy).toBe(join(copies, "1.2.3", "banda"))
        // The last is moved aside, and goes as an old copy does.
        expect(listed(copies)).toHaveLength(2)
        prune(copies, join(copies, "1.2.3"), [])
        expect(listed(copies)).toEqual(["1.2.3"])
      })
  )

  it.live("that does not start is never put in place, nor left", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const failed = yield* Effect.flip(
        copyOf(banda("banda 1.2.3 (build aa)", "exit 3"), copies)
      )
      expect(failed.message).toContain("ended with code 3")
      expect(listed(copies)).toEqual([])
    })
  )

  it.live("that says another build is never put in place", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const failed = yield* Effect.flip(
        copyOf(
          banda("banda 1.2.3 (build aa)", "echo 'banda 1.2.3 (build bb)'"),
          copies
        )
      )
      expect(failed.message).toBe(
        'its copy said "banda 1.2.3 (build bb)", not "banda 1.2.3 (build aa)"'
      )
      expect(listed(copies)).toEqual([])
    })
  )

  it.live("is not made of a program that says no version", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const failed = yield* Effect.flip(copyOf(banda("hello"), copies))
      expect(failed.message).toContain('--version said "hello"')
      expect(existsSync(copies)).toBe(false)
    })
  )

  it.live("takes the program's line tables when they lie beside it", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const tables = join(`${program}.dSYM`, "Contents", "Resources")
      mkdirSync(tables, { recursive: true })
      writeFileSync(join(tables, "DWARF"), "lines")
      yield* copyOf(program, copies)
      expect(
        readFileSync(
          join(copies, "1.2.3", "banda.dSYM", "Contents", "Resources", "DWARF"),
          "utf8"
        )
      ).toBe("lines")
    })
  )

  it.live("takes a Windows program's line tables, its .pdb", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      writeFileSync(`${program}.pdb`, "lines")
      yield* copyOf(program, copies)
      expect(readFileSync(join(copies, "1.2.3", "banda.pdb"), "utf8")).toBe(
        "lines"
      )
    })
  )
})

describe("the copy and the adapters the app carries", () => {
  /** `adapters/` beside `program`, holding one adapter that says `text`. */
  function carried(program: string, text: string) {
    const adapters = join(dirname(program), CARRIED)
    mkdirSync(adapters, { recursive: true })
    writeFileSync(join(adapters, "claude-agent-acp.mjs"), text)
  }

  it.live("takes them, so the engine finds them beside it", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      carried(program, "// the adapter")
      const copy = yield* copyOf(program, copies)
      expect(
        readFileSync(
          join(dirname(copy), CARRIED, "claude-agent-acp.mjs"),
          "utf8"
        )
      ).toBe("// the adapter")
    })
  )

  it.live(
    "takes the window's page, which the engine serves at its door, and is made again without it",
    () =>
      Effect.gen(function* () {
        const copies = join(folder("data"), "engine")
        const program = banda("banda 1.2.3 (build aa)")
        const copy = yield* copyOf(program, copies)
        const index = join(dirname(copy), PAGE_FOLDER, "dist/index.html")
        expect(existsSync(index)).toBe(false)
        // The app carries the page's build, a folder of folders.
        const assets = join(dirname(program), PAGE_FOLDER, "dist/assets")
        mkdirSync(assets, { recursive: true })
        writeFileSync(join(assets, "../index.html"), "<title>Banda</title>")
        writeFileSync(join(assets, "index-abc123.js"), "export {}")
        expect(yield* copyOf(program, copies)).toBe(copy)
        expect(readFileSync(index, "utf8")).toBe("<title>Banda</title>")
        expect(
          readFileSync(
            join(dirname(copy), PAGE_FOLDER, "dist/assets/index-abc123.js"),
            "utf8"
          )
        ).toBe("export {}")
        // Whole now: asked again, it is kept as it is.
        writeFileSync(index, "<title>Banda</title><!-- kept -->")
        expect(yield* copyOf(program, copies)).toBe(copy)
        expect(readFileSync(index, "utf8")).toContain("kept")
      })
  )

  it.live("made before it carried them, or missing one, is made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const copy = yield* copyOf(program, copies)
      const adapter = join(dirname(copy), CARRIED, "claude-agent-acp.mjs")
      expect(existsSync(adapter)).toBe(false)
      carried(program, "// the adapter")
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(adapter, "utf8")).toBe("// the adapter")
      carried(program, "// the adapter, a newer build")
      yield* copyOf(program, copies)
      expect(readFileSync(adapter, "utf8")).toBe(
        "// the adapter, a newer build"
      )
    })
  )
})

describe("the copy and the Node the app carries", () => {
  /** `node/` beside `program`, holding a Node that is `text`. */
  function carried(program: string, text: string) {
    const node = join(dirname(program), NODE_FOLDER)
    mkdirSync(node, { recursive: true })
    writeFileSync(join(node, "node.exe"), text)
  }

  it.live("takes it, so the engine runs the adapters on it", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      carried(program, "a node")
      const copy = yield* copyOf(program, copies)
      expect(
        readFileSync(join(dirname(copy), NODE_FOLDER, "node.exe"), "utf8")
      ).toBe("a node")
    })
  )

  it.live("made without it, or with another, is made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const copy = yield* copyOf(program, copies)
      const node = join(dirname(copy), NODE_FOLDER, "node.exe")
      expect(existsSync(node)).toBe(false)
      carried(program, "a node")
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(node, "utf8")).toBe("a node")
      carried(program, "a newer node")
      yield* copyOf(program, copies)
      expect(readFileSync(node, "utf8")).toBe("a newer node")
    })
  )
})

describe("the copy and the updater the app carries", () => {
  /** `banda-update` beside `program`: a file, not a folder, that is `text`. */
  function carried(program: string, text: string) {
    writeFileSync(join(dirname(program), UPDATER), text, { mode: 0o755 })
  }

  it.live("takes it, a file beside the program", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      carried(program, "an updater")
      const copy = yield* copyOf(program, copies)
      expect(readFileSync(join(dirname(copy), UPDATER), "utf8")).toBe(
        "an updater"
      )
    })
  )

  // Banda Dev 0.1.0-dev.792 on macOS: the copy's check read the updater
  // as a folder, and the window did not start (ENOTDIR).
  it.live("kept, is checked as a file, and the copy is used again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      carried(program, "an updater")
      const copy = yield* copyOf(program, copies)
      expect(yield* copyOf(program, copies)).toBe(copy)
      const path = yield* Program.use((own) => own.path).pipe(
        Effect.provide(Program.layer({ program, copies })),
        Effect.provide(NodeServices.layer)
      )
      expect(path).toBe(copy)
    })
  )

  it.live("made without it, or with another, is made again", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const copy = yield* copyOf(program, copies)
      const updater = join(dirname(copy), UPDATER)
      expect(existsSync(updater)).toBe(false)
      carried(program, "an updater")
      expect(yield* copyOf(program, copies)).toBe(copy)
      expect(readFileSync(updater, "utf8")).toBe("an updater")
      carried(program, "a newer updater")
      yield* copyOf(program, copies)
      expect(readFileSync(updater, "utf8")).toBe("a newer updater")
    })
  )
})

describe("a rename on Windows", () => {
  /** A rename that fails as `codes` say, one a try, and then works. */
  const failing = (...codes: string[]) => {
    const tried: string[] = []
    const renames = async (from: string) => {
      tried.push(from)
      const code = codes.shift()
      if (code)
        throw Object.assign(new Error(`${code}: held`), { code }) as Error
    }
    return { tried, renames }
  }

  it.live("is tried again while another program holds the file", () =>
    Effect.gen(function* () {
      const { tried, renames } = failing("EPERM", "EBUSY", "EACCES")
      yield* renaming("a", "b", renames)
      expect(tried).toHaveLength(4)
    })
  )

  it.live("fails at once for anything else", () =>
    Effect.gen(function* () {
      const { tried, renames } = failing("ENOENT")
      const failed = yield* Effect.flip(renaming("a", "b", renames))
      expect(failed.message).toBe("ENOENT: held")
      expect(tried).toHaveLength(1)
    })
  )

  it.effect("gives up after ten seconds", () =>
    Effect.gen(function* () {
      const { tried, renames } = failing(...Array(100).fill("EPERM"))
      const fiber = yield* Effect.forkChild(
        Effect.exit(renaming("a", "b", renames))
      )
      yield* TestClock.adjust("9 seconds")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("2 seconds")
      expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true)
      expect(tried.length).toBeGreaterThan(40)
    })
  )
})

describe("the copy and the Electron that runs the adapters", () => {
  it.live("names the app's, for an engine started with no window", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const app = "/Applications/Banda.app/Contents/MacOS/Banda"
      const named = (copy: string) =>
        readFileSync(join(dirname(copy), ELECTRON), "utf8")
      const copy = yield* ownCopy(program, copies, app).pipe(
        Effect.provide(NodeServices.layer)
      )
      expect(named(copy)).toBe(`${app}\n`)
      // The app moved: the copy in place names where it is now.
      const moved = "/Users/p/Applications/Banda.app/Contents/MacOS/Banda"
      const again = yield* ownCopy(program, copies, moved).pipe(
        Effect.provide(NodeServices.layer)
      )
      expect(again).toBe(copy)
      expect(named(copy)).toBe(`${moved}\n`)
    })
  )

  it.live("names none for an app that goes as it stops", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const copy = yield* copyOf(banda("banda 1.2.3 (build aa)"), copies)
      expect(existsSync(join(dirname(copy), ELECTRON))).toBe(false)
    })
  )

  it("a packed app's copies name the Electron it gives", () => {
    const resources = folder("resources")
    const data = "/home/p/.local/share/banda"
    const electron = "/Applications/Banda.app/Contents/MacOS/Banda"
    const where = whereOf({
      named: undefined,
      checkout: "/c",
      resources,
      data,
      electron,
    })
    expect(where.electron).toBe(electron)
    writeFileSync(join(resources, "package-type"), "pacman\n")
    expect(
      whereOf({ named: undefined, checkout: "/c", resources, data, electron })
    ).toEqual({ program: join(resources, "banda") })
  })
})

describe("the window's program", () => {
  const programOf = (where: Where, uncopied?: (why: string) => void) =>
    Program.use((program) => program.path).pipe(
      Effect.provide(Program.layer(where, uncopied)),
      Effect.provide(NodeServices.layer)
    )

  it.live("is its copy, when it has one", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const path = yield* programOf({
        program: banda("banda 1.2.3 (build aa)"),
        copies,
      })
      expect(path).toBe(join(copies, "1.2.3", "banda"))
    })
  )

  it.live(
    "is the program itself when its copy fails, as before, and says why",
    () =>
      Effect.gen(function* () {
        const program = banda("banda 1.2.3 (build aa)", "exit 3")
        const copies = join(folder("data"), "engine")
        const said: string[] = []
        const path = yield* programOf({ program, copies }, (why) =>
          said.push(why)
        )
        expect(path).toBe(program)
        expect(said).toHaveLength(1)
        expect(said[0]).toContain("ended with code 3")
      })
  )

  it.live("is made again when its copy goes while the window runs", () =>
    Effect.gen(function* () {
      const copies = join(folder("data"), "engine")
      const program = banda("banda 1.2.3 (build aa)")
      const [first, again] = yield* Effect.gen(function* () {
        const { path } = yield* Program
        const first = yield* path
        rmSync(copies, { recursive: true, force: true })
        return [first, yield* path]
      }).pipe(
        Effect.provide(Program.layer({ program, copies })),
        Effect.provide(NodeServices.layer)
      )
      expect(again).toBe(first)
      expect(readFileSync(again)).toEqual(readFileSync(program))
    })
  )
})

describe("the old copies", () => {
  /** A copy of `version` in `copies`, made `age` seconds ago. */
  function made(copies: string, version: string, age: number): string {
    const path = join(copies, version)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "banda"), "")
    const then = Date.now() / 1000 - age
    utimesSync(path, then, then)
    return path
  }

  it("go but the one in use and the last before it", () => {
    const copies = folder("engine")
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    made(copies, ".1.3.0-cut", 50)
    expect(prune(copies, kept, []).sort()).toEqual([
      join(copies, ".1.3.0-cut"),
      join(copies, "1.0.0"),
    ])
    expect(listed(copies)).toEqual(["1.1.0", "1.2.0"])
  })

  it("stay while nothing can tell what runs", () => {
    const copies = folder("engine")
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    expect(prune(copies, kept, undefined)).toEqual([])
    expect(listed(copies)).toEqual(["1.0.0", "1.1.0", "1.2.0"])
  })

  it("stay while a program runs from them, by the path it was started by", () => {
    const real = folder("engine")
    const copies = join(folder("link"), "engine")
    symlinkSync(real, copies)
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    const running = [join(copies, "1.0.0", "banda")]
    expect(prune(copies, kept, running)).toEqual([])
  })

  it("stay while a program runs from them, by their real paths", () => {
    const real = folder("engine")
    const copies = join(folder("link"), "engine")
    symlinkSync(real, copies)
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    const running = [join(real, "1.0.0", "banda")]
    expect(prune(copies, kept, running)).toEqual([])
  })

  it("stay while a program runs from them", () => {
    const copies = folder("engine")
    made(copies, "0.9.0", 400)
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    const running = [join(copies, "1.0.0", "banda"), "/usr/bin/1.0.0"]
    expect(prune(copies, kept, running)).toEqual([join(copies, "0.9.0")])
    expect(listed(copies)).toEqual(["1.0.0", "1.1.0", "1.2.0"])
  })

  it("on Windows, are moved aside and removed, unless they will not move", async () => {
    const copies = folder("engine")
    made(copies, "0.9.0", 400)
    made(copies, "1.0.0", 300)
    made(copies, "1.1.0", 200)
    const kept = made(copies, "1.2.0", 100)
    made(copies, ".1.3.0-cut", 50)
    // Windows renames no folder a program runs from.
    const busy = join(copies, "1.0.0")
    const renames = async (from: string, to: string) => {
      if (from === busy)
        throw Object.assign(new Error("EPERM"), { code: "EPERM" })
      await rename(from, to)
    }
    expect((await pruneAside(copies, kept, renames)).sort()).toEqual([
      join(copies, ".1.3.0-cut"),
      join(copies, "0.9.0"),
    ])
    expect(listed(copies)).toEqual(["1.0.0", "1.1.0", "1.2.0"])
  })

  it("on Windows, move back when a program in them will not go", async () => {
    const copies = folder("engine")
    const kept = made(copies, "1.2.0", 100)
    const old = made(copies, ".1.2.0-old", 50)
    // Its Node runs, though its folder moved: here a folder in its place,
    // whose removal as a file fails, as Windows removes no program that
    // runs.
    const node = join(old, NODE_FOLDER, "node.exe")
    mkdirSync(node, { recursive: true })
    expect(await pruneAside(copies, kept)).toEqual([])
    expect(listed(copies)).toEqual([".1.2.0-old", "1.2.0"])
    expect(existsSync(node)).toBe(true)
  })

  it("are read from ps, each by its whole path", () => {
    const listed = [
      "/sbin/launchd",
      "  /Applications/Banda Dev.app/Contents/MacOS/Banda Dev",
      "",
      "/Users/p/Library/Application Support/banda-dev/engine/0.3.0/banda  ",
      "",
    ].join("\n")
    expect(programsOf(listed)).toEqual([
      "/sbin/launchd",
      "/Applications/Banda Dev.app/Contents/MacOS/Banda Dev",
      "/Users/p/Library/Application Support/banda-dev/engine/0.3.0/banda",
    ])
  })

  it.skipIf(process.platform !== "linux")(
    "are known to run by this user's processes' programs",
    () => {
      expect(runningPrograms()).toContain(realpathSync(process.execPath))
    }
  )
})
