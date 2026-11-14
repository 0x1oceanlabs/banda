/**
 * The `banda` the window runs: the engine, the look and the settings
 * (ADR 0086, decision 2). A packed Banda runs its own copy of it, never
 * the one inside its AppImage or its app: an AppImage's folder goes away
 * as it stops, and whatever still runs from there dies, as `banda serve`
 * and `banda look --follow` did.
 *
 * The copy is `<data>/engine/<version>/banda` (`banda.exe` on Windows,
 * `PROGRAM`), beside `version`, which
 * holds what the program's `--version` says: its version and its build
 * id, and beside the ACP adapters the app carries (`adapters/`), which the
 * engine finds beside its program (ADR 0059): their files never run from
 * inside the AppImage either. It is written into a folder of its own, run
 * once with `--version`, and renamed into place only when it says the
 * same, so a half-written copy, or one that does not start, is never run.
 * A copy in place is run again while it is of the window's build, it and
 * what it carries as long as the program's, and says so when it is run;
 * one that goes while the window runs is made again before the next run.
 * The last two versions are kept; an older one goes once no program runs
 * from it.
 *
 * What runs the adapters is a Node. The Windows app carries one of its
 * own (`node/node.exe`), which its copies carry too, and the engine runs
 * them on it (ADR 0090, decision 5): Windows locks a program while it
 * runs, so adapters on the installed app would make each install stop
 * them. Elsewhere the window names its own Electron to the engine it
 * starts (main.ts). For an engine started with no window, the copy also
 * has `electron` beside it, which names this Electron, when it stays where
 * it is, as a macOS app's does. An AppImage's goes as it stops, so its
 * copy names none, and such an engine runs the adapters on a `node` of
 * the host's, when it has one (the harnesses' `carried.rs`).
 *
 * On Windows nothing here tells which programs run, but a program that
 * runs cannot be removed: an old copy is renamed aside first, its programs
 * removed there first and the rest only then, and one whose program will
 * not go is moved back (ADR 0090, decision 5). Putting a copy in place is tried for a few
 * seconds, as Defender or the search indexer there may hold a file just
 * written for a moment.
 *
 * A copy that cannot be made, as in a data folder that runs nothing, is
 * not the end of Banda: the window runs the packed program as before, and
 * keeps a Problem that says why.
 *
 * A `banda` that a package manager owns runs where it put it, as Banda
 * from the AUR does: only that manager replaces it, by a rename, so a
 * running engine keeps its own. Such a package says so in `package-type`
 * beside it, as electron-builder's deb, rpm and pacman packages do and
 * the AUR's does (scripts/aur.mjs). A checkout's `banda` runs where cargo
 * built it, and a trial's where it names it (`BANDA_PROGRAM`), so an
 * Agent's test run leaves nothing behind.
 */
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join, sep } from "node:path"
import {
  Console,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Schedule,
  Semaphore,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** The program's name: `banda`, or `banda.exe` on Windows (ADR 0090,
 * decision 7), packed and copied alike. */
export const PROGRAM = process.platform === "win32" ? "banda.exe" : "banda"
/** The file beside a copy that says what its `--version` said. */
const VERSION = "version"
/** The folder of the adapters the app carries, beside its `banda` and its
 * copy's: where the engine looks for them (the harnesses' `carried::FOLDER`). */
export const CARRIED = "adapters"
/** The folder of the Node the Windows app carries to run them, beside its
 * `banda.exe` and its copy's (the harnesses' `carried::NODE_FOLDER`). */
export const NODE_FOLDER = "node"
/** The updater, a program of its own beside the engine (ADR 0131): a
 * file, not a folder. */
export const UPDATER =
  process.platform === "win32" ? "banda-update.exe" : "banda-update"
/** What a copy carries beside its program: each folder of it whole, and
 * each file. */
const BESIDE = [CARRIED, NODE_FOLDER, UPDATER]
/** The file beside a copy that names the app's Electron, which runs the
 * adapters as Node (the harnesses' `carried::ELECTRON`). */
export const ELECTRON = "electron"
/** A version that names a folder: no slash, no leading dot. */
const PLAIN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/
/** How long `banda --version` may take before it counts as broken: on
 * Windows longer, as Defender scans a new program before its first run. */
const WAIT = process.platform === "win32" ? "30 seconds" : "10 seconds"

/** The `banda` the window has, and the folder it keeps its copies of it
 * in, when it runs a copy, with the Electron its copies name. */
