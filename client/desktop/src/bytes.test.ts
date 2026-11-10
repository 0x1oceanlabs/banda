/**
 * A file's bytes by the machine that has them (ADR 0106, step 4c): a URL
 * goes to the engine of the machine it names, through a fake of `Hosts`
 * that says where its forward listens now. Fake engines stand in, and
 * say what they heard.
 */
import { createServer, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import type { Address } from "@banda/contract"
import { Engine, Refused } from "@banda/desktop-kit"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { relayed } from "./bytes"
import { Hosts } from "./hosts"

/** A fake engine: what it heard, and how it answers. */
type Fake = {
  server: Server
  heard: string[]
  answer: (response: ServerResponse) => void
  address: () => Address
}

const whole = (body: string) => (response: ServerResponse) => {
  response.writeHead(200, { "content-type": "image/png" })
  // In pieces, as an engine reads a file a piece at a time.
  response.write(body.slice(0, 2))
  response.end(body.slice(2))
}

async function fakeEngine(body: string): Promise<Fake> {
  const fake: Fake = {
    heard: [],
    answer: whole(body),
    server: createServer((request, response) => {
      fake.heard.push(request.url!)
      fake.answer(response)
    }),
    address: () => ({
      url: `ws://127.0.0.1:${(fake.server.address() as AddressInfo).port}/ws`,
      secret: "unused",
    }),
  }
  await new Promise<void>((done) => fake.server.listen(0, "127.0.0.1", done))
  return fake
}

let here: Fake
let arc: Fake

beforeEach(async () => {
  here = await fakeEngine("this machine's")
  arc = await fakeEngine("arc's bytes")
})
afterEach(async () => {
  for (const fake of [here, arc]) {
    fake.server.closeAllConnections()
    await new Promise((done) => fake.server.close(done))
  }
})

/** Main's engine, the fake of this machine's. */
const hereLayer = () =>
  Layer.succeed(Engine)({
    address: Effect.sync(() => here.address()),
    client: Effect.die("unused"),
    door: Effect.die("unused"),
  })

/** Main's hosts: `address` as the test says, arc's by default, each
 * machine but arc refused. */
const hostsLayer = ({
  address = (name) =>
    name === "arc"
      ? Effect.sync(() => arc.address())
      : Effect.fail(new Refused({ message: `There is no host ${name}` })),
}: {
  address?: (name: string) => Effect.Effect<Address, Refused>
} = {}) =>
  Layer.succeed(Hosts)({
    address,
    current: Effect.die("unused"),
    changes: Stream.die("unused"),
    start: () => Effect.die("unused"),
    add: () => Effect.die("unused"),
    set: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    test: () => Effect.die("unused"),
    stop: () => Effect.die("unused"),
    suggestions: Effect.die("unused"),
  })

const main = (hosts = hostsLayer()) => Layer.merge(hereLayer(), hosts)

/** What main answers `url`, asked with `init`. */
const asked = (url: string, init?: RequestInit) =>
  relayed(new Request(url, init)).pipe(
    Effect.flatMap((response) =>
      Effect.promise(async () => ({
        status: response.status,
        body: await response.text(),
      }))
    )
  )

it.effect(
  "a URL that names a machine goes to that machine's engine through its forward, and one that names none to this machine's",
  () =>
    Effect.gen(function* () {
      expect(yield* asked("app://files/arc/t1")).toEqual({
        status: 200,
        body: "arc's bytes",
      })
      expect(arc.heard).toEqual(["/b/t1"])
      expect(here.heard).toEqual([])

      yield* asked("app://preview/arc/p1")
      expect(arc.heard).toEqual(["/b/t1", "/p/p1"])
      expect(here.heard).toEqual([])

      expect((yield* asked("app://files/t2")).body).toBe("this machine's")
      expect(here.heard).toEqual(["/b/t2"])
      expect(arc.heard).toHaveLength(2)
    }).pipe(Effect.provide(main()))
)

it.effect(
  "a link goes on working when ssh comes back on a new port: the address is asked each time",
  () =>
    Effect.gen(function* () {
      let forward = arc
      const hosts = hostsLayer({
        address: () => Effect.sync(() => forward.address()),
      })
      yield* Effect.gen(function* () {
        expect((yield* asked("app://files/arc/t1")).status).toBe(200)
        const next = yield* Effect.promise(() => fakeEngine("arc again"))
        const was = forward
        forward = next
        yield* Effect.promise(
          () => new Promise((done) => was.server.close(done))
        )
        expect(yield* asked("app://files/arc/t1")).toEqual({
          status: 200,
          body: "arc again",
        })
        expect(next.heard).toEqual(["/b/t1"])
        arc = forward
      }).pipe(Effect.provide(main(hosts)))
    })
)

it.effect(
  "a machine that is not known or is refused gives 502, and no engine hears of it",
  () =>
    Effect.gen(function* () {
      expect((yield* asked("app://files/nope/t1")).status).toBe(502)
      expect(arc.heard).toEqual([])
      expect(here.heard).toEqual([])
    }).pipe(Effect.provide(main()))
)

it.effect(
  "a URL of a machine that is away waits, and goes once the machine is back",
  () =>
    Effect.gen(function* () {
      const back = yield* Deferred.make<Address>()
      const hosts = hostsLayer({ address: () => Deferred.await(back) })
      yield* Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(asked("app://files/arc/t1"))
        yield* Effect.yieldNow
        expect(arc.heard).toEqual([])
        yield* Deferred.succeed(back, arc.address())
        expect((yield* Fiber.join(waiting)).body).toBe("arc's bytes")
      }).pipe(Effect.provide(main(hosts)))
    })
)

it.effect(
  "a request the page gave up while its machine was away ends, and no engine hears of it once the machine is back",
  () =>
    Effect.gen(function* () {
      const back = yield* Deferred.make<Address>()
      const hosts = hostsLayer({ address: () => Deferred.await(back) })
      yield* Effect.gen(function* () {
        const page = new AbortController()
        const waiting = yield* Effect.forkChild(
          asked("app://files/arc/t1", { signal: page.signal })
        )
        yield* Effect.yieldNow
        page.abort()
        expect((yield* Fiber.join(waiting)).status).toBe(502)
        yield* Deferred.succeed(back, arc.address())
        yield* Effect.yieldNow
        expect(arc.heard).toEqual([])
      }).pipe(Effect.provide(main(hosts)))
    })
)
