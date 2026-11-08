/**
 * Other machines' engines, as the window reaches them over ssh (ADR 0081,
 * decision 4: the `ssh` route). `hosts.toml`, in the config folder, names
 * each host; only main reads it. For each, main runs two of the system's
 * ssh, never through a shell:
 *
 * - the follower runs `banda start --with-parent` there, which starts that
 *   machine's engine when it does not run and prints where it listens, as
 *   the window's own does here (engine.ts), then follows it;
 * - the forward carries a port of this machine's loopback to the port
 *   that engine listens on, on that machine's loopback.
 *
 * The page gets the forward's address and the engine's secret once that
 * ssh itself listens on the port, never another program that took it
 * first, and loses them the moment either ssh ends. The secret goes
 * nowhere else: no program's arguments or environment, no log, no file.
 * Neither the road (road.ts) nor main's own engine client nor the
 * problems ever reach these engines, so what one of them asks of a window
 * stays on its machine.
 *
 * What the other machine says is not trusted: each line it prints is
 * read only up to 4 KiB, its stderr is logged cut short, a few lines a
 * minute, and the page gets only the window's own words, and Tailscale's
 * sign-in link once checked. An engine that stops there as asked leaves
 * this Banda running, and is started again only when the page asks. A
 * refused host is tried again every ten minutes, or when the page asks.
 * Quitting Banda ends both ssh; the engine there runs on, as that
 * machine's service.
 */
import { createConnection, createServer, type AddressInfo } from "node:net"
import { readdirSync, readFileSync, readlinkSync } from "node:fs"
import { type Address, PROTOCOL } from "@banda/contract"
import { Refused } from "@banda/desktop-kit"
import type { HostState } from "@banda/web/host"
import { parse } from "smol-toml"
import {
  Clock,
  Console,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { channel } from "./channel"
import { command } from "./child"
import { Program, versionOf } from "./program"

/** One host of `hosts.toml`: its name in Banda, where ssh goes, and the
 * `banda` it runs there, or none to find this build's own there. The
 * shape stays for `banda --host` (ADR 0081, decision 13). */
type Entry = {
  readonly name: string
  readonly ssh: string
  readonly banda?: string
}

/** A host's name: plain, and none of the names Banda keeps for its own. */
const NAME = /^[a-z0-9-]+$/
const KEPT = new Set(["local", "this"])
/** Where ssh goes: a Host of the ssh config, `user@machine` or an
 * `ssh://` link, in characters no shell takes for its own, should a
 * `ProxyCommand` hand it one; not an option. */
const DESTINATION = /^(?!-)[A-Za-z0-9._@:[\]/-]+$/
/** The `banda` there: a whole path, or one from home, in characters the
 * remote shell takes as they are. */
const BANDA = /^(?:\/|~\/)[A-Za-z0-9._/~-]+$/

/** The good hosts of `hosts.toml`'s `text`, and why each other one is
 * refused. A host with no `banda` runs this build's own there, as the
 * follower finds it (`remoteCommand`). */
export function hostsOf(text: string): { hosts: Entry[]; refused: string[] } {
  let table: Record<string, unknown>
  try {
    table = parse(text)
  } catch (error) {
    const first = String(error).split("\n")[0]
    return { hosts: [], refused: [`it is not TOML: ${first}`] }
  }
  const listed = table.hosts
  if (listed === undefined) return { hosts: [], refused: [] }
  if (!Array.isArray(listed))
    return { hosts: [], refused: ["`hosts` is not a list of [[hosts]]"] }
  const hosts: Entry[] = []
  const refused: string[] = []
  listed.forEach((entry: unknown, at) => {
    const why = refusalOf(entry, hosts)
    if (why) refused.push(`host ${at + 1}: ${why}; it is left out`)
    else {
      const { name, ssh, banda } = entry as Record<string, string>
      hosts.push({ name, ssh, banda })
    }
  })
  return { hosts, refused }
}

/** Why `entry` is no good beside `taken`; none when it is. */
function refusalOf(entry: unknown, taken: Entry[]): string | undefined {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return "it is not a table"
  const { name, ssh, banda } = entry as Record<string, unknown>
  if (typeof name !== "string" || !NAME.test(name))
    return "`name` is not lowercase letters, digits and -"
  if (KEPT.has(name)) return `\`name\` ${JSON.stringify(name)} is Banda's own`
  if (taken.some((one) => one.name === name))
    return `\`name\` ${JSON.stringify(name)} is taken by an earlier host`
  if (typeof ssh !== "string" || !DESTINATION.test(ssh))
    return "`ssh` is not letters, digits and . _ @ : [ ] / -, not starting with -"
  if (banda !== undefined && (typeof banda !== "string" || !BANDA.test(banda)))
    return "`banda` is not a whole path or one from ~/, in letters, digits and . _ / ~ -"
  return undefined
}

/** The hosts of the file `file`: none when it is not there. */
function readHosts(file: string): { hosts: Entry[]; refused: string[] } {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { hosts: [], refused: [] }
    return { hosts: [], refused: [`it cannot be read: ${String(error)}`] }
  }
  return hostsOf(text)
}

