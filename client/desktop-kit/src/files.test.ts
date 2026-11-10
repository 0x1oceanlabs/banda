/**
 * The byte host's relay (ADR 0106, step 4b): `app://files/<token>` goes to
 * the engine's `/b/<token>`, as the page asked it, and comes back as the
 * engine answered. A fake engine stands in, and says what it heard.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Engine } from "./engine"
import { namedBy, relay, relayedTo } from "./files"

/** What the fake engine heard: each request's method, path and headers. */
type Heard = { method: string; path: string; headers: IncomingHttpHeaders }

let engine: Server
let heard: Heard[]
/** How the fake engine answers a path. */
type Answer = (path: string) => {
  status: number
  headers: Record<string, string>
  body: string[]
}
/** How it answers now; the bytes of a clip in a range, at first. */
let answer: Answer

beforeEach(async () => {
  heard = []
  answer = () => ({
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 3-6/10",
      "content-length": "4",
      "accept-ranges": "bytes",
      "content-security-policy": "default-src 'none'; sandbox",
      "access-control-allow-origin": "*",
    },
    body: ["34", "56"],
  })
  engine = createServer((request, response) => {
    heard.push({
      method: request.method!,
      path: request.url!,
      headers: request.headers,
    })
    const { status, headers, body } = answer(request.url!)
    response.writeHead(status, headers)
    // In pieces, as the engine reads a file a piece at a time.
    for (const piece of body) response.write(piece)
    response.end()
  })
  await new Promise<void>((done) => engine.listen(0, "127.0.0.1", done))
})
afterEach(async () => {
  await new Promise((done) => engine.close(done))
})

/** Main's engine, at the fake's address, or at `port`. */
const at = (port?: number) =>
  Layer.succeed(Engine)({
    address: Effect.sync(() => ({
      url: `ws://127.0.0.1:${port ?? (engine.address() as AddressInfo).port}/ws`,
      secret: "unused",
    })),
    client: Effect.die("unused"),
    door: Effect.die("unused"),
  })

/** What main answers `url`, asked with `init`. */
const relayed = (url: string, init?: RequestInit) =>
  relay(new Request(url, init), () =>
    Engine.use((engine) => engine.address)
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise(async () => ({
        status: response.status,
        headers: response.headers,
        body: await response.text(),
      }))
    )
  )

it.effect(
  "a file's URL goes to the engine's /b/ with its range, and comes back as the engine answered it",
  () =>
    Effect.gen(function* () {
      const shown = yield* relayed("app://files/a1b2c3", {
        headers: { range: "bytes=3-6" },
      })
      expect(heard).toHaveLength(1)
      expect(heard[0]).toMatchObject({ method: "GET", path: "/b/a1b2c3" })
      expect(heard[0]!.headers.range).toBe("bytes=3-6")
      expect(shown.status).toBe(206)
      expect(shown.body).toBe("3456")
      expect(shown.headers.get("content-type")).toBe("video/mp4")
      expect(shown.headers.get("content-range")).toBe("bytes 3-6/10")
      expect(shown.headers.get("content-length")).toBe("4")
      expect(shown.headers.get("content-security-policy")).toBe(
        "default-src 'none'; sandbox"
      )
      expect(shown.headers.get("access-control-allow-origin")).toBe("*")
      // What the engine said of its connection is its own.
      expect(shown.headers.get("connection")).toBeNull()

      // A HEAD asks the length alone.
      answer = () => ({
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "10" },
        body: [],
      })
      const head = yield* relayed("app://files/a1b2c3", { method: "HEAD" })
      expect(heard[1]).toMatchObject({ method: "HEAD", path: "/b/a1b2c3" })
      expect(head.status).toBe(200)
      expect(head.headers.get("content-length")).toBe("10")
      expect(head.body).toBe("")
    }).pipe(Effect.provide(at()))
)

it.effect(
  "the engine's refusal comes back as it said it: a wrong or ended token is not found, a range past the end unmet",
  () =>
    Effect.gen(function* () {
      answer = (path): ReturnType<Answer> =>
        path.endsWith("/ended")
          ? { status: 404, headers: {}, body: ["Not found"] }
          : {
              status: 416,
              headers: { "content-range": "bytes */10" },
              body: [],
            }
      const ended = yield* relayed("app://files/ended")
      expect([ended.status, ended.body]).toEqual([404, "Not found"])
      const past = yield* relayed("app://files/a1", {
        headers: { range: "bytes=10-" },
      })
      expect(past.status).toBe(416)
      expect(past.headers.get("content-range")).toBe("bytes */10")
    }).pipe(Effect.provide(at()))
)

it.effect(
  "a URL that names no token, and a method but GET and HEAD, are refused in main and never reach the engine",
  () =>
    Effect.gen(function* () {
      for (const url of [
        "app://files/",
        "app://files/a/b/c",
        "app://files/A/b",
        "app://files/a?b=c",
        "app://files/a#b",
        "app://files/a.b",
        "app://files/%2e%2e%2fws",
        "app://banda/a1",
        "app://visuals/a1",
      ])
        expect((yield* relayed(url)).status, url).toBe(404)
      for (const method of ["POST", "PUT", "DELETE", "OPTIONS"])
        expect(
          (yield* relayed("app://files/a1", { method })).status,
          method
        ).toBe(405)
      expect(heard).toEqual([])
    }).pipe(Effect.provide(at()))
)

it.effect(
  "main passes the range and what tells a frame, and nothing of its own: no cookie, no agent, no sign-in",
  () =>
    Effect.gen(function* () {
      yield* relayed("app://files/a1", {
        headers: {
          range: "bytes=0-",
          origin: "app://banda",
          cookie: "session=1",
          authorization: "Bearer secret",
          "user-agent": "Banda",
          "x-other": "yes",
        },
      })
      // Node's own: where it goes, and how its connection is kept.
      const { host, connection, ...passed } = heard[0]!.headers
      expect(host).toMatch(/^127\.0\.0\.1:\d+$/)
      expect(connection).toBeDefined()
      expect(passed).toEqual({ range: "bytes=0-", origin: "app://banda" })
    }).pipe(Effect.provide(at()))
)

it.effect("an engine that does not answer gives 502", () =>
  Effect.gen(function* () {
    // A port that listened a moment ago, and listens no more.
    const port = yield* Effect.promise(
      () =>
        new Promise<number>((done) => {
          const gone = createServer().listen(0, "127.0.0.1", () => {
            const { port } = gone.address() as AddressInfo
            gone.close(() => done(port))
          })
        })
    )
    const shown = yield* relayed("app://files/a1").pipe(
      Effect.provide(at(port))
    )
    expect(shown.status).toBe(502)
  })
)

it("each host goes to its own route on the engine, over http", () => {
  const ws = "ws://127.0.0.1:4321/ws"
  expect(relayedTo(namedBy("app://files/ab-c_1")!, ws).href).toBe(
    "http://127.0.0.1:4321/b/ab-c_1"
  )
  expect(relayedTo(namedBy("app://preview/ab")!, ws).href).toBe(
    "http://127.0.0.1:4321/p/ab"
  )
  expect(namedBy("app://banda/index.html")).toBeNull()
})

it("a URL names the machine that gave its token, or none for this machine's", () => {
  expect(namedBy("app://files/ab")).toEqual({
    machine: null,
    route: "b",
    token: "ab",
  })
  expect(namedBy("app://files/arc-2/ab")).toEqual({
    machine: "arc-2",
    route: "b",
    token: "ab",
  })
  expect(namedBy("app://preview/arc/ab")).toEqual({
    machine: "arc",
    route: "p",
    token: "ab",
  })
})
