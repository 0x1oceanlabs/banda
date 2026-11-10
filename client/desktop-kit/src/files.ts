/**
 * The byte host, `app://files`, and the sandbox host, `app://preview`
 * (ADR 0073, decision 5), as main relays them to the engine that gave
 * their tokens (ADR 0106, decision 6). The page asks the engine of the
 * Pane's session for a token (`bytes.issue`), and a URL names it, and
 * the machine it came from when that is not this one; main carries the
 * request to that engine's `/b/<token>` or `/p/<token>`, and its answer
 * back as it came. Main reads no file for it, and finds no Project's
 * folder: the engine serves the one file the token was given for, and
 * says how, its type, its ranges and a page's sandbox. The page's rules
 * for the two hosts stay as they were.
 */
import { type IncomingMessage, request as asking } from "node:http"
import { Readable } from "node:stream"
import type { Address } from "@banda/contract"
import { Effect } from "effect"

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

/** A URL's path: a token, which the engine gives in letters and digits,
 * and before it the machine that gave it, when that is not this one, in
 * the letters a name in `hosts.toml` takes. */
const NAMED = /^\/(?:([a-z0-9-]+)\/)?([\w-]+)$/

const missing = () => new Response("Not found", { status: 404 })

/** What a URL of the two hosts names. */
export type Named = {
  /** This device's name for the machine whose engine gave the token, as
   * `hosts.toml` says it; none for this machine. It means nothing past
   * this device, which is why no URL is ever kept (ADR 0106, law 2). */
  machine: string | null
  /** The engine's route for it: `b`, a file's bytes, or `p`, a page. */
  route: string
  token: string
}

/**
 * What `url` names: `app://files/<token>` and `app://preview/<token>` a
 * token of this machine's engine, and `app://files/<machine>/<token>` and
 * `app://preview/<machine>/<token>` one of that machine's. None for a URL
 * of another host, or with no token, more parts, a query or a fragment.
 */
export function namedBy(url: string): Named | null {
  if (!URL.canParse(url)) return null
  const asked = new URL(url)
  const route = Object.hasOwn(ROUTES, asked.host) ? ROUTES[asked.host] : null
  const [, machine = null, token] = NAMED.exec(asked.pathname) ?? []
  if (!route || !token || asked.search || asked.hash) return null
  return { machine, route, token }
}

/** Where the engine listening at `address` (its API's `ws://` URL, always
 * on this machine's loopback, through its forward for another machine's)
 * serves `named`, over plain HTTP. */
export function relayedTo(named: Named, address: string): URL {
  const engine = new URL(address)
  engine.protocol = "http:"
  return new URL(`/${named.route}/${named.token}`, engine)
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

/** What the engine at `address` answers a plain `GET` of `named`, its
 * body as it comes. */
export const askedOf = (named: Named, address: string): Promise<Response> => {
  const to = relayedTo(named, address)
  return ask(to, new Request(to))
}

/** Fails once the page gives `request` up. */
const givenUp = (request: Request) =>
  Effect.callback<never, Error>((resume) => {
    const gone = () => resume(Effect.fail(new Error("The page gave it up")))
    if (request.signal.aborted) gone()
    else request.signal.addEventListener("abort", gone, { once: true })
    return Effect.sync(() => request.signal.removeEventListener("abort", gone))
  })

/**
 * The answer to `request`, to `app://files` or `app://preview`: the
 * engine's that gave its token, relayed, wherever `addressOf` says it
 * listens now, so a link goes on working when ssh comes back on a new
 * port. A URL that names no token is refused here, and never asked; a
 * method but `GET` and `HEAD` too. While `addressOf` waits, as for an
 * engine between runs or a machine that is away, the request waits, till
 * the page gives it up, when no engine hears of it; one `addressOf` fails
 * for, and an engine that refuses the connection, give 502, which the
 * page takes for a URL that broke. Main puts no time limit on an answer,
 * since a video's flows as long as it plays.
 */
export const relay = <E, R>(
  request: Request,
  addressOf: (machine: string | null) => Effect.Effect<Address, E, R>
) =>
  Effect.gen(function* () {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 })
    const named = namedBy(request.url)
    if (!named) return missing()
    return yield* addressOf(named.machine).pipe(
      Effect.raceFirst(givenUp(request)),
      Effect.flatMap((address) =>
        Effect.tryPromise(() => ask(relayedTo(named, address.url), request))
      ),
      Effect.catch(() =>
        Effect.succeed(
          new Response("The engine did not answer", { status: 502 })
        )
      )
    )
  })