/** What both ssh are given: no terminal, no agent, no X11, no tunnel, no
 * command of the config's own, no connection shared with another ssh, no
 * question asked, the log level that shows Tailscale's sign-in link, and
 * a link given up after half a minute of silence. */
const PLAIN_SSH = [
  "-T",
  "-a",
  "-x",
  "-o",
  "BatchMode=yes",
  "-o",
  "RemoteCommand=none",
  "-o",
  "Tunnel=no",
  "-o",
  "LogLevel=INFO",
  "-o",
  "ForwardAgent=no",
  "-o",
  "ForwardX11=no",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=2",
  "-o",
  "ControlPath=none",
  "-o",
  "ControlMaster=no",
]

/** What a shell exits with when it finds no program to run. */
const NOT_FOUND = 127

/** This build's names, which the follower looks for there: its program
 * on PATH and its data folder (`banda-dev`), and its app (`Banda Dev`). */
type Own = { readonly folder: string; readonly name: string }

/** What the follower runs there, through `sh` whatever the login shell
 * is: `banda start --with-parent`, with the session's runtime folder set
 * when ssh set none, so systemd's user manager answers. `banda` is plain
 * (`BANDA`), so it goes in as it is, and `~/` is home there. With no
 * `banda`, it runs the first of this build's own it finds: on PATH, the
 * newest copy an AppImage keeps in its data folder (program.ts), or
 * macOS's app; with none, it exits 127. `own`'s names are channel.ts's,
 * in letters, digits, spaces and -. */
export const remoteCommand = (
  banda: string | undefined,
  own: Own = channel
) => {
  const start = `exec env XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"`
  if (banda !== undefined)
    return `sh -c '${start} ${banda} start --with-parent'`
  const found = [
    `b=$(command -v ${own.folder}) || b=$(ls -1d "\${XDG_DATA_HOME:-$HOME/.local/share}"/${own.folder}/engine/*/banda 2>/dev/null | sort -V | tail -n 1)`,
    `[ -x "$b" ] || b="/Applications/${own.name}.app/Contents/Resources/banda"`,
    `[ -x "$b" ] || { echo "no ${own.name} here" >&2; exit ${NOT_FOUND}; }`,
    `${start} "$b" start --with-parent`,
  ]
  return `sh -c '${found.join("; ")}'`
}

/** The follower's arguments: no forward of the config's either. */
export const followerArgs = (host: Entry) => [
  ...PLAIN_SSH,
  "-o",
  "ClearAllForwardings=yes",
  "--",
  host.ssh,
  remoteCommand(host.banda),
]

/** The forward's arguments: this machine's loopback port `from` to port
 * `to` on that machine's loopback, and nothing else. It ends when it
 * cannot listen. */
export const forwardArgs = (host: Entry, from: number, to: number) => [
  "-N",
  ...PLAIN_SSH,
  "-o",
  "ExitOnForwardFailure=yes",
  "-L",
  `127.0.0.1:${from}:127.0.0.1:${to}`,
  "--",
  host.ssh,
]

/** The forwards `ssh -G` says the config gives a host. The follower drops
 * them (`ClearAllForwardings`), but that would drop the forward's own
 * too, so a host with any is refused. */
