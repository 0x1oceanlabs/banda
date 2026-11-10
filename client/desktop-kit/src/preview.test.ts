/**
 * The sandbox host's relay (ADR 0106, step 4b): `app://preview/<token>`
 * goes to the engine's `/p/<token>` with what tells a frame's navigation
 * from a page's fetch, as the frame or the page asked it, so the engine
 * serves a page into a frame alone (its `into_frame`); main says nothing
 * of its own there, and the engine's sandbox comes back as it gave it.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Engine } from "./engine"
import { relay } from "./files"

/** The engine's sandbox for a page, as it says it. */
const SANDBOX =
  "default-src 'none'; img-src app://files data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts"

/** What a frame's navigation sends to Electron's handler, which hears no
 * `Sec-Fetch-*`. */
const FRAME = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "upgrade-insecure-requests": "1",
}

let engine: Server
/** The path and the headers of each request the fake engine heard. */
let heard: { path: string; headers: IncomingHttpHeaders }[]

beforeEach(async () => {
  heard = []
  engine = createServer((request, response) => {
    heard.push({ path: request.url!, headers: request.headers })
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SANDBOX,
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
    })
    response.end("<p>hi</p>")
  })
  await new Promise<void>((done) => engine.listen(0, "127.0.0.1", done))
})
afterEach(async () => {
  await new Promise((done) => engine.close(done))
})

const at = () =>
  Layer.succeed(Engine)({
    address: Effect.sync(() => ({
      url: `ws://127.0.0.1:${(engine.address() as AddressInfo).port}/ws`,
      secret: "unused",
    })),
    client: Effect.die("unused"),
    door: Effect.die("unused"),
  })

/** What the engine heard of a request to `url` with `headers`, but where
 * it went and Node's connection; and what main answered. */
const asked = (url: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const response = yield* relay(new Request(url, { headers }))
    const body = yield* Effect.promise(() => response.text())
    const passed = { ...heard.at(-1)!.headers }
    delete passed.host
    delete passed.connection
    return { path: heard.at(-1)!.path, passed, response, body }
  })

it.effect(
  "a frame's navigation reaches the engine's /p/ as the frame asked it, and the page comes back sandboxed as the engine said",
  () =>
    Effect.gen(function* () {
      const shown = yield* asked("app://preview/f00d", FRAME)
      expect(shown.path).toBe("/p/f00d")
      // No origin and an upgrade asked: the engine takes it for a frame.
      expect(shown.passed).toEqual(FRAME)
      expect(shown.body).toBe("<p>hi</p>")
      const { headers } = shown.response
      expect(headers.get("content-security-policy")).toBe(SANDBOX)
      expect(headers.get("cross-origin-resource-policy")).toBe("same-origin")
      expect(headers.get("referrer-policy")).toBe("no-referrer")
      expect(headers.get("access-control-allow-origin")).toBeNull()
    }).pipe(Effect.provide(at()))
)

it.effect(
  "Banda's page, a picture or a window says what it is to the engine, which serves a frame alone; main adds no Sec-Fetch of its own",
  () =>
    Effect.gen(function* () {
      const all: Record<string, string>[] = [
        // Banda's page fetching it, or a picture of it.
        { accept: "*/*", origin: "app://banda" },
        { ...FRAME, origin: "app://banda" },
        { accept: "image/*" },
        // Where Chromium says what for: a page's fetch, a window's page, a
        // frame.
        { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
        {
          ...FRAME,
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
        { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
        // Who says nothing.
        {},
      ]
      for (const headers of all) {
        const { path, passed } = yield* asked("app://preview/f00d", headers)
        expect(path).toBe("/p/f00d")
        expect(passed, JSON.stringify(headers)).toEqual(headers)
      }
    }).pipe(Effect.provide(at()))
)

it.effect(
  "each host keeps its route: a token in a file's URL goes to /b/, in a page's to /p/",
  () =>
    Effect.gen(function* () {
      expect((yield* asked("app://files/f00d", FRAME)).path).toBe("/b/f00d")
      expect((yield* asked("app://preview/f00d", FRAME)).path).toBe("/p/f00d")
    }).pipe(Effect.provide(at()))
)
