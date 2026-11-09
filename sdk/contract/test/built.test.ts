import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { compiledAt, dependencies, stale } from "./built"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banda-built-"))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const BEFORE = new Date("2026-01-01T00:00:00Z")
/** When a crate was compiled, before another checkout linked the binary. */
const COMPILED = new Date("2026-01-01T12:00:00Z")
const BETWEEN = new Date("2026-01-01T18:00:00Z")
const BUILT = new Date("2026-01-02T00:00:00Z")
const AFTER = new Date("2026-01-03T00:00:00Z")

const BUILD = "run cargo build --workspace"
const BUILD_HERE =
  /: cargo rebuilds only .* run cd \S+ && git ls-files -z '\*\.rs' \| xargs -0 touch -c && cargo build --workspace$/

function file(path: string, text: string, at = BEFORE): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  utimesSync(path, at, at)
}

/** A checkout: a workspace's Cargo.lock, and `files`. */
function checkout(name: string, files: Record<string, string> = {}): string {
  const root = join(dir, name)
  file(join(root, "Cargo.lock"), "the lock")
  for (const [path, text] of Object.entries(files)) file(join(root, path), text)
  return root
}

/** `root`'s target/debug/banda, built from `sources` as its .d says. */
function binary(root: string, sources: string[]): string {
  const path = join(root, "target/debug/banda")
  const escaped = (each: string) => each.replaceAll(" ", "\\ ")
  file(path, "a program", BUILT)
  file(
    `${path}.d`,
    `${escaped(path)}: ${sources.map(escaped).join(" ")}\n`,
    BUILT
  )
  return path
}

const KERNEL = "kernel/src/lib.rs"

test("a binary built from this checkout's sources passes", () => {
  const here = checkout("here", { [KERNEL]: "one" })
  expect(stale(binary(here, [join(here, KERNEL)]), here, null)).toBeNull()
})

test("a source changed after the build is refused, and a build mends it", () => {
  const here = checkout("here", { [KERNEL]: "one" })
  const program = binary(here, [join(here, KERNEL)])
  file(join(here, KERNEL), "two", AFTER)
  expect(stale(program, here, null)).toBe(
    `target/debug/banda is older than ${KERNEL}: ${BUILD}`
  )
})

test("a source the build read and this checkout no longer has is refused", () => {
  const here = checkout("here", { [KERNEL]: "one" })
  const program = binary(here, [
    join(here, KERNEL),
    join(here, "kernel/src/old.rs"),
  ])
  expect(stale(program, here, null)).toBe(
    `target/debug/banda was built with kernel/src/old.rs, which this checkout no longer has: ${BUILD}`
  )
})

test("another checkout's build of the same sources passes", () => {
  const other = checkout("other", { [KERNEL]: "one" })
  const here = checkout("here", { [KERNEL]: "one" })
  expect(stale(binary(here, [join(other, KERNEL)]), here, null)).toBeNull()
})

test("another checkout's build of other sources is refused, saying how to build it here", () => {
  const other = checkout("other", { [KERNEL]: "two" })
  const here = checkout("here", { [KERNEL]: "one" })
  const said = stale(binary(here, [join(other, KERNEL)]), here, null)
  expect(said).toMatch(
    `target/debug/banda was built from ${other}, whose ${KERNEL} differs from this checkout's: `
  )
  expect(said).toMatch(BUILD_HERE)
})

test("another checkout's source changed since its build is refused", () => {
  const other = checkout("other")
  file(join(other, KERNEL), "one", AFTER)
  const here = checkout("here", { [KERNEL]: "one" })
  expect(stale(binary(here, [join(other, KERNEL)]), here, null)).toMatch(
    `target/debug/banda was built from ${other}, whose ${KERNEL} has changed since: `
  )
})

test("another checkout's other Cargo.lock is refused", () => {
  const other = checkout("other", { [KERNEL]: "one" })
  file(join(other, "Cargo.lock"), "another lock")
  const here = checkout("here", { [KERNEL]: "one" })
  expect(stale(binary(here, [join(other, KERNEL)]), here, null)).toMatch(
    `whose Cargo.lock differs from this checkout's`
  )
})

test("a checkout that is gone is refused", () => {
  const here = checkout("here", { [KERNEL]: "one" })
  const gone = join(dir, "gone", KERNEL)
  expect(stale(binary(here, [gone]), here, null)).toMatch(
    `target/debug/banda was built from ${gone}, which is gone: `
  )
})