export const forwardsIn = (said: string) =>
  said
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0]?.toLowerCase() ?? "")
    .filter((key) =>
      ["localforward", "remoteforward", "dynamicforward"].includes(key)
    )

/** A line ssh printed as the forward could not listen on this machine's
 * port: another program holds it. */
const NO_LISTEN = /^bind \[127\.0\.0\.1\]:\d+: |cannot listen to port: \d+$/

/** Tailscale's sign-in link in a line ssh printed, as Tailscale SSH's
 * check mode prints it and waits; no other link, nor one inside another. */
export function signInOf(line: string): string | undefined {
  const found =
    /(?<!\S)https:\/\/login\.tailscale\.com\/[A-Za-z0-9._~/?=&%+-]*/.exec(
      line
    )?.[0]
  if (!found || found.length > 300) return undefined
  const url = URL.parse(found)
  return url?.protocol === "https:" &&
    url.host === "login.tailscale.com" &&
    !url.username &&
    !url.password
    ? found
    : undefined
}

/** How many bytes of a line from ssh are read; the rest of a longer line
 * is dropped, so the other machine cannot make the window keep a line
 * with no end. */
const LINE_BYTES = 4096

/** `bytes` line by line, each cut at `most` bytes, as `Stream.splitLines`
 * would split them with no end to a line. */
export const linesOf = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  most = LINE_BYTES
) => {
  const decoder = new TextDecoder()
  const text = (parts: Uint8Array[]) =>
    decoder.decode(Buffer.concat(parts)).replace(/\r$/, "")
  return bytes.pipe(
    Stream.mapAccum(
      () => ({ parts: [] as Uint8Array[], size: 0 }),
      (line, chunk) => {
        const said: string[] = []
        let from = 0
        while (from <= chunk.length) {
          const end = chunk.indexOf(10, from)
          const piece = chunk.subarray(from, end < 0 ? chunk.length : end)
          const room = most - line.size
          if (room > 0 && piece.length > 0) {
            // A copy: a view keeps its whole chunk, so many short pieces
            // of long chunks would hold far more than `most` bytes.
            line.parts.push(new Uint8Array(piece.subarray(0, room)))
            line.size += Math.min(room, piece.length)
          }
          if (end < 0) break
          said.push(text(line.parts))
          line.parts = []
          line.size = 0
          from = end + 1
        }
        return [line, said] as const
      },
      { onHalt: (line) => (line.size > 0 ? [text(line.parts)] : []) }
    )
  )
}

/** A line from the other machine as the log takes it: no control
 * characters, cut short. */
const plain = (line: string) =>
  line
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .trim()
    .slice(0, 300)

/** What `start --with-parent` prints first there; `window` is that
 * machine's own door, and is left. */
const Running = Schema.fromJsonString(
  Schema.Struct({
    protocol: Schema.Number,
    port: Schema.Number,
    secret: Schema.String,
    build: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
  })
)
/** What `banda` prints as it refuses (engine/src/main.rs). */
const Refusal = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  })
)

/** A build and a version as the page may show them: plain, or none. */
const buildOf = (build: unknown) =>
  typeof build === "string" && /^[0-9a-f]{1,128}$/.test(build) ? build : null
const versionNamed = (version: unknown) =>
  typeof version === "string" &&
  /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version)
    ? version
    : null

/** This window's own build, as its `banda --version` says it:
 * `banda 0.1.0-dev.1 (build 1d72…)`. */
export function ownOf(said: string) {
  const [, version, build] =
    /^banda (\S+)(?: \(build (\S+)\))?/.exec(said) ?? []
  return { build: buildOf(build), version: versionNamed(version) }
}

/** How long each wait is, in ms. */
export type Times = {
  /** After an ssh that ended, before the next; it doubles up to `longest`,
   * and is the first again after a host was live. */
  first: number
  longest: number
  /** After the host was refused, before it is tried again. */
  refused: number
  /** For the first line, and for the forward to answer. */
  answer: number
  /** For the Person to sign in to Tailscale, from its link. */
  signin: number
}

const TIMES: Times = {
  first: 2_000,
  longest: 60_000,
  refused: 10 * 60_000,
  answer: 60_000,
  signin: 10 * 60_000,
}

/** How many ports the forward tries, as another program may take the one
 * picked before ssh listens on it. */
