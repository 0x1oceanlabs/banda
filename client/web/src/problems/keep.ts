/**
 * The page's Problems (ADR 0039, decision 1): what breaks in it, thrown
 * and not caught, or caught by an error boundary, is kept by the problems
 * module. It sends nothing anywhere; the engine keeps it on this computer.
 */
import type { Engine } from "@banda/contract"
import {
  fromRoot,
  keeper,
  type MapOf,
  type Own,
  recordOf,
} from "@banda/contract/problems"

/** What the browser says that is not a fault: a ResizeObserver whose
 * callback changed sizes again. */
const NOT_FAULT = /^ResizeObserver loop/

let keep: ReturnType<typeof keeper> | undefined

/** Keeps what breaks in the page from now on, in `engine`'s problems
 * module. */
export function watchProblems(engine: Engine): void {
  keep = keeper((record) => engine.command("problems.record", record))
  window.addEventListener("error", (event) =>
    keepProblem(event.error ?? event.message)
  )
  window.addEventListener("unhandledrejection", (event) =>
    keepProblem(event.reason)
  )
}

/** Keeps `thrown` as a Problem of the page. */
export function keepProblem(thrown: unknown): void {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  if (keep && !NOT_FAULT.test(message))
    void recordOf(thrown, "page", own, mapOf).then(keep)
}

/** A built script's map, beside it; none from the dev server. */
const mapOf: MapOf = (script) =>
  fetch(`${script}.map`).then((response) =>
    response.ok ? response.json() : null
  )

/**
 * A script of this page's, as the repository names it: from the dev
 * server, `/src/…` (client/web's) or `/@fs/<repository>/…`, and as a built
 * script's map names its sources, `/src/…`, `/apps/…` or `/platform/…`;
 * a built script with no map, the bundle's name without its hash. A
 * library's or another origin's is none.
 */
export const own: Own = (script) => {
  let url: URL
  try {
    url = new URL(script)
  } catch {
    return null
  }
  const path = decodeURIComponent(url.pathname)
  // By scheme and host: a custom scheme's origin may be "null".
  const here = url.protocol === location.protocol && url.host === location.host
  if (!here || path.includes("/node_modules/")) return null
  if (path.startsWith("/src/")) return `client/web${path}`
  return (
    fromRoot(path) ?? path.replace(/^\//, "").replace(/-[\w-]{8}(\.\w+)$/, "$1")
  )
}
