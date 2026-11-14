/**
 * A port of another machine, opened on this device (ADR 0120, decision 2):
 * the capability `forward_port`. A click on a link to arc's own computer,
 * as `localhost:3000` in an arc reply, asks for it: one more `ssh -N -L`
 * to arc, by the same `ssh` and options as the engine's forward
 * (`forwardArgs`), from this device's loopback to arc's.
 *
 * The same port here when it is free, so a page that names its own
 * address, a dev server's socket and a sign-in's callback work unchanged;
 * else the next free one. It lasts while the window runs and that machine
 * is live, and ends with its link; a later click opens it again. Nothing
 * waits: for a machine away it says so at once (ADR 0106, law 4).
 *
 * Only the Person's click asks. It listens on loopback only.
 */
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import type { HostState } from "@banda/core"
import { Refused } from "@banda/desktop-kit"
import {
  Console,
  Context,
  Deferred,
  Effect,
  Layer,
  Schema,
  Semaphore,
  Stream,
} from "effect"
import { ChildProcessSpawner } from "effect/process"
import { command } from "./child"
import { forwardArgs, Hosts, linesOf } from "./hosts"

/** How many ports are tried, from the machine's own on. */
const TRIES = 10
/** How long ssh has to listen, in ms: its own `ConnectTimeout` ends it
 * sooner on a link gone dead. */
const ANSWER = 30_000

/** Whether something listens on `host`'s `port` here. */
const listensOn = (host: string, port: number) =>
  Effect.callback<boolean>((resume) => {
    const socket = createConnection({ host, port })
    const say = (yes: boolean) => () => {
      socket.destroy()
      resume(Effect.succeed(yes))
    }
    socket.once("connect", say(true))
    socket.once("error", say(false))
    return Effect.sync(() => socket.destroy())
  })

/** Whether this device's loopback `port` can be listened on. */
const binds = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const server = createServer()
    server.once("error", () => resume(Effect.succeed(false)))
    server.listen(port, "127.0.0.1", () =>
      server.close(() => resume(Effect.succeed(true)))
    )
  })

/**
 * Whether `port` is taken on this device: it cannot be listened on, or a
 * program listens on the other loopback, which `localhost` names too and
 * a dev server may hold alone.
 */
export const taken = (port: number) =>
  Effect.all([listensOn("::1", port), binds(port)], { concurrency: 2 }).pipe(
    Effect.map(([other, free]) => other || !free)
  )

/** The ports to try here for a machine's `port`, its own first. */
export const candidates = (port: number): number[] =>
  Array.from({ length: TRIES }, (_, at) => port + at).filter(
    (one) => one <= 65_535
  )

/** Whether `port` is one a machine listens on. */
export const isPort = (port: number) =>
  Number.isInteger(port) && port >= 1 && port <= 65_535

/** Whether `machine` is live in `hosts`, at the same `ssh`. */
const liveIn = (hosts: readonly HostState[], machine: HostState) =>
  hosts.some(
    (one) =>
      one.name === machine.name &&
      one.ssh === machine.ssh &&
      one.state === "live"
  )

/** Other machines' ports, opened here (the module's words). */
export class Forwards extends Context.Service<
  Forwards,
  {
    /**
     * Opens port `port` of host `machine`, by its key in `hosts.toml`, on
     * this device's loopback: the port it listens on here, the same when
     * that was free, or the one a forward of it already has. `away` while
     * that machine is not live, at once. Fails, saying why, for a machine
     * this window does not reach, what is no port, or no free port here.
     */
    readonly open: (
      machine: string,
      port: number
    ) => Effect.Effect<number | "away", Refused>
  }