const PORT_TRIES = 3
/** How many lines from ssh the log takes from a host in a minute. */
const LINES_A_MINUTE = 20

/** A host's state without its name, as the page sees it. */
type Without<T> = T extends unknown ? Omit<T, "name"> : never
type Link = Without<HostState>

/** A host as main keeps it: its state, its address while live, which go
 * at it this is, and what starts the next go at once while it is
 * stopped or refused. */
type Kept = {
  readonly name: string
  readonly link: Link
  readonly address?: Address
  readonly go: number
  readonly next?: Deferred.Deferred<void>
}

/** How one go at a host ended, and whether it was live meanwhile. */
type Ended = (
  | { state: "away"; why: string }
  | { state: "stopped" }
  | { state: "refused"; why: string }
) & { live?: boolean }

const away = (why: string): Ended => ({ state: "away", why })

/** How the page sees a go's end. */
const linkOf = (ended: Ended): Link =>
  ended.state === "stopped"
    ? { state: "stopped" }
    : { state: ended.state, why: ended.why }

/** Other machines' engines (the module's words). */
export class Hosts extends Context.Service<
  Hosts,
  {
    /** Each host of `hosts.toml`, as it is now. */
    readonly current: Effect.Effect<HostState[]>
    /** The hosts, now and each time one changes. */
    readonly changes: Stream.Stream<HostState[]>
    /** Where host `name`'s engine listens, through the forward: it waits
     * while the host connects, and while its engine is stopped there, and
     * tries a refused one again at once; it fails for one refused, or not
     * in `hosts.toml`. */
    readonly address: (name: string) => Effect.Effect<Address, Refused>
    /** Starts host `name` again at once when its engine is stopped there
     * or it is refused; it fails for one not in `hosts.toml`. */
    readonly start: (name: string) => Effect.Effect<void, Refused>
  }
>()("banda/Hosts") {
  /** The hosts of `file`, each run by ssh from `env`'s PATH, or the
   * window's. */
  static readonly layer = (
    file: string,
    { env, times = TIMES }: { env?: Record<string, string>; times?: Times } = {}
  ) =>
    Layer.effect(Hosts)(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const program = yield* Program
        const { hosts, refused } = readHosts(file)
        for (const why of refused)
          yield* Console.error(`banda: ${file}: ${why}`)
        const all = yield* SubscriptionRef.make<readonly Kept[]>(
          hosts.map(({ name }) => ({
            name,
            link: { state: "connecting" },
            go: 0,
          }))
        )
        const own = yield* Effect.cached(
          program.path.pipe(
            Effect.flatMap(versionOf),
            Effect.map(ownOf),
            Effect.orElseSucceed(() => ({ build: null, version: null })),
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              spawner
            )
          )
        )
        const run = { spawner, env, times, own }
        for (const host of hosts) {
          const change = (to: (one: Kept) => Kept) =>
            SubscriptionRef.update(all, (list) =>
              list.map((one) => (one.name === host.name ? to(one) : one))
            )
          const tell: Tell = {
            set: (link, address) =>
              change((one) => ({ ...one, link, address })),
            begin: (next) =>
              change((one) => ({
                name: one.name,
                link: { state: "connecting" },
                go: one.go + 1,
                next,
              })),
          }
          yield* Effect.forkScoped(keep(host, tell, run))
        }
        const seen = (list: readonly Kept[]): HostState[] =>
          list.map(({ name, link }) => ({ name, ...link }))
        /** Host `name` as it is now, and its next go started at once when
         * it waits in one of `states`. */
        const wake = (name: string, states: Link["state"][]) =>
          Effect.gen(function* () {
            const kept = (yield* SubscriptionRef.get(all)).find(
              (one) => one.name === name
            )
            if (!kept)
              return yield* new Refused({
                message: `There is no host ${JSON.stringify(name)} in hosts.toml.`,
              })
            if (kept.next && states.includes(kept.link.state))
              yield* Deferred.succeed(kept.next, undefined)
            return kept
          })
        return {
          current: Effect.map(SubscriptionRef.get(all), seen),
          changes: SubscriptionRef.changes(all).pipe(Stream.map(seen)),
          address: (name: string) =>
            Effect.gen(function* () {
              const kept = yield* wake(name, ["refused"])
              // A refusal from the go that was asked past does not count.
              const past = kept.link.state === "refused" ? kept.go : -1
              const found = yield* SubscriptionRef.changes(all).pipe(
                Stream.map((list) => list.find((one) => one.name === name)),
                Stream.filter(
                  (one) =>
                    one?.address !== undefined ||
                    (one?.link.state === "refused" && one.go > past)
                ),
                Stream.runHead
              )
              const one = Option.getOrUndefined(found)
              if (one?.address) return one.address
              return yield* new Refused({
                message: `${name}: ${one?.link.state === "refused" ? one.link.why : "it is gone"}`,
              })
            }),
          start: (name: string) =>
            Effect.asVoid(wake(name, ["stopped", "refused"])),
        }
      })
    )
}

