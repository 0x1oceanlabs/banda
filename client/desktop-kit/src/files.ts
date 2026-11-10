/**
 * The byte host, `app://files`, and the sandbox host, `app://preview`
 * (ADR 0073, decision 5), as main relays them to the engine (ADR 0106,
 * decision 6). The page asks the engine of the Pane's session for a
 * token (`bytes.issue`), and a URL names it; main carries the request to
 * that engine's `/b/<token>` or `/p/<token>`, and its answer back as it
 * came. Main reads no file for it, and finds no Project's folder: the
 * engine serves the one file the token was given for, and says how, its
 * type, its ranges and a page's sandbox. The page's rules for the two
 * hosts stay as they were.
 */
import { type IncomingMessage, request as asking } from "node:http"
import { Readable } from "node:stream"
import { Effect } from "effect"
import { Engine } from "./engine"

/** The hosts of `app://` main relays, each by its route on the engine: a
 * file's bytes, in ranges, and a page, into a frame alone. */
const ROUTES: Readonly<Record<string, string>> = { files: "b", preview: "p" }

/**
 * What main passes on of a request: its range, and what tells a frame's
 * navigation from a page's fetch or a picture (the engine's `into_frame`).
 * Nothing else goes, and main adds nothing of its own, as a client that
 * fetches would.
 */
const PASSED = [
  "range",
  "accept",
  "origin",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "upgrade-insecure-requests",
]

/** What a connection says of itself alone, which no relay passes on. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding"])

/** A token, the URL's one part: the engine gives letters and digits. */
const TOKEN = /^\/([\w-]+)$/

const missing = () => new Response("Not found", { status: 404 })

/**
 * Where the engine listening at `address` (its API's `ws://` URL, always
 * on this machine's loopback) serves what `url` names:
 * `app://files/<token>` at its `/b/<token>`, `app://preview/<token>` at
 * its `/p/<token>`, over plain HTTP. None for a URL of another host, or
 * with no token, more parts, a query or a fragment.
 */
export function relayedTo(url: string, address: string): URL | null {
  const asked = new URL(url)
  const route = Object.hasOwn(ROUTES, asked.host) ? ROUTES[asked.host] : null
  const token = TOKEN.exec(asked.pathname)?.[1]
  if (!route || !token || asked.search || asked.hash) return null
  const engine = new URL(address)
  engine.protocol = "http:"
  return new URL(`/${route}/${token}`, engine)
}

/** `answer`, the engine's, as the page's request gets it: its status,
 * its headers but the connection's own, and its body as it comes. */
function relayed(answer: IncomingMessage, head: boolean): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(answer.headers))
    if (value !== undefined && !HOP.has(name))
      for (const one of [value].flat()) headers.append(name, one)
  const status = answer.statusCode ?? 502
  const empty = head || status === 204 || status === 304
  if (empty) answer.resume()
  return new Response(
    empty ? null : (Readable.toWeb(answer) as ReadableStream<Uint8Array>),
    { status, headers }
  )
}

/** What the engine at `to` answers `request`, asked with only what
 * `PASSED` names of its headers. */
function ask(to: URL, request: Request): Promise<Response> {
  const headers: Record<string, string> = {}
  for (const name of PASSED) {
    const value = request.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return new Promise((answered, failed) => {
    const going = asking(to, { method: request.method, headers }, (answer) =>
      answered(relayed(answer, request.method === "HEAD"))
    )
    going.on("error", failed)
    // A request the page gave up, as a video that seeks elsewhere, ends
    // on the engine too.
    request.signal.addEventListener("abort", () => going.destroy(), {
      once: true,
    })
    going.end()
  })
}

/**
 * The answer to `request`, to `app://files` or `app://preview`: this
 * machine's engine's, relayed. A URL that names no token is refused here,
 * and never asked; a method but `GET` and `HEAD` too. While the engine is
 * between runs, the request waits till it listens again; an engine that
 * refuses the connection gives 502, which the page takes for a URL that
 * broke. Main puts no time limit on an answer, since a video's flows as
 * long as it plays: a request waits till the engine answers, or till the
 * page gives it up.
 */
export const relay = (request: Request) =>
  Effect.gen(function* () {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 })
    const address = yield* Engine.use((engine) => engine.address)
    const to = relayedTo(request.url, address.url)
    if (!to) return missing()
    return yield* Effect.tryPromise(() => ask(to, request)).pipe(
      Effect.catch(() =>
        Effect.succeed(
          new Response("The engine did not answer", { status: 502 })
        )
      )
    )
  })
