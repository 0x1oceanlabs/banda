/**
 * Whether target/debug/banda was built from this checkout's sources. The
 * engine's tests and the window's end-to-end tests run it, and a binary
 * built from other code fails them on what looks like a real bug (#1087).
 * Checkouts here may share one target/, so what counts is the sources'
 * content, not which checkout built it last.
 *
 * Two records say what a binary came from. Beside it, cargo writes the
 * files it was built from (target/debug/banda.d), but names each crate's
 * files in the checkout that ran cargo last: cargo goes by the files'
 * times, so a crate another checkout compiled stays in the binary while
 * this checkout's copy is older than that build. The DWARF says which
 * checkout compiled each crate (./dwarf.ts), where there is DWARF to read:
 * not on CI, which builds without it, nor on a Mac, which keeps it apart.
 * A build script's own inputs are in the .d only as it declares them
 * (cargo::rerun-if-changed), and named in the checkout it last ran in.
 *
 * A source counts from when its crate was compiled, not from when the
 * binary was linked: another checkout can link it again without compiling
 * a crate again, and a file changed in between would pass (compiledAt). A
 * build script's inputs are in no crate's record, and count from the link.
 *
 * This only ever reads: a cargo build inside a test run would swap a shared
 * binary under another checkout's running tests, and hide minutes of build.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path"
import { compileUnits, type Unit } from "./dwarf"

const repository = resolve(import.meta.dirname, "../../..")

const BUILD = "run cargo build --workspace"
/** `touch -c` makes no empty file of one deleted by hand, and git lists
 * files only below the folder it runs in. */
const buildHere = (checkout: string) =>
  "cargo rebuilds only what is newer than its last build, so a crate another checkout sharing target/ compiled stays: " +
  `run cd ${/[^\w./-]/.test(checkout) ? `'${checkout}'` : checkout} && git ls-files -z '*.rs' | xargs -0 touch -c && cargo build --workspace`

/** What decides how the workspace builds, beside the files the .d lists. */
const MANIFESTS = ["Cargo.lock", "Cargo.toml", "rust-toolchain.toml"]

const checked = new Map<string, string | null>()

/** The path of target/debug/`name`, once this checkout's sources are what
 * it was built from; throws, saying how to build it, when they are not. */
export function program(name: string): string {
  const path = join(
    repository,
    "target/debug",
    name + (process.platform === "win32" ? ".exe" : "")
  )
  if (!checked.has(path)) checked.set(path, stale(path, repository))
  const problem = checked.get(path)
  if (problem) throw new Error(problem)
  return path
}

/** The end-to-end tests' global setup: the window starts the engine and the
 * fake agent from target/debug. */
export default function builtFromHere(): void {
  program("banda")
  program("banda-fake-agent")
}

/** Why, and whether a cargo build alone mends it. A folder's comes last:
 * a file says more. */
type Problem = { text: string; here: boolean; folder?: boolean }

/**
 * Why `binary` is not what `checkout`'s sources build, or null when it is.
 * `units` are its compile units, null where it has no DWARF, and `times`
 * when the crates that read each source were compiled (compiledAt).
 */