/** How a go tells the host's state: `set` it, or `begin` a go, which
 * `next` ends the wait before. */
type Tell = {
  readonly set: (link: Link, address?: Address) => Effect.Effect<void>
  readonly begin: (next: Deferred.Deferred<void>) => Effect.Effect<void>
}

type Run = {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly env: Record<string, string> | undefined
  readonly times: Times
  readonly own: Effect.Effect<{ build: string | null; version: string | null }>
}

/** Keeps `host` reached for good: a go, and after one that ended, another
 * once the wait its end calls for is over. A host stopped there waits for
 * the page to ask (`start`): Banda never starts an engine the Person
 * stopped. A refused one is tried again after a long wait, or as the page
 * asks. */
const keep = (host: Entry, { set, begin }: Tell, run: Run) =>
  Effect.gen(function* () {
    const { times } = run
    const told = new Set<string>()
    const said = heard(host.name)
    let wait = times.first
    while (true) {
      // Made before the go, so it is there as soon as the host shows
      // stopped or refused.
      const next = yield* Deferred.make<void>()
      yield* begin(next)
      const ended = yield* Effect.scoped(
        once(host, set, said, told, run).pipe(
          // Said before the scope closes, as it ends the follower; a live
          // go said it as soon as one ssh ended.
          Effect.tap((ended) => (ended.live ? Effect.void : set(linkOf(ended))))
        )
      )
      if (ended.state === "refused") {
        yield* Console.error(
          `banda: ${host.name} is refused: ${ended.why}; Banda tries again in ${times.refused} ms, or when asked`
        )
        yield* Effect.raceFirst(
          Effect.sleep(times.refused),
          Deferred.await(next)
        )
        wait = times.first
        continue
      }
      if (ended.state === "stopped") {
        yield* Console.error(
          `banda: ${host.name}'s engine stopped as asked; Banda starts it again when asked`
        )
        yield* Deferred.await(next)
        wait = times.first
        continue
      }
      if (ended.live) wait = times.first
      yield* Console.error(
        `banda: ${host.name} is away (${ended.why}); Banda tries again in ${wait} ms`
      )
      yield* Effect.sleep(wait)
      wait = Math.min(wait * 2, times.longest)
    }
  })

/** One go at `host`, in its own scope: the config checked, the follower
 * and its first line, the forward, and the live host until one ssh ends. */