test("a missing binary, or its .d, is refused", () => {
  const here = checkout("here")
  const program = join(here, "target/debug/banda")
  expect(stale(program, here, null)).toBe(
    `target/debug/banda is missing: ${BUILD}`
  )
  file(program, "a program")
  expect(stale(program, here, null)).toBe(
    `target/debug/banda.d, which says what target/debug/banda was built from, is missing: ${BUILD}`
  )
})

test("a path with a space in it is read whole", () => {
  expect(dependencies("/a b/banda: /x\\ y/z.rs /w.rs\n")).toEqual([
    "/x y/z.rs",
    "/w.rs",
  ])
  const other = checkout("other checkout", { [KERNEL]: "two" })
  const here = checkout("this checkout", { [KERNEL]: "one" })
  const said = stale(binary(here, [join(other, KERNEL)]), here, null)
  expect(said).toMatch(`built from ${other}, whose ${KERNEL} differs`)
  expect(said).toMatch(`run cd '${here}' && git ls-files`)
})

test("what a build script wrote into target/ is no source", () => {
  const here = checkout("here", { [KERNEL]: "one" })
  const written = join(here, "target/debug/build/banda-1/out/apps.rs")
  const program = binary(here, [join(here, KERNEL), written])
  file(written, "pub const APPS", AFTER)
  expect(stale(program, here, null)).toBeNull()
})

test("a folder a build script read counts by the names in it", () => {
  const other = checkout("other", { "apps/agents/app.toml": "" })
  const here = checkout("here", { "apps/agents/app.toml": "" })
  mkdirSync(join(here, "apps/node_modules"))
  const program = binary(here, [join(other, "apps")])
  expect(stale(program, here, null)).toBeNull()
  mkdirSync(join(here, "apps/files"))
  expect(stale(program, here, null)).toMatch(
    `built from ${other}, whose apps differs from this checkout's`
  )
})

test("a crate is what the checkout that compiled it holds, whichever wrote the .d", () => {
  // cargo rebuilt nothing in `here`: its files were older than the build
  // `other` made, and the .d it wrote names its own.
  const crate = { "kernel/Cargo.toml": "", [KERNEL]: "one" }
  const here = checkout("here", crate)
  const other = checkout("other", { ...crate, [KERNEL]: "two" })
  const program = binary(here, [join(here, KERNEL)])
  const units = (from: string) => [
    { name: `${KERNEL}/@/kernel.cgu.0`, dir: from },
    { name: "/rustc/1/library/std/src/lib.rs/@/std.cgu.0", dir: "/rustc/1" },
  ]
  expect(stale(program, here, units(here))).toBeNull()
  const said = stale(program, here, units(other))
  expect(said).toMatch(
    `built from ${other}, whose ${KERNEL} differs from this checkout's`
  )
  expect(said).toMatch(BUILD_HERE)
  file(join(other, KERNEL), "one")
  expect(stale(program, here, units(other))).toBeNull()
})

test("a crate with no unit of its own is compared with every checkout that compiled one", () => {
  const files = {
    "kernel/Cargo.toml": "",
    [KERNEL]: "one",
    "consts/src/lib.rs": "one",
  }
  const here = checkout("here", files)
  const other = checkout("other", { ...files, "consts/src/lib.rs": "two" })
  const program = binary(here, [
    join(here, KERNEL),
    join(here, "consts/src/lib.rs"),
  ])
  expect(
    stale(program, here, [{ name: `${KERNEL}/@/kernel.cgu.0`, dir: other }])
  ).toMatch(`built from ${other}, whose consts/src/lib.rs differs`)
})

/** `kernel` compiled in `from` at COMPILED, the binary linked at BUILT. */
const compiledIn = (from: string) => [
  { name: `${KERNEL}/@/kernel.cgu.0`, dir: from },
]
const KERNEL_AT = new Map([[KERNEL, BigInt(COMPILED.getTime()) * 1_000_000n]])

test("this checkout's source changed after its crate was compiled is refused, though another checkout linked later", () => {
  const crate = { "kernel/Cargo.toml": "", [KERNEL]: "one" }
  const here = checkout("here", crate)
  const program = binary(here, [join(here, KERNEL)])
  file(join(here, KERNEL), "two", BETWEEN)
  expect(stale(program, here, compiledIn(here), KERNEL_AT)).toBe(
    `target/debug/banda is older than ${KERNEL}: ${BUILD}`
  )
  file(join(here, KERNEL), "two", BEFORE)
  expect(stale(program, here, compiledIn(here), KERNEL_AT)).toBeNull()
})