export function stale(
  binary: string,
  checkout: string,
  units: Unit[] | null = compileUnits(binary),
  times: Map<string, bigint> | null = compiledAt(binary)
): string | null {
  const name = relative(checkout, binary)
  const listed = binary.replace(/\.exe$/, "") + ".d"
  if (!existsSync(binary)) return `${name} is missing: ${BUILD}`
  if (!existsSync(listed))
    return `${relative(checkout, listed)}, which says what ${name} was built from, is missing: ${BUILD}`
  const here = realpathSync(checkout)
  const built = statSync(binary, { bigint: true }).mtimeNs
  const target = dirname(dirname(realpathSync(binary)))
  const problems = new Map<string, Problem>()
  const said = (key: string, problem: Problem) => {
    if (!problems.has(key)) problems.set(key, problem)
  }
  /** What a checkout's file at `path` must be no newer than. */
  const since = (path: string) => times?.get(path) ?? built

  /** Whether `root`'s `path` is still what `binary` was built from, and the
   * same as this checkout's. */
  const compare = (root: string, path: string, manifest = false) => {
    const theirs = join(root, path)
    const ours = join(here, path)
    const key = `${root}\0${path}`
    // A folder's time changes with any file made or removed in it, as
    // pnpm install does at the top: only the names in it count.
    const folder = isFolder(theirs) || isFolder(ours)
    if (root === here) {
      // Cargo goes by a manifest's content, so a newer one alone is no sign.
      if (manifest || folder) return
      if (!existsSync(ours))
        said(key, {
          text: `${name} was built with ${path}, which this checkout no longer has`,
          here: true,
        })
      else if (statSync(ours, { bigint: true }).mtimeNs > since(path))
        said(key, {
          text: `${name} is older than ${path || "this checkout's top folder"}`,
          here: true,
        })
      return
    }
    const shown = path || "top folder"
    if (!existsSync(theirs)) {
      if (manifest && !existsSync(ours)) return
      said(key, {
        text: `${name} was built from ${root}, whose ${shown} is gone`,
        here: false,
        folder,
      })
    } else if (
      !folder &&
      statSync(theirs, { bigint: true }).mtimeNs > since(path)
    )
      said(key, {
        text: `${name} was built from ${root}, whose ${shown} has changed since`,
        here: false,
      })
    else if (!same(theirs, ours))
      said(key, {
        text: `${name} was built from ${root}, whose ${shown} differs from this checkout's`,
        here: false,
        folder,
      })
  }

  // The workspace's crates in the program, by their folder: where each was
  // compiled. rustc names a workspace crate's units by a relative path.
  const crates = new Map<string, Set<string>>()
  const files = new Set<string>()
  for (const unit of units ?? []) {
    const file = unit.name.split("/@/")[0]!
    if (file.startsWith("/") || file === unit.name) continue
    const folder = packageOf(file, [unit.dir, here])
    crates.set(folder, (crates.get(folder) ?? new Set()).add(unit.dir))
    files.add(file)
  }
  const compiled = new Set([...crates.values()].flatMap((dirs) => [...dirs]))
  const roots = new Set(compiled)

  const entries = dependencies(readFileSync(listed, "utf8"))
    .filter((path) => !within(real(path), target))
    .map((path) => {
      const root = rootOf(path)
      return { path, root, file: root === null ? null : relative(root, path) }
    })
    .filter(({ file }) => file === null || !file.startsWith(`target${sep}`))
  // The checkout that wrote the .d: a crate's own files, the crates' root
  // files among them, are named in it. What compiled them is the DWARF's.
  const writers = new Set(
    entries
      .filter(({ file }) => file !== null && files.has(file))
      .map(({ root }) => root!)
  )

  for (const { path, root, file } of entries) {
    if (root === null || file === null) {
      // No workspace holds it any more, or never did.
      if (!existsSync(path))
        said(path, {
          text: `${name} was built from ${path}, which is gone`,
          here: false,
        })
      else if (statSync(path, { bigint: true }).mtimeNs > built)
        said(path, { text: `${name} is older than ${path}`, here: true })
      continue
    }
    // Where the .d writer's path for a crate's file was compiled: its
    // crate's units' folder, or, for a crate with no code of its own to
    // make a unit of (only constants or generics), any of them.
    const owner = writers.has(root) ? crateOf(file, crates) : undefined
    const from = !writers.has(root)
      ? [root]
      : owner === undefined
        ? [root, ...compiled]
        : [...crates.get(owner)!]
    for (const where of new Set(from)) {
      compare(real(where), file)
      roots.add(where)
    }
  }
  for (const root of roots) {
    const where = real(root)
    if (where === here) continue
    for (const manifest of MANIFESTS) compare(where, manifest, true)
    for (const [folder, dirs] of crates)
      if (dirs.has(root)) compare(where, join(folder, "Cargo.toml"), true)
  }
  // A crate compiled again after the link: no record says when the one
  // linked was, nor which checkout compiled it again, so cargo's link over
  // it may take in another checkout's crate.
  for (const [path, time] of times ?? [])
    if (time > built)
      said(`\0${path}`, {
        text: `${name} was linked before ${path} was compiled again`,
        here: false,
      })

  if (problems.size === 0) return null
  const all = [...problems.values()].sort((a, b) => rank(a) - rank(b))
  const first = all[0]!
  const more = all.length > 1 ? ` (and ${all.length - 1} more)` : ""
  const fix = all.every((problem) => problem.here) ? BUILD : buildHere(here)
  return `${first.text}${more}: ${fix}`
}

/**
 * When the workspace's crates in `binary` were compiled: for each source
 * one of them read, by its path in the checkout, the earliest. Null where
 * cargo's records beside it do not say, as when the binary is a copy, not a
 * link to deps/; then every source counts from the link.
 *
 * cargo keeps a record of each crate it compiled, in .fingerprint/
 * <package>-<hash>/: `invoked.timestamp`, made as rustc started, and a
 * .json naming the record of each crate it was compiled against, by the
 * hash that record's `lib-<name>` file holds (its bytes in reverse). rustc's
 * deps/<crate>-<hash>.d lists what it read, relative to the workspace for
 * a crate of it. A crate whose record a later build with other settings
 * replaced is left out: its sources count from the link.
 */