const once = (
  host: Entry,
  set: (link: Link, address?: Address) => Effect.Effect<void>,
  said: ReturnType<typeof heard>,
  told: Set<string>,
  run: Run
) =>
  Effect.gen(function* () {
    const { times } = run
    /** When a sign-in link showed, which gives the Person longer. */
    let signin: number | undefined
    /** The secret of this go, once known, kept out of what the log says. */
    const kept: { secret?: string } = {}
    /** Logs `child`'s stderr, and takes Tailscale's sign-in link from it
     * while `asks` says ssh is not in yet: what comes after is the other
     * machine's. Each line goes to `also` too. Its fiber ends with the
     * stderr. */
    const watch = (
      child: ChildProcessSpawner.ChildProcessHandle,
      asks: () => boolean,
      also: (line: string) => void = () => {}
    ) =>
      Effect.forkScoped(
        linesOf(child.stderr).pipe(
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const url = asks() ? signInOf(line) : undefined
              if (url) {
                signin ??= yield* Clock.currentTimeMillis
                yield* set({ state: "signin", url })
              }
              also(line)
              yield* said(line, kept.secret)
            })
          ),
          Effect.ignore
        )
      )
    /** Waits as long as the host is given to answer, longer once a sign-in
     * link showed. */
    const late = Effect.gen(function* () {
      const began = yield* Clock.currentTimeMillis
      while (true) {
        const until = Math.max(
          began + times.answer,
          signin === undefined ? 0 : signin + times.signin
        )
        const now = yield* Clock.currentTimeMillis
        if (now >= until) return
        yield* Effect.sleep(until - now)
      }
    })
    // As the window's other children: the follower's stdin is a pipe
    // Banda holds, so if Banda dies the other machine sees it close, and
    // `--with-parent` goes.
    const ssh = (args: string[]) =>
      run.spawner.spawn(command("ssh", args, run.env, "pipe"))

    const config = yield* configOf(host, run).pipe(Effect.result)
    if (config._tag === "Failure")
      return { state: "refused", why: config.failure } satisfies Ended
    const forwards = forwardsIn(config.success)
    if (forwards.length > 0)
      return {
        state: "refused",
        why: `ssh's config forwards ports for ${host.ssh} (${[...new Set(forwards)].join(", ")}), which Banda would have to drop with its own`,
      } satisfies Ended

    const follower = yield* ssh(followerArgs(host))
    const first = yield* Deferred.make<Option.Option<string>>()
    yield* watch(follower, () => !Deferred.isDoneUnsafe(first))
    // Every line is read, so the pipe never fills; the first is the one.
    yield* Effect.forkScoped(
      linesOf(follower.stdout).pipe(
        Stream.runForEach((line) => Deferred.succeed(first, Option.some(line))),
        Effect.ignore,
        Effect.ensuring(Deferred.succeed(first, Option.none()))
      )
    )
    const line = yield* Effect.raceFirst(
      Deferred.await(first),
      Effect.as(late, "late" as const)
    )
    if (line === "late") return away(`${host.ssh} did not answer in time`)
    if (Option.isNone(line)) return endOf(host, yield* exited(follower))
    const running = Schema.decodeUnknownOption(Running)(line.value)
    if (Option.isNone(running)) return yield* refusalIn(host, line.value)
    const { protocol, port, secret, build, version } = running.value
    kept.secret = secret
    if (protocol !== PROTOCOL)
      return {
        state: "refused",
        why: `${host.name}'s engine speaks protocol ${protocol}, this window ${PROTOCOL}`,
      } satisfies Ended
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      !/^[\x21-\x7e]+$/.test(secret)
    )
      return away(`${host.name}'s banda said something unexpected`)
    yield* set({ state: "connecting" })

    for (let tries = 1; ; tries++) {
      const ended: Ended | "again" = yield* Effect.scoped(
        Effect.gen(function* () {
          const from = yield* freePort
          const forward = yield* ssh(forwardArgs(host, from, port))
          let listening = false
          /** Whether ssh said it could not listen on the port. */
          let taken = false
          const reading = yield* watch(
            forward,
            () => !listening,
            (line) => {
              if (!listening && NO_LISTEN.test(line)) taken = true
            }
          )
          const answered = yield* Effect.raceAll([
            answers(host, from, Number(forward.pid), run).pipe(
              Effect.as("answers" as const)
            ),
            exited(forward).pipe(Effect.map((code) => ({ forward: code }))),
            exited(follower).pipe(Effect.map((code) => endOf(host, code))),
            late.pipe(
              Effect.as(
                away(`the forward to ${host.ssh} did not answer in time`)
              )
            ),
          ])
          if (answered !== "answers" && "forward" in answered) {
            // What it said as it ended is all read first.
            yield* Fiber.join(reading).pipe(Effect.timeoutOption("1 second"))
            // Only a port another program holds is a reason for another;
            // else the host waits as after any end.
            return taken
              ? "again"
              : away(
                  `the forward to ${host.ssh} ended before it answered (code ${answered.forward})`
                )
          }
          if (answered !== "answers") return answered
          listening = true
          const now = { build: buildOf(build), version: versionNamed(version) }
          const ours = yield* run.own
          if (
            (now.build !== ours.build || now.version !== ours.version) &&
            !told.has(`${now.build} ${now.version}`)
          ) {
            told.add(`${now.build} ${now.version}`)
            yield* Console.error(
              `banda: ${host.name} runs Banda ${now.version} (build ${now.build}), this window ${ours.version} (build ${ours.build})`
            )
          }
          yield* set(
            { state: "live", ...now, own: ours },
            { url: `ws://127.0.0.1:${from}/ws`, secret }
          )
          yield* Console.error(
            `banda: ${host.name} is live, through loopback port ${from}`
          )
          const end = yield* Effect.raceFirst(
            exited(follower).pipe(Effect.map((code) => endOf(host, code))),
            exited(forward).pipe(
              Effect.map((code) =>
                away(`the forward to ${host.ssh} ended (code ${code})`)
              )
            )
          )
          // Forgotten the moment one ssh ended, before the forward is
          // stopped.
          yield* set(linkOf(end))
          return { ...end, live: true }
        })
      )
      if (ended !== "again") return ended
      if (tries === PORT_TRIES)
        return away(`the forward to ${host.ssh} could not listen`)
      yield* Console.error(
        `banda: the forward to ${host.ssh} could not listen on its port; it tries another`
      )
    }
  }).pipe(
    Effect.catch((error: { message: string }) =>
      Console.error(`banda: ${host.name}: ${error.message}`).pipe(
        Effect.as(away("ssh did not start"))
      )
    )
  )

