/**
 * Another machine's port opened here (ADR 0120, decision 2), with a fake
 * of `Hosts` that says which machines are live and a fake ssh first on
 * PATH: its forward listens on the port `-L` names here and answers
 * "arc's" itself, as nothing else in a test is another machine.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { connect, createServer, type AddressInfo, type Server } from "node:net"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterEach, expect, it } from "@effect/vitest"
import type { HostState } from "@banda/core"
import { Effect, Layer, SubscriptionRef } from "effect"
import { candidates, Forwards, isPort, taken } from "./forward"
import { Hosts } from "./hosts"

/** ssh as the forward runs it: it notes its arguments, listens where `-L`
 * says, and answers each connection "arc's". */
const FAKE = `
const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, "calls"), JSON.stringify(args) + "\\n")
const [, from] = args[args.indexOf("-L") + 1].split(":")
net
  .createServer((socket) => {
    socket.on("error", () => {})
    socket.end("arc's")
  })
  .listen(Number(from), "127.0.0.1")
`

function fakeSsh() {
  const dir = mkdtempSync(join(tmpdir(), "banda-forward-"))
  writeFileSync(join(dir, "ssh"), `#!${process.execPath}\n${FAKE}`, {
    mode: 0o755,
  })
  return {
    env: { PATH: `${dir}${delimiter}${process.env.PATH}` },
    calls: () =>
      readFileSync(join(dir, "calls"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
  }
}

const live = (name: string): HostState => ({
  name,
  ssh: name,
  state: "live",
  build: null,
  version: null,
  own: { build: null, version: null },
})

/** Main's hosts, which says only how each machine is. */
const hostsLayer = (states: SubscriptionRef.SubscriptionRef<HostState[]>) =>
  Layer.succeed(Hosts)({
    current: SubscriptionRef.get(states),
    changes: SubscriptionRef.changes(states),
    address: () => Effect.die("unused"),
    addressNow: () => Effect.die("unused"),
    addressWhenBack: () => Effect.die("unused"),
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

const forwards = (
  states: SubscriptionRef.SubscriptionRef<HostState[]>,
  fake: ReturnType<typeof fakeSsh>
) =>
  Forwards.layer({ env: fake.env }).pipe(
    Layer.provide(hostsLayer(states)),
    Layer.provide(NodeServices.layer)
  )

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise((done) => server.close(done))
})

/** A program of this device's that listens on a port of its own. */
const listening = () =>
  new Promise<number>((done) => {
    const server = createServer((socket) => {
      // What only asks whether the port is taken hangs up at once.
      socket.on("error", () => {})
      socket.end("this device's")
    })
    servers.push(server)
    server.listen(0, "127.0.0.1", () =>
      done((server.address() as AddressInfo).port)
    )
  })

/** A port nothing listens on here now. */
const free = async () => {
  const port = await listening()
  const server = servers.pop()!
  await new Promise((done) => server.close(done))
  return port
}

/** What answers on this device's `port`. */
const said = (port: number) =>
  Effect.promise(
    () =>
      new Promise<string>((done) => {
        let all = ""
        const socket = connect(port, "127.0.0.1")
        socket.on("data", (chunk) => (all += String(chunk)))
        socket.on("close", () => done(all || "nothing"))
        socket.on("error", () => done("nothing"))
      })
  )

it("a port is one from 1 to 65535, and the ports tried here start at the machine's own", () => {
  expect([0, 1, 3000, 65_535, 65_536, 3.5].map(isPort)).toEqual([
    false,
    true,
    true,
    true,
    false,
    false,
  ])
  expect(candidates(3000).slice(0, 3)).toEqual([3000, 3001, 3002])
  expect(candidates(65_534)).toEqual([65_534, 65_535])
})

it.live("a port a program of this device's listens on is taken", () =>
  Effect.gen(function* () {
    const held = yield* Effect.promise(listening)
    expect(yield* taken(held)).toBe(true)
    expect(yield* taken(yield* Effect.promise(free))).toBe(false)
  })
)

it.live(
  "a live machine's port opens here at the same port, once for two clicks, and ends as the machine goes away",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh()
      const states = yield* SubscriptionRef.make([live("arc")])
      const port = yield* Effect.promise(free)
      yield* Effect.gen(function* () {
        const { open } = yield* Forwards
        expect(yield* open("arc", port)).toBe(port)
        expect(yield* said(port)).toBe("arc's")
        // A second click asks no second ssh.
        expect(yield* open("arc", port)).toBe(port)
        expect(fake.calls()).toHaveLength(1)
        // By the engine's forward's own arguments, loopback to loopback.
        const args = fake.calls()[0]!
        expect(args).toContain("-N")
        expect(args[args.indexOf("-L") + 1]).toBe(
          `127.0.0.1:${port}:127.0.0.1:${port}`
        )
        expect(args.at(-1)).toBe("arc")

        // arc goes away: its forward ends with its link.
        yield* SubscriptionRef.set(states, [
          { name: "arc", ssh: "arc", state: "away", why: "asleep" },
        ])
        while ((yield* said(port)) !== "nothing") yield* Effect.sleep(20)
        // Nothing waits: a click says so at once.
        expect(yield* open("arc", port)).toBe("away")
        expect(fake.calls()).toHaveLength(1)
      }).pipe(Effect.provide(forwards(states, fake)))
    })
)

it.live(
  "a port taken on this device opens as the next free one, and the program that has it is left alone",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh()
      const states = yield* SubscriptionRef.make([live("arc")])
      const held = yield* Effect.promise(listening)
      yield* Effect.gen(function* () {
        const { open } = yield* Forwards
        const here = yield* open("arc", held)
        expect(here).not.toBe("away")
        expect(here).toBeGreaterThan(held)
        expect(yield* said(here as number)).toBe("arc's")
        expect(yield* said(held)).toBe("this device's")
        // The machine's port is still the one asked for there.
        const args = fake.calls().at(-1)!
        expect(args[args.indexOf("-L") + 1]).toBe(
          `127.0.0.1:${here}:127.0.0.1:${held}`
        )
      }).pipe(Effect.provide(forwards(states, fake)))
    })
)

it.live(
  "a machine this window does not reach, and what is no port, are refused",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh()
      const states = yield* SubscriptionRef.make([live("arc")])
      yield* Effect.gen(function* () {
        const { open } = yield* Forwards
        const none = yield* open("mini", 3000).pipe(Effect.flip)
        expect(none.message).toBe("This window reaches no machine mini.")
        const no = yield* open("arc", 70_000).pipe(Effect.flip)
        expect(no.message).toBe("70000 is no port.")
      }).pipe(Effect.provide(forwards(states, fake)))
    })
)
