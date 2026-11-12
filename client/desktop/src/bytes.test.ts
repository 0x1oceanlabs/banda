/**
 * A file's bytes by the machine that has them (ADR 0106, step 4c): a URL
 * goes to the engine of the machine it names, through a fake of `Hosts`
 * that says where its forward listens now. Fake engines stand in, and
 * say what they heard.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import type { Address } from "@banda/contract"
import { Engine, Refused } from "@banda/desktop-kit"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { relayed, relayedAs, saveCopy } from "./bytes"
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
/** Where the Person's copies land, for the saves. */
let folder: string

beforeEach(async () => {
  here = await fakeEngine("this machine's")
  arc = await fakeEngine("arc's bytes")
  folder = mkdtempSync(join(tmpdir(), "banda-bytes-"))
})
afterEach(async () => {
  for (const fake of [here, arc]) {
    fake.server.closeAllConnections()
    await new Promise((done) => fake.server.close(done))
  }
  rmSync(folder, { recursive: true, force: true })
})

/** Main's engine, the fake of this machine's. */
const hereLayer = () =>
  Layer.succeed(Engine)({
    address: Effect.sync(() => here.address()),
    client: Effect.die("unused"),
    door: Effect.die("unused"),
  })

/** Main's hosts: `addressWhenBack` and `addressNow` as the test says, arc's
 * by default, each machine but arc refused. `address` would have a refused
 * machine tried again, which a read of bytes never does. */
const hostsLayer = ({
  addressWhenBack = (name) =>
    name === "arc"
      ? Effect.sync(() => arc.address())
      : Effect.fail(new Refused({ message: `There is no host ${name}` })),
  addressNow = (name) =>
    Effect.sync(() => (name === "arc" ? arc.address() : undefined)),
}: {
  addressWhenBack?: (name: string) => Effect.Effect<Address, Refused>
  addressNow?: (name: string) => Effect.Effect<Address | undefined>
} = {}) =>
  Layer.succeed(Hosts)({
    address: () => Effect.die("unused"),
    addressNow,
    addressWhenBack,
    current: Effect.die("unused"),
    changes: Stream.die("unused"),
    start: () => Effect.die("unused"),
    add: () => Effect.die("unused"),
    set: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    test: () => Effect.die("unused"),
    stop: () => Effect.die("unused"),
    suggestions: Effect.die("unused"),
    install: () => Effect.die("unused"),
    cancelInstall: () => Effect.die("unused"),
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
  "a module's host asks the sandbox host for a page of its own, as its frame's request was asked, from the machine the URL names",
  () =>
    Effect.gen(function* () {
      // A Visual's frame asks `app://visuals/…`; its page is arc's `/p/`.
      const frame = new Request("app://visuals/of/arc/p1", {
        headers: { "sec-fetch-dest": "iframe" },
      })
      let said: string | undefined
      arc.answer = (response) => {
        said = response.req.headers["sec-fetch-dest"] as string
        whole("arc's page")(response)
      }
      const answer = yield* relayedAs(frame, "app://preview/arc/p1")
      expect(answer.status).toBe(200)
      expect(yield* Effect.promise(() => answer.text())).toBe("arc's page")
      expect(arc.heard).toEqual(["/p/p1"])
      expect(said).toBe("iframe")
      expect(here.heard).toEqual([])
      // The request's own URL names nothing the two hosts serve.
      expect((yield* relayed(frame)).status).toBe(404)
    }).pipe(Effect.provide(main()))
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
        addressWhenBack: () => Effect.sync(() => forward.address()),
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
      const hosts = hostsLayer({ addressWhenBack: () => Deferred.await(back) })
      yield* Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(asked("app://files/arc/t1"))
        yield* Effect.yieldNow
        expect(arc.heard).toEqual([])
        yield* Deferred.succeed(back, arc.address())
        expect((yield* Fiber.join(waiting)).body).toBe("arc's bytes")
      }).pipe(Effect.provide(main(hosts)))
    })
)

/** The dialog, faked: where the Person picks, what it was offered, and
 * `meanwhile`, what happens while it is open. */
const dialog = (path: string | null, meanwhile?: () => void) => {
  const offered: string[] = []
  const pick = (name: string) =>
    Effect.sync(() => {
      offered.push(name)
      meanwhile?.()
      return path
    })
  return { offered, pick }
}

/** A `Hosts` whose `addressNow` is what `now` says when it is asked. */
const hostsSaying = (now: () => Address | undefined) =>
  hostsLayer({ addressNow: () => Effect.sync(now) })

it.effect(
  "a copy is saved where the Person picked, offered by its name, with the bytes of the machine the URL names",
  () =>
    Effect.gen(function* () {
      const copy = join(folder, "shot.png")
      const { offered, pick } = dialog(copy)
      expect(yield* saveCopy("app://files/arc/t1", "shot.png", pick)).toBe(
        "saved"
      )
      expect(offered).toEqual(["shot.png"])
      expect(readFileSync(copy, "utf8")).toBe("arc's bytes")
      expect(arc.heard).toEqual(["/b/t1"])
      expect(here.heard).toEqual([])
      expect(readdirSync(folder)).toEqual(["shot.png"])
    }).pipe(Effect.provide(main()))
)