/** How the follower's end leaves the host: code 0 is its engine stopped
 * as asked, 255 ssh's own failure, 127 no `banda` there, none a signal. */
function endOf(host: Entry, code: number): Ended {
  if (code === 0) return { state: "stopped" }
  if (code === KILLED) return away(`ssh to ${host.ssh} was killed`)
  if (code === 255) return away(`ssh could not reach ${host.ssh}`)
  if (code === NOT_FOUND)
    return {
      state: "refused",
      why:
        host.banda === undefined
          ? `no ${channel.name} found on ${host.name}; set banda in hosts.toml`
          : `no ${host.banda} on ${host.name}; check banda in hosts.toml`,
    }
  return away(`the link to ${host.ssh} ended (code ${code})`)
}

/** A first line that is not where the engine listens: `banda`'s refusal,
 * as of a protocol this build does not speak, or else not Banda's. */
const refusalIn = (host: Entry, line: string) =>
  Option.match(Schema.decodeUnknownOption(Refusal)(line), {
    onNone: () =>
      Effect.succeed(away(`${host.name}'s banda said something unexpected`)),
    onSome: ({ error }) =>
      Console.error(
        `banda: ${host.name}'s banda refused: ${plain(error.message)}`
      ).pipe(
        Effect.as<Ended>({
          state: "refused",
          why:
            error.code === "protocol"
              ? `${host.name} runs a Banda of another build, which does not speak this one's protocol`
              : `${host.name}'s banda refused (${/^[a-z_]{1,32}$/.test(error.code) ? error.code : "?"})`,
        })
      ),
  })

/** The code of a child a signal ended. */
const KILLED = -1

/** The code `child` exited with, or `KILLED`. */
const exited = (child: ChildProcessSpawner.ChildProcessHandle) =>
  child.exitCode.pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => KILLED)
  )

/** What `program args…` prints, and the code it ends with. */
const outputOf = (run: Run, program: string, args: string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* run.spawner.spawn(
        ChildProcess.make(program, args, {
          env: run.env,
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          windowsHide: true,
        })
      )
      return yield* Effect.all(
        [child.stdout.pipe(Stream.decodeText, Stream.mkString), exited(child)],
        { concurrency: 2 }
      )
    })
  )

/** What `ssh -G` says of `host`: its config, as the forward will read it;
 * fails with why when it cannot say. */
const configOf = (host: Entry, run: Run) =>
  outputOf(run, "ssh", ["-G", "--", host.ssh]).pipe(
    Effect.flatMap(([said, code]) =>
      code === 0
        ? Effect.succeed(said)
        : Effect.fail(`ssh -G ended with code ${code}`)
    ),
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () => Effect.fail("ssh -G did not end"),
    }),
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(`ssh -G did not run: ${error.message}`)
    )
  )