export function compiledAt(binary: string): Map<string, bigint> | null {
  try {
    const debug = dirname(realpathSync(binary))
    const deps = join(debug, "deps")
    const records = join(debug, ".fingerprint")
    const record = new Map(
      readdirSync(records).map((each) => [each.slice(-16), each])
    )
    // The hashes of each crate's builds, by its name.
    const builds = new Map<string, string[]>()
    for (const each of readdirSync(deps)) {
      const [, crate, hash] = /^(.+)-([0-9a-f]{16})\.d$/.exec(each) ?? []
      if (crate && hash) builds.set(crate, [...(builds.get(crate) ?? []), hash])
    }
    /** A file in the record of the build `hash`, where there is one. */
    const recorded = (hash: string, file: string) => {
      const path = record.has(hash) && join(records, record.get(hash)!, file)
      return path && existsSync(path) ? path : undefined
    }
    // cargo hard-links target/debug/<program> to deps/<crate>-<hash>.
    const own = statSync(binary, { bigint: true })
    const exe = binary.endsWith(".exe") ? ".exe" : ""
    const program = basename(binary, exe)
    const crate = program.replaceAll("-", "_")
    const hash = builds.get(crate)?.find((each) => {
      const linked = join(deps, `${crate}-${each}${exe}`)
      if (!existsSync(linked)) return false
      const that = statSync(linked, { bigint: true })
      return that.ino === own.ino && that.dev === own.dev
    })
    if (!hash) return null

    const times = new Map<string, bigint>()
    const seen = new Set<string>()
    const next = [{ hash, crate, json: `bin-${program}.json` }]
    for (let unit = next.pop(); unit; unit = next.pop()) {
      if (seen.has(unit.hash)) continue
      seen.add(unit.hash)
      const read = rule(
        readFileSync(join(deps, `${unit.crate}-${unit.hash}.d`), "utf8")
      )
      // A crate from elsewhere names its files whole, and needs none of ours.
      if (read.length === 0 || isAbsolute(read[0]!)) continue
      const time = statSync(recorded(unit.hash, "invoked.timestamp")!, {
        bigint: true,
      }).mtimeNs
      for (const path of read.filter((each) => !isAbsolute(each))) {
        const earlier = times.get(normalize(path))
        if (earlier === undefined || time < earlier)
          times.set(normalize(path), time)
      }
      // Its hashes are 64-bit, which JSON.parse would round.
      const json = readFileSync(recorded(unit.hash, unit.json)!, "utf8")
      for (const [, name, print] of json.matchAll(
        /\[\d+,"([^"]+)",(?:true|false),(\d+)\]/g
      )) {
        const bytes = Buffer.alloc(8)
        bytes.writeBigUInt64LE(BigInt(print!))
        const found = builds.get(name!)?.find((each) => {
          const file = recorded(each, `lib-${name}`)
          return file && readFileSync(file, "utf8") === bytes.toString("hex")
        })
        if (found)
          next.push({ hash: found, crate: name!, json: `lib-${name}.json` })
      }
    }
    return times
  } catch {
    return null
  }
}

const rank = (problem: Problem) =>
  (problem.here ? 2 : 0) + (problem.folder ? 1 : 0)

/** The files a cargo .d file names: one rule, spaces in a path escaped. */
export function dependencies(text: string): string[] {
  return rule(text).map((path) => resolve(path))
}

/** The files a .d file's first rule names, as it names them. */
function rule(text: string): string[] {
  const line = text.replace(/\\\r?\n/g, " ").split(/\r?\n/)[0] ?? ""
  const words: string[] = []
  let word = ""
  for (let at = 0; at < line.length; at++) {
    const char = line[at]!
    if (char === "\\" && line[at + 1] === " ") {
      word += " "
      at++
    } else if (char === " " || char === "\t") {
      if (word) words.push(word)
      word = ""
    } else word += char
  }
  if (word) words.push(word)
  // The first word is the binary, with the rule's colon.
  const start = words.findIndex((each) => each.endsWith(":"))
  return words.slice(start + 1)
}

/** The folder holding `path`'s Cargo.lock, the workspace it is in, or null
 * when there is none, as when the checkout is gone. */
function rootOf(path: string): string | null {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "Cargo.lock"))) return dir
    if (dirname(dir) === dir) return null
  }
}

/** The crate's folder, the nearest with a Cargo.toml above its root file. */
function packageOf(file: string, roots: string[]): string {
  for (let dir = dirname(file); dir !== "."; dir = dirname(dir))
    if (roots.some((root) => existsSync(join(root, dir, "Cargo.toml"))))
      return dir
  return dirname(dirname(file))
}

/** The crate whose folder holds `file`, the innermost. */
function crateOf(
  file: string,
  crates: Map<string, Set<string>>
): string | undefined {
  let found: string | undefined
  for (const folder of crates.keys())
    if (
      (folder === "." || file === folder || file.startsWith(folder + sep)) &&
      (found === undefined || folder.length > found.length || found === ".")
    )
      found = folder
  return found
}

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep)
}

/** What every checkout has beside its sources, which no build reads. */
const BESIDE = new Set(["node_modules", "target"])

/** Whether two files hold the same bytes, or two folders the same names: a
 * build script reads a folder for the parts in it (engine/build.rs). */
function same(a: string, b: string): boolean {
  if (!existsSync(b)) return false
  const [left, right] = [statSync(a), statSync(b)]
  if (left.isDirectory() || right.isDirectory()) {
    if (!left.isDirectory() || !right.isDirectory()) return false
    const names = (dir: string) =>
      readdirSync(dir)
        .filter((each) => !each.startsWith(".") && !BESIDE.has(each))
        .sort()
        .join("\0")
    return names(a) === names(b)
  }
  return left.size === right.size && readFileSync(a).equals(readFileSync(b))
}
