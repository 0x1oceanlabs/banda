/**
 * The `banda` the window runs: the engine, the look and the settings
 * (ADR 0086, decision 2). A packed Banda runs its own copy of it, never
 * the one inside its AppImage or its app: an AppImage's folder goes away
 * as it stops, and whatever still runs from there dies, as `banda serve`
 * and `banda look --follow` did.
 *
 * The copy is `<data>/engine/<version>/banda`, beside `version`, which
 * holds what the program's `--version` says: its version and its build
 * id. It is written into a folder of its own, run once with `--version`,
 * and renamed into place only when it says the same, so a half-written
 * copy, or one that does not start, is never run. A copy in place is run
 * again while it is of the window's build, as long as the program, and
 * says so when it is run; one that goes while the window runs is made
 * again before the next run. The last two versions are kept; an older
 * one goes once no program runs from it.
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
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
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
  Semaphore,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** The file beside a copy that says what its `--version` said. */
const VERSION = "version"
/** A version that names a folder: no slash, no leading dot. */
const PLAIN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/
/** How long `banda --version` may take before it counts as broken. */
const WAIT = "10 seconds"

/** The `banda` the window has, and the folder it keeps its copies of it
 * in, when it runs a copy. */
export type Where = { readonly program: string; readonly copies?: string }

/** Where the window's `banda` is: a trial's, `named`; a checkout's, with
 * no `resources`; else the one packed in `resources`, copied into `data`
 * unless a package manager owns it. */
export function whereOf(options: {
  readonly named: string | undefined
  readonly checkout: string
  readonly resources: string | undefined
  readonly data: string
}): Where {
  if (options.named) return { program: options.named }
  if (!options.resources) return { program: options.checkout }
  const program = join(options.resources, "banda")
  if (existsSync(join(options.resources, "package-type"))) return { program }
  return { program, copies: join(options.data, "engine") }
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
        const copied = ownCopy(where.program, folder).pipe(
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
 * is put in place. */
export const ownCopy = (program: string, folder: string) =>
  Effect.gen(function* () {
    const said = yield* versionOf(program)
    const version = /^banda (\S+)/.exec(said)?.[1]
    if (!version || !PLAIN.test(version))
      return yield* new Uncopied({
        message: `${program} --version said ${JSON.stringify(said)}`,
      })
    const kept = join(folder, version)
    const copy = join(kept, "banda")
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
      const copied = yield* versionOf(join(fresh, "banda"))
      if (copied !== said)
        return yield* new Uncopied({
          message: `its copy said ${JSON.stringify(copied)}, not ${JSON.stringify(said)}`,
        })
      yield* attempt(() => putInPlace(fresh, kept))
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
const versionOf = (program: string) =>
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
 * beside it (`banda.dSYM`, on macOS), and `said` as its version. Its
 * bytes are written, not the file copied, so what the system marks a
 * download with stays on the app. */
async function copyInto(program: string, fresh: string, said: string) {
  await writeFile(join(fresh, "banda"), await readFile(program), {
    mode: 0o755,
    flush: true,
  })
  const tables = `${program}.dSYM`
  if (existsSync(tables))
    await cp(tables, join(fresh, "banda.dSYM"), { recursive: true })
  await writeFile(join(fresh, VERSION), `${said}\n`, { flush: true })
}

/** Renames `fresh` to `kept`. A copy already there, of another build of
 * the same version, is moved aside first, and goes as an old one does. */
async function putInPlace(fresh: string, kept: string) {
  if (existsSync(kept)) await rename(kept, `${fresh}-old`)
  await rename(fresh, kept)
}

/** Removes the old copies from `folder` (`prune`), apart from the start:
 * nothing waits for it, and it never stops the window. */
const leaveTwo = (folder: string, kept: string) =>
  Effect.try(() => prune(folder, kept, runningPrograms())).pipe(
    Effect.catch((error) =>
      Console.error(`banda: the engine's old copies stay: ${error.message}`)
    )
  )

/**
 * Removes every copy in `folder` but `kept` and the newest other one, and
 * any dot-folder a failed or replaced copy left, unless a program in
 * `running` runs from inside it, by its path as given or its real path.
 * When what runs is not known, nothing is removed. Returns what it
 * removed.
 */
export function prune(
  folder: string,
  kept: string,
  running: readonly string[] | undefined
): string[] {
  if (!running) return []
  const folders = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(folder, entry.name))
  const leftover = (path: string) => basename(path).startsWith(".")
  const copies = folders
    .filter((path) => !leftover(path) && path !== kept)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  const idle = (path: string) => {
    const inside = [path, realpathSync(path)].map((at) => at + sep)
    return !running.some((program) =>
      inside.some((at) => program.startsWith(at))
    )
  }
  const old = [...copies.slice(1), ...folders.filter(leftover)].filter(idle)
  for (const path of old) rmSync(path, { recursive: true, force: true })
  return old
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

/** Whether `copy` is there, as long as `program`. */
function whole(copy: string, program: string): boolean {
  try {
    return statSync(copy).size === statSync(program).size
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