test("another checkout's source changed after its crate was compiled is refused, though it matches this checkout's", () => {
  const crate = { "kernel/Cargo.toml": "", [KERNEL]: "one" }
  const here = checkout("here", crate)
  const other = checkout("other", crate)
  const program = binary(here, [join(here, KERNEL)])
  file(join(other, KERNEL), "one", BETWEEN)
  expect(stale(program, here, compiledIn(other), KERNEL_AT)).toMatch(
    `built from ${other}, whose ${KERNEL} has changed since: `
  )
})

test("a crate compiled again after the link is refused, saying how to build it here", () => {
  const here = checkout("here", { "kernel/Cargo.toml": "", [KERNEL]: "one" })
  const program = binary(here, [join(here, KERNEL)])
  const said = stale(
    program,
    here,
    compiledIn(here),
    new Map([[KERNEL, BigInt(AFTER.getTime()) * 1_000_000n]])
  )
  expect(said).toMatch(
    `target/debug/banda was linked before ${KERNEL} was compiled again: `
  )
  expect(said).toMatch(BUILD_HERE)
})

test("when each crate was compiled is read from cargo's records beside the binary", () => {
  const debug = join(dir, "target/debug")
  const at = (name: string, text: string, when = BEFORE) =>
    file(join(debug, name), text, when)
  // A program, the crate it links, a crate from elsewhere, and an older
  // build of the same crate with other settings, which it does not link.
  const [own, kernel, older, serde] = [
    "0123456789abcdef",
    "1111111111111111",
    "2222222222222222",
    "3333333333333333",
  ]
  at(`deps/banda-${own}`, "a program")
  linkSync(join(debug, `deps/banda-${own}`), join(debug, "banda"))
  at(
    `deps/banda-${own}.d`,
    `/t/banda-${own}.d: engine/src/main.rs engine/src/a.rs\n`
  )
  at(`.fingerprint/banda-${own}/invoked.timestamp`, "", BUILT)
  // Past 2^53, which JSON.parse would round.
  at(
    `.fingerprint/banda-${own}/bin-banda.json`,
    `{"deps":[[1,"kernel",false,8108791459925279593],[2,"serde",false,7]],"local":[]}`
  )
  at(
    `deps/kernel-${kernel}.d`,
    `/t/kernel-${kernel}.d: kernel/src/lib.rs engine/src/a.rs /x/y.rs\n`
  )
  at(`.fingerprint/banda-kernel-${kernel}/invoked.timestamp`, "", COMPILED)
  at(`.fingerprint/banda-kernel-${kernel}/lib-kernel`, "694391dede368870")
  at(`.fingerprint/banda-kernel-${kernel}/lib-kernel.json`, `{"deps":[]}`)
  at(`deps/kernel-${older}.d`, `/t/kernel-${older}.d: kernel/src/old.rs\n`)
  at(`.fingerprint/banda-kernel-${older}/invoked.timestamp`, "", BEFORE)
  at(`.fingerprint/banda-kernel-${older}/lib-kernel`, "0700000000000000")
  at(`.fingerprint/banda-kernel-${older}/lib-kernel.json`, `{"deps":[]}`)
  at(
    `deps/serde-${serde}.d`,
    `/t/serde-${serde}.d: /registry/serde/src/lib.rs\n`
  )
  at(`.fingerprint/serde-${serde}/invoked.timestamp`, "", BEFORE)
  at(`.fingerprint/serde-${serde}/lib-serde`, "0700000000000000")
  at(`.fingerprint/serde-${serde}/lib-serde.json`, `{"deps":[]}`)

  const ns = (date: Date) => BigInt(date.getTime()) * 1_000_000n
  expect(compiledAt(join(debug, "banda"))).toEqual(
    new Map([
      ["engine/src/main.rs", ns(BUILT)],
      ["engine/src/a.rs", ns(COMPILED)],
      ["kernel/src/lib.rs", ns(COMPILED)],
    ])
  )
  // A copy says nothing of which build it is.
  rmSync(join(debug, "banda"))
  copyFileSync(join(debug, `deps/banda-${own}`), join(debug, "banda"))
  expect(compiledAt(join(debug, "banda"))).toBeNull()
})