export type Where = {
  readonly program: string
  readonly copies?: string
  readonly electron?: string
}

/** Where the window's `banda` is: a trial's, `named`; a checkout's, with
 * no `resources`; else the one packed in `resources`, copied into `data`
 * unless a package manager owns it. Its copies name `electron`, the app's
 * Electron when it stays where it is. */
export function whereOf(options: {
  readonly named: string | undefined
  readonly checkout: string
  readonly resources: string | undefined
  readonly data: string
  readonly electron?: string | undefined
}): Where {
  if (options.named) return { program: options.named }
  if (!options.resources) return { program: options.checkout }
  const program = join(options.resources, PROGRAM)
  if (existsSync(join(options.resources, "package-type"))) return { program }
  const copies = join(options.data, "engine")
  const { electron } = options
  return electron ? { program, copies, electron } : { program, copies }
}

/** The copy could not be made, or did not say what its program says. */
class Uncopied extends Data.TaggedError("Uncopied")<{
  readonly message: string
}> {}

/** The program the window runs as its children (engine.ts, look.ts,
 * settings.ts). */
export class Program extends Context.Service<
  Program,
  {
    /** Its path, asked before each run: a copy that went since is made
     * again. */
    readonly path: Effect.Effect<string>
  }
>()("banda/Program") {
  /** The program `where` names, run from its own copy when it says so;
   * when the copy fails, the program itself, as before: the log says
   * why, and so does `uncopied`. */
  static readonly layer = (
    where: Where,
    uncopied: (why: string) => void = () => {}
  ) =>
    Layer.effect(Program)(
      Effect.gen(function* () {
        const folder = where.copies
        if (!folder) return { path: Effect.succeed(where.program) }
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const copied = ownCopy(where.program, folder, where.electron).pipe(
          Effect.catch((error) =>
            Console.error(
              `banda: the engine runs from ${where.program}, not a copy of its own: ${error.message}`
            ).pipe(
              Effect.andThen(Effect.sync(() => uncopied(error.message))),
              Effect.as(where.program)
            )
          ),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        )
        let path = yield* copied
        if (path !== where.program)
          yield* Effect.forkScoped(leaveTwo(folder, dirname(path)))
        // The engine and the look may both find the copy gone at once.
        const one = yield* Semaphore.make(1)
        return {
          path: one.withPermits(1)(
            Effect.suspend(() =>
              whole(path, where.program)
                ? Effect.succeed(path)
                : Effect.tap(copied, (made) =>
                    Effect.sync(() => {
                      path = made
                    })
                  )
            )
          ),
        }
      })
    )
}

/** `program`'s own copy in `folder`: the one there when it is of the same
 * build, whole, and says so when run; else a new one, checked before it
 * is put in place. Either names `electron` beside it, when given. */
export const ownCopy = (program: string, folder: string, electron?: string) =>
  copyIn(program, folder).pipe(
    Effect.tap((copy) => naming(dirname(copy), electron))
  )

const copyIn = (program: string, folder: string) =>
  Effect.gen(function* () {
    const said = yield* versionOf(program)
    const version = /^banda (\S+)/.exec(said)?.[1]
    if (!version || !PLAIN.test(version))
      return yield* new Uncopied({
        message: `${program} --version said ${JSON.stringify(said)}`,
      })
    const kept = join(folder, version)
    const copy = join(kept, PROGRAM)
    if (textOf(join(kept, VERSION)) === said && whole(copy, program)) {
      const again = yield* Effect.option(versionOf(copy))
      if (Option.contains(again, said)) return copy
    }
    const fresh = yield* attempt(async () => {
      await mkdir(folder, { recursive: true })
      return mkdtemp(join(folder, `.${version}-`))
    })
    yield* Effect.gen(function* () {
      yield* attempt(() => copyInto(program, fresh, said))
      const copied = yield* versionOf(join(fresh, PROGRAM))
      if (copied !== said)
        return yield* new Uncopied({
          message: `its copy said ${JSON.stringify(copied)}, not ${JSON.stringify(said)}`,
        })
      yield* putInPlace(fresh, kept)
    }).pipe(
      Effect.onError(() =>
        attempt(() => rm(fresh, { recursive: true, force: true })).pipe(
          Effect.ignore
        )
      )
    )
    return copy
  })

/** What `program --version` says, trimmed; a program that does not
 * start, ends badly, says nothing or takes too long fails. */
