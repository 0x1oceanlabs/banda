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
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  CARRIED,
  ELECTRON,
  ownCopy,
  Program,
  programsOf,
  prune,
  runningPrograms,
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