>()("banda/Forwards") {
  /** The forwards, each ssh run from `env`'s PATH, or the window's. */
  static readonly layer = ({ env }: { env?: Record<string, string> } = {}) =>
    Layer.effect(Forwards)(
      Effect.gen(function* () {
        const hosts = yield* Hosts
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const scope = yield* Effect.scope
        const lock = yield* Semaphore.make(1)
        /** The port here of each forward that listens, by its machine and
         * that machine's port. */
        const kept = new Map<string, number>()

        /** One ssh from `here` to `machine`'s `port`: `ready` hears
         * whether it listens, and then it runs until ssh ends or the
         * machine is no longer live. */
        const run = (
          machine: HostState,
          port: number,
          here: number,
          ready: Deferred.Deferred<boolean>
        ) =>
          Effect.scoped(
            Effect.gen(function* () {
              const key = `${machine.name}:${port}`
              const ssh = yield* spawner.spawn(
                command("ssh", forwardArgs(machine, here, port), env, "pipe")
              )
              const ended = ssh.exitCode.pipe(Effect.ignore)
              // Read, so the pipe never fills.
              yield* Effect.forkScoped(
                linesOf(ssh.stderr).pipe(Stream.runDrain, Effect.ignore)
              )
              const listening = Effect.gen(function* () {
                while (!(yield* listensOn("127.0.0.1", here)))
                  yield* Effect.sleep(100)
                return true
              })
              const listens = yield* Effect.raceAll([
                listening,
                Effect.as(ended, false),
                Effect.as(Effect.sleep(ANSWER), false),
              ])
              if (!listens) return
              kept.set(key, here)
              yield* Deferred.succeed(ready, true)
              yield* Console.error(
                `banda: ${machine.name}'s port ${port} is open here as ${here}`
              )
              const gone = hosts.changes.pipe(
                Stream.filter((now) => !liveIn(now, machine)),
                Stream.take(1),
                Stream.runDrain
              )
              yield* Effect.raceFirst(ended, gone).pipe(
                Effect.ensuring(Effect.sync(() => kept.delete(key)))
              )
              yield* Console.error(
                `banda: ${machine.name}'s port ${port} is closed here`
              )
            })
          ).pipe(
            Effect.catch((error: { message: string }) =>
              Console.error(
                `banda: ${machine.name}'s port ${port}: ${error.message}`
              )
            ),
            Effect.ensuring(Deferred.succeed(ready, false))
          )

        /** The machine `machine` as it is now, live: `away` where it is
         * not, and a refusal for one this window does not reach. */
        const liveNow = (machine: string) =>
          Effect.gen(function* () {
            const now = yield* hosts.current
            const host = now.find((one) => one.name === machine)
            if (!host)
              return yield* new Refused({
                message: `This window reaches no machine ${machine}.`,
              })
            return host.state === "live" ? host : ("away" as const)
          })

        /** A new forward to `host`'s `port`, at the first port free here.
         * Only a port taken meanwhile is a reason for the next one: an
         * ssh that did not listen on a free port did not get through. */
        const start = (host: HostState, port: number) =>
          Effect.gen(function* () {
            // One that listens since this open began to wait.
            const have = kept.get(`${host.name}:${port}`)
            if (have !== undefined) return have
            for (const here of candidates(port)) {
              if (yield* taken(here)) continue
              const ready = yield* Deferred.make<boolean>()
              yield* Effect.forkIn(run(host, port, here, ready), scope)
              if (yield* Deferred.await(ready)) return here
              if (yield* taken(here)) continue
              if ((yield* liveNow(host.name)) === "away") return "away" as const
              return yield* new Refused({
                message: `ssh to ${host.name} did not open its port ${port}.`,
              })
            }
            return yield* new Refused({
              message: `No port from ${port} on is free here.`,
            })
          })

        // What needs no ssh is answered at once, and never behind another
        // open: a forward that listens, a machine away, what is refused.
        const open = (machine: string, port: number) =>
          Effect.gen(function* () {
            if (!isPort(port))
              return yield* new Refused({ message: `${port} is no port.` })
            const have = kept.get(`${machine}:${port}`)
            if (have !== undefined) return have
            const host = yield* liveNow(machine)
            if (host === "away") return host
            // One at a time, so two never take one port here.
            return yield* lock.withPermit(start(host, port))
          })

        return { open }
      })
    )
}

/**
 * The other machines of `hosts.toml` in the config folder `config`, and
 * their ports opened here, which go by the same ssh: what main's root
 * builds of both. `install` is this build's `install.sh` (`Hosts.layer`).
 */
export const reaching = (config: string, install?: string) =>
  Forwards.layer().pipe(
    Layer.provideMerge(Hosts.layer(join(config, "hosts.toml"), { install }))
  )

/** The bridge's `hostForward`, answered beside its code (ADR 0089,
 * decision 9): the page's click asks `Forwards.open`. */
export const forwardAnswer = [
  Schema.Tuple([Schema.String, Schema.Number]),
  ([name, port]: readonly [string, number]) =>
    Forwards.use((forwards) => forwards.open(name, port)),
] as const