it.effect(
  "a copy of this machine's file comes from this machine's engine",
  () =>
    Effect.gen(function* () {
      const copy = join(folder, "here.png")
      expect(
        yield* saveCopy("app://files/t2", "here.png", dialog(copy).pick)
      ).toBe("saved")
      expect(readFileSync(copy, "utf8")).toBe("this machine's")
      expect(here.heard).toEqual(["/b/t2"])
    }).pipe(Effect.provide(main()))
)

it.effect("a canceled dialog asks for no byte and writes nothing", () =>
  Effect.gen(function* () {
    expect(
      yield* saveCopy("app://files/arc/t1", "shot.png", dialog(null).pick)
    ).toBe("canceled")
    expect(arc.heard).toEqual([])
    expect(readdirSync(folder)).toEqual([])
  }).pipe(Effect.provide(main()))
)

it.effect(
  "while the machine is away the Person is told at once, with no dialog and nothing written",
  () =>
    Effect.gen(function* () {
      const { offered, pick } = dialog(join(folder, "shot.png"))
      expect(yield* saveCopy("app://files/arc/t1", "shot.png", pick)).toBe(
        "away"
      )
      expect(offered).toEqual([])
      expect(readdirSync(folder)).toEqual([])
    }).pipe(Effect.provide(main(hostsSaying(() => undefined))))
)

it.effect("a machine that goes away during the dialog writes nothing", () => {
  let away = false
  return Effect.gen(function* () {
    const open = dialog(join(folder, "shot.png"), () => {
      away = true
    })
    expect(yield* saveCopy("app://files/arc/t1", "shot.png", open.pick)).toBe(
      "away"
    )
    expect(arc.heard).toEqual([])
    expect(readdirSync(folder)).toEqual([])
  }).pipe(
    Effect.provide(main(hostsSaying(() => (away ? undefined : arc.address()))))
  )
})

it.effect(
  "ssh coming back on a new port during the dialog fetches from the new one",
  () =>
    Effect.gen(function* () {
      const next = yield* Effect.promise(() => fakeEngine("arc again"))
      let forward = arc
      const copy = join(folder, "shot.png")
      const open = dialog(copy, () => {
        forward = next
      })
      yield* Effect.gen(function* () {
        expect(
          yield* saveCopy("app://files/arc/t1", "shot.png", open.pick)
        ).toBe("saved")
      }).pipe(Effect.provide(main(hostsSaying(() => forward.address()))))
      expect(readFileSync(copy, "utf8")).toBe("arc again")
      expect(next.heard).toEqual(["/b/t1"])
      expect(arc.heard).toEqual([])
      next.server.closeAllConnections()
      yield* Effect.promise(
        () => new Promise((done) => next.server.close(done))
      )
    })
)

it.effect(
  "a link that has ended says so, and leaves the file the Person picked as it was",
  () =>
    Effect.gen(function* () {
      arc.answer = (response) => {
        response.writeHead(404)
        response.end("gone")
      }
      const copy = join(folder, "shot.png")
      writeFileSync(copy, "kept")
      const failure = yield* Effect.flip(
        saveCopy("app://files/arc/old", "shot.png", dialog(copy).pick)
      )
      expect(failure.message).toContain("not saved")
      expect(readFileSync(copy, "utf8")).toBe("kept")
      expect(readdirSync(folder)).toEqual(["shot.png"])
    }).pipe(Effect.provide(main()))
)

/** The engine starts the file and the link breaks before its end. */
const cutHalfway = (response: ServerResponse) => {
  response.writeHead(200, { "content-length": "100" })
  response.write("half", () => response.destroy())
}

it.effect(
  "a link that breaks halfway leaves nothing where the Person picked, and says the machine is away if it is",
  () => {
    let away = false
    return Effect.gen(function* () {
      arc.answer = (response) => {
        away = true
        cutHalfway(response)
      }
      const copy = join(folder, "shot.png")
      expect(
        yield* saveCopy("app://files/arc/t1", "shot.png", dialog(copy).pick)
      ).toBe("away")
      expect(existsSync(copy)).toBe(false)
      expect(readdirSync(folder)).toEqual([])
    }).pipe(
      Effect.provide(
        main(hostsSaying(() => (away ? undefined : arc.address())))
      )
    )
  }
)

it.effect(
  "a link that breaks while its machine is still there fails, saying the copy was not saved, and the file the Person picked is as it was",
  () =>
    Effect.gen(function* () {
      arc.answer = cutHalfway
      const copy = join(folder, "shot.png")
      writeFileSync(copy, "kept")
      const failure = yield* Effect.flip(
        saveCopy("app://files/arc/t1", "shot.png", dialog(copy).pick)
      )
      expect(failure.message).toContain("not saved")
      expect(readFileSync(copy, "utf8")).toBe("kept")
      expect(readdirSync(folder)).toEqual(["shot.png"])
    }).pipe(Effect.provide(main()))
)

it.effect(
  "only a file's link can be saved: a page's, or anything else, is refused before the dialog",
  () =>
    Effect.gen(function* () {
      const { offered, pick } = dialog(join(folder, "x"))
      for (const url of [
        "app://preview/arc/t1",
        "app://banda/index.html",
        "file:///etc/hostname",
        "not a url",
      ])
        expect(
          (yield* Effect.flip(saveCopy(url, "x", pick))).message
        ).toContain("not a file's link")
      expect(offered).toEqual([])
      expect(arc.heard).toEqual([])
    }).pipe(Effect.provide(main()))
)