export const versionOf = (program: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const child = yield* spawner.spawn(
        ChildProcess.make(program, ["--version"], {
          stdin: "ignore",
          stderr: "ignore",
        })
      )
      const [said, code] = yield* Effect.all(
        [child.stdout.pipe(Stream.decodeText, Stream.mkString), child.exitCode],
        { concurrency: 2 }
      )
      if (code !== 0 || !said.trim())
        return yield* new Uncopied({
          message: `${program} --version ${code !== 0 ? `ended with code ${code}` : "said nothing"}`,
        })
      return said.trim()
    })
  ).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new Uncopied({ message: error.message }))
    ),
    Effect.timeoutOption(WAIT),
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(
            new Uncopied({ message: `${program} --version did not end` })
          ),
      })
    )
  )

/** Writes `program` into `fresh`, with its line tables when they lie
 * beside it (`banda.dSYM` on macOS, `banda.pdb` on Windows), what the app
 * carries beside it (`BESIDE`), and `said` as its version. Its bytes are
 * written, not the file copied, so what the system marks a download with
 * stays on the app. */
async function copyInto(program: string, fresh: string, said: string) {
  await writeFile(join(fresh, PROGRAM), await readFile(program), {
    mode: 0o755,
    flush: true,
  })
  const tables = {
    "banda.dSYM": `${program}.dSYM`,
    "banda.pdb": `${program.replace(/\.exe$/i, "")}.pdb`,
  }
  for (const [name, beside] of Object.entries(tables))
    if (existsSync(beside))
      await cp(beside, join(fresh, name), { recursive: true })
  for (const name of BESIDE) {
    const carried = join(dirname(program), name)
    if (existsSync(carried))
      await cp(carried, join(fresh, name), { recursive: true })
  }
  await writeFile(join(fresh, VERSION), `${said}\n`, { flush: true })
}

/** Renames `fresh` to `kept`. A copy already there, of another build of
 * the same version, is moved aside first, and goes as an old one does. */
const putInPlace = (fresh: string, kept: string) =>
  Effect.gen(function* () {
    if (existsSync(kept)) yield* renaming(kept, `${fresh}-old`)
    yield* renaming(fresh, kept)
  })

/** The errors of a file another program holds a moment, as Defender or
 * the search indexer holds one just written, on Windows. */
const HELD = new Set(["EPERM", "EACCES", "EBUSY"])

/**
 * Renames `from` to `to`, tried again for up to ten seconds while the file
 * is held (`HELD`): a copy not put in place leaves the window on the packed
 * program, which each install then has to stop. A rename that still fails
 * is `Uncopied`.
 */
export const renaming = (
  from: string,
  to: string,
  renames: (from: string, to: string) => Promise<void> = rename
) =>
  Effect.tryPromise({
    try: () => renames(from, to),
    catch: (error) => error as NodeJS.ErrnoException,
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced("200 millis").pipe(
        Schedule.upTo({ duration: "10 seconds" })
      ),
      while: (error) => HELD.has(error.code ?? ""),
    }),
    Effect.mapError(
      (error) => new Uncopied({ message: error.message ?? String(error) })
    )
  )

/** Removes the old copies from `folder` (`prune`, or on Windows
 * `pruneAside`), apart from the start: nothing waits for it, and it never
 * stops the window. */
const leaveTwo = (folder: string, kept: string) =>
  (process.platform === "win32"
    ? Effect.tryPromise(() => pruneAside(folder, kept))
    : Effect.try(() => prune(folder, kept, runningPrograms()))
  ).pipe(
    Effect.catch((error) =>
      Console.error(`banda: the engine's old copies stay: ${error.message}`)
    )
  )

/** The copies in `folder` that go: every one but `kept` and the newest
 * other one, and any dot-folder a failed or replaced copy left. */
function oldCopies(folder: string, kept: string): string[] {
  const folders = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(folder, entry.name))
  const leftover = (path: string) => basename(path).startsWith(".")
  const copies = folders
    .filter((path) => !leftover(path) && path !== kept)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return [...copies.slice(1), ...folders.filter(leftover)]
}

/**
 * Removes the old copies in `folder` (`oldCopies`), unless a program in
 * `running` runs from inside one, by its path as given or its real path.
 * When what runs is not known, nothing is removed. Returns what it
 * removed.
 */
export function prune(
  folder: string,
  kept: string,
  running: readonly string[] | undefined
): string[] {
  if (!running) return []
  const idle = (path: string) => {
    const inside = [path, realpathSync(path)].map((at) => at + sep)
    return !running.some((program) =>
      inside.some((at) => program.startsWith(at))
    )
  }
  const old = oldCopies(folder, kept).filter(idle)
  for (const path of old) rmSync(path, { recursive: true, force: true })
  return old
}