/** A port free on this machine's loopback now. */
const freePort = Effect.callback<number, Error>((resume) => {
  const server = createServer()
  server.once("error", (error) => resume(Effect.fail(error)))
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo
    server.close(() => resume(Effect.succeed(port)))
  })
})

/** Waits until the forward, process `pid`, listens on loopback port
 * `port`. A program that took the port first is not it, though it
 * answers: ssh's arguments show the port to every user of this machine,
 * and the page gives what answers there the secret. */
const answers = (host: Entry, port: number, pid: number, run: Run) =>
  Effect.gen(function* () {
    let told = false
    while (true) {
      if (yield* takes(port)) {
        if (yield* heldBy(pid, port, run)) return
        if (!told)
          yield* Console.error(
            `banda: another program listens on port ${port}, not the forward to ${host.ssh}; Banda waits for the forward`
          )
        told = true
      }
      yield* Effect.sleep(100)
    }
  })

/** Whether process `pid` holds the listening socket of loopback port
 * `port`: on Linux as /proc says, on macOS lsof, on Windows netstat. Not
 * known is no. */
const heldBy = (
  pid: number,
  port: number,
  run: Run
): Effect.Effect<boolean> => {
  switch (process.platform) {
    case "linux":
      return Effect.sync(() => heldOnLinux(pid, port))
    case "darwin":
      return outputOf(run, "/usr/sbin/lsof", [
        "-nP",
        "-a",
        "-p",
        String(pid),
        `-iTCP@127.0.0.1:${port}`,
        "-sTCP:LISTEN",
        "-t",
      ]).pipe(
        Effect.map(([said]) => said.split("\n").includes(String(pid))),
        Effect.orElseSucceed(() => false)
      )
    case "win32":
      return outputOf(run, "netstat", ["-ano", "-p", "TCP"]).pipe(
        Effect.map(([said]) => listenersIn(said, port).includes(pid)),
        Effect.orElseSucceed(() => false)
      )
    default:
      return Effect.succeed(false)
  }
}

/** Whether one of process `pid`'s files is the socket /proc/net/tcp says
 * listens on loopback port `port`. */
function heldOnLinux(pid: number, port: number): boolean {
  const at = `:${port.toString(16).toUpperCase().padStart(4, "0")}`
  try {
    const sockets = new Set(
      readFileSync("/proc/net/tcp", "utf8")
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter(
          ([, local, , state]) =>
            state === "0A" &&
            (local === `0100007F${at}` || local === `7F000001${at}`)
        )
        .map((fields) => `socket:[${fields[9]}]`)
    )
    if (sockets.size === 0) return false
    return readdirSync(`/proc/${pid}/fd`).some((fd) => {
      try {
        return sockets.has(readlinkSync(`/proc/${pid}/fd/${fd}`))
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

/** The processes `netstat -ano` says listen on loopback port `port`:
 * a TCP line from `127.0.0.1:<port>` to `0.0.0.0:0`, whatever word the
 * system's language has for its state, its pid last. */
export const listenersIn = (said: string, port: number) =>
  said.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    return fields[0] === "TCP" &&
      fields[1] === `127.0.0.1:${port}` &&
      fields[2] === "0.0.0.0:0"
      ? [Number(fields.at(-1))]
      : []
  })

const takes = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => {
      socket.destroy()
      resume(Effect.succeed(true))
    })
    socket.once("error", () => {
      socket.destroy()
      resume(Effect.succeed(false))
    })
    return Effect.sync(() => socket.destroy())
  })

/** Logs what ssh said for host `name`, as `plain` takes it and with
 * the go's secret, should it show, taken out, at most `LINES_A_MINUTE`
 * lines a minute. */
function heard(name: string) {
  let since = Number.NEGATIVE_INFINITY
  let count = 0
  return (line: string, secret: string | undefined) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (now - since >= 60_000) {
        since = now
        count = 0
      }
      count += 1
      if (count > LINES_A_MINUTE) {
        if (count === LINES_A_MINUTE + 1)
          yield* Console.error(
            `banda: ${name}: ssh says more; the log takes it again in a minute`
          )
        return
      }
      const text = plain(secret ? line.split(secret).join("…") : line)
      if (text) yield* Console.error(`banda: ${name}: ssh said: ${text}`)
    })
}
