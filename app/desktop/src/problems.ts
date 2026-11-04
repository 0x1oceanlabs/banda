/**
 * The window's Problems and its log (ADR 0039, decision 1). What breaks
 * in main, thrown and not caught, and a process of Banda's that crashed
 * are kept by the problems module; Electron's crash dumps stay in the
 * problems' folder and go nowhere. Main's console, and the page's
 * warnings and errors, go to `window.log` too, beside the engine's.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { format } from "node:util"
import {
  fromRoot,
  keeper,
  type MapOf,
  type Record,
  recordOf,
} from "@banda/contract/problems"
import { app, crashReporter, type WebContents } from "electron"

/** The most a log grows to before it starts again, as the engine's. */
const LOG_MOST = 4 << 20

/**
 * A log file for this user alone that, past {@link LOG_MOST}, is kept as
 * `<name>.1.log` and starts again, as it opens and while it runs.
 */
export class Rolling {
  readonly path: string
  #fd: number
  #size: number

  constructor(path: string) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
    this.#fd = openSync(path, "a", 0o600)
    this.#size = statSync(path).size
  }

  write(line: string): void {
    if (this.#size > LOG_MOST) {
      closeSync(this.#fd)
      renameSync(this.path, this.path.replace(/\.log$/, ".1.log"))
      this.#fd = openSync(this.path, "a", 0o600)
      this.#size = 0
    }
    this.#size += writeSync(this.#fd, line)
  }
}

const LEVELS = ["log", "info", "warn", "error"] as const

/**
 * Keeps the crash dumps in `state`'s problems folder, uploaded nowhere,
 * and main's console in `window.log` too, with the warnings and errors of
 * the pages `banda` says are Banda's. It runs before the app is ready, as
 * Electron's crash reporter asks.
 */
export function startLog(
  state: string,
  banda: (contents: WebContents) => boolean
): void {
  app.setPath("crashDumps", join(state, "problems", "crashes"))
  crashReporter.start({ uploadToServer: false })
  let log: Rolling
  try {
    log = new Rolling(join(state, "logs", "window.log"))
  } catch (error) {
    console.error("banda: window.log:", error)
    return
  }
  for (const level of LEVELS) {
    const said = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      said(...args)
      written(log, level, format(...args))
    }
  }
  app.on("web-contents-created", (_event, contents) => {
    // A browser's pages are the sites', not Banda's.
    if (contents.getType() === "webview") return
    contents.on("console-message", (event) => {
      if (event.level !== "warning" && event.level !== "error") return
      // A page's address is known once it loads, not as it is made.
      if (!banda(contents)) return
      const at = `${event.sourceId}:${event.lineNumber}`
      written(log, `page ${event.level}`, `${event.message} (${at})`)
    })
  })
}

function written(log: Rolling, level: string, text: string): void {
  try {
    log.write(`${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`)
  } catch {
    // A log that cannot be written is not a Problem of its own.
  }
}

/**
 * Keeps main's Problems with `send` from now on: what is thrown and not
 * caught, a page of Banda's whose process ended badly, and a helper
 * process that crashed. `banda` tells Banda's own pages from the
 * browser's.
 */
export function watchProblems(
  send: (record: Record) => Promise<unknown>,
  banda: (contents: WebContents) => boolean
): void {
  const keep = keeper(send)
  const thrown = (error: unknown) => {
    console.error("banda: main:", error)
    void recordOf(error, "main", own, mapOf).then(keep)
  }
  process.on("uncaughtException", thrown)
  process.on("unhandledRejection", thrown)
  app.on("render-process-gone", (_event, contents, details) => {
    if (details.reason === "clean-exit" || !banda(contents)) return
    keep(
      crash(
        details.reason,
        `The page's process ended: ${details.reason}, code ${details.exitCode}`
      )
    )
  })
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || details.reason === "killed") return
    const name = details.name ?? details.serviceName ?? details.type
    keep(
      crash(
        details.reason,
        `The ${name} process ended: ${details.reason}, code ${details.exitCode}`
      )
    )
  })
}

const crash = (reason: string, message: string): Record => ({
  source: "crash",
  kind: reason,
  message,
  frames: [],
})

/**
 * A script of main's, as the repository names it: as its bundle's map
 * names its sources, or the bundle, in a checkout's path, or in a
 * packaged app's archive as `app/desktop`'s.
 */
function own(script: string): string | null {
  const path = script.replace(/^file:\/\//, "")
  if (path.startsWith("node:") || path.includes("/node_modules/")) return null
  const packaged = /\/app\.asar\/(.*)$/.exec(path)
  return fromRoot(path) ?? (packaged ? `app/desktop/${packaged[1]}` : null)
}

/** The map beside main's bundle (build.mjs), read as a Problem is kept. */
const mapOf: MapOf = async (script) =>
  JSON.parse(
    await readFile(
      `${script.startsWith("file:") ? fileURLToPath(script) : script}.map`,
      "utf8"
    )
  )