/** What a copy runs, the first to be removed: the engine before the Node
 * its adapters run on, so a copy whose engine runs keeps its Node. */
const PROGRAMS = [PROGRAM, join(NODE_FOLDER, "node.exe")]

/**
 * Removes the old copies in `folder` (`oldCopies`) as Windows allows,
 * where nothing tells what runs: each is renamed aside, to a dot-folder,
 * with `renames`, and its programs removed there first. Windows removes
 * no program that runs, though it may move the folder one runs from: a
 * copy that will not move stays, and one whose program will not go moves
 * back.
 * Returns what it removed.
 */
export async function pruneAside(
  folder: string,
  kept: string,
  renames: (from: string, to: string) => Promise<void> = rename
): Promise<string[]> {
  const gone: string[] = []
  for (const path of oldCopies(folder, kept)) {
    const aside = join(folder, `.gone-${randomUUID()}`)
    try {
      await renames(path, aside)
    } catch {
      continue
    }
    try {
      for (const program of PROGRAMS)
        await rm(join(aside, program), { force: true })
    } catch {
      await renames(aside, path).catch(() => {})
      continue
    }
    // What is held a moment longer goes at a later start, a dot-folder.
    await rm(aside, { recursive: true, force: true, maxRetries: 3 }).catch(
      () => {}
    )
    gone.push(path)
  }
  return gone
}

/** The programs this user's processes run, by their paths; none when that
 * cannot be told. Linux names each by its real path; macOS's `ps` by the
 * path it was started by, which may go through a link. */
export function runningPrograms(): string[] | undefined {
  try {
    if (process.platform === "linux")
      return readdirSync("/proc")
        .filter((name) => /^\d+$/.test(name))
        .flatMap((pid) => {
          try {
            return [
              readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, ""),
            ]
          } catch {
            // Another user's, or gone.
            return []
          }
        })
    if (process.platform === "darwin")
      return programsOf(
        execFileSync("/bin/ps", ["-axww", "-o", "comm="], {
          encoding: "utf8",
        })
      )
  } catch {
    // Unknown, as on any other system.
  }
  return undefined
}

/** The programs `ps -o comm=` lists, one a line, each by its whole path. */
export function programsOf(listed: string): string[] {
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Writes `electron` beside the copy in `kept`, unless it is there
 * already. A file it cannot write leaves an engine started with no window
 * a `node` of the host's to find, and stops nothing. */
const naming = (kept: string, electron: string | undefined) =>
  Effect.suspend(() => {
    const file = join(kept, ELECTRON)
    if (!electron || textOf(file) === electron) return Effect.void
    return Effect.try(() => writeFileSync(file, `${electron}\n`)).pipe(
      Effect.catch((error) =>
        Console.error(`banda: ${file} names no Electron: ${error.message}`)
      )
    )
  })

/** Whether `copy` is whole: there, as long as `program`, and beside each
 * file the app carries beside `program` (`BESIDE`, a file or each file of
 * a folder), as long as it. A copy made before the app carried them is
 * not. */
function whole(copy: string, program: string): boolean {
  const carried = BESIDE.flatMap((name) => {
    const packed = join(dirname(program), name)
    const kept = join(dirname(copy), name)
    const kind = kindOf(packed)
    if (kind === "file") return [[kept, packed]]
    if (kind !== "folder") return []
    return readdirSync(packed).map((inner) => [
      join(kept, inner),
      join(packed, inner),
    ])
  })
  return [[copy, program], ...carried].every(([kept, packed]) =>
    sameSize(kept, packed)
  )
}

/** What `path` is: a file, a folder, or nothing there. */
function kindOf(path: string): "file" | "folder" | undefined {
  try {
    return statSync(path).isDirectory() ? "folder" : "file"
  } catch {
    return undefined
  }
}

/** Whether `kept` is there, as long as `packed`. */
function sameSize(kept: string, packed: string): boolean {
  try {
    return statSync(kept).size === statSync(packed).size
  } catch {
    return false
  }
}

/** A file's text, trimmed; none when it cannot be read. */
function textOf(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return undefined
  }
}

/** Runs `work` on the files, its failure an `Uncopied`. */
const attempt = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (error) =>
      new Uncopied({
        message: error instanceof Error ? error.message : String(error),
      }),
  })
