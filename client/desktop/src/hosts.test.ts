import { spawnSync } from "node:child_process"
import { createConnection, createServer, type Server } from "node:net"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import type { HostState } from "@banda/web/host"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import { channel, CHANNELS } from "./channel"
import {
  followerArgs,
  forwardArgs,
  forwardsIn,
  Hosts,
  hostsOf,
  linesOf,
  listenersIn,
  ownOf,
  remoteCommand,
  signInOf,
  type Times,
} from "./hosts"
import { Program } from "./program"
import { script } from "./testing"

const DEVBOX = {
  name: "devbox",
  ssh: "devbox",
  banda: "~/.local/bin/banda-dev",
}

it("hosts.toml keeps its good hosts and refuses the others, saying why", () => {
  const { hosts, refused } = hostsOf(
    `
[[hosts]]
name = "devbox"
ssh = "roma@devbox"
banda = "~/.local/bin/banda-dev"

[[hosts]]
name = "box-2"
ssh = "box2.tail1234.ts.net"

[[hosts]]
name = "Devbox"
ssh = "x"

[[hosts]]
name = "local"
ssh = "x"

[[hosts]]
name = "devbox"
ssh = "other"

[[hosts]]
name = "a"
ssh = "-oProxyCommand=touch /tmp/x"

[[hosts]]
name = "b"
ssh = "two words"

[[hosts]]
name = "c"
ssh = "line\\nbreak"

[[hosts]]
name = "d"
ssh = "d"
banda = "bin/banda"

[[hosts]]
name = "e"
ssh = "e"
banda = "~/bin/banda; rm -rf ~"

[[hosts]]
name = "f"
ssh = "f"
banda = "~/$(whoami)/banda"

[[hosts]]
name = "g"
ssh = "devbox;touch /tmp/x"

[[hosts]]
name = "box-3"
ssh = "ssh://roma@[fd7a:115c::1]:2222"
`
  )
  expect(hosts).toEqual([
    { name: "devbox", ssh: "roma@devbox", banda: "~/.local/bin/banda-dev" },
    // With no `banda`, this build's own, as the follower finds it there.
    { name: "box-2", ssh: "box2.tail1234.ts.net" },
    { name: "box-3", ssh: "ssh://roma@[fd7a:115c::1]:2222" },
  ])
  expect(hosts[1]!.banda).toBeUndefined()
  expect(refused).toHaveLength(10)
  expect(refused[0]).toMatch(/^host 3: `name` is not lowercase/)
  expect(refused[1]).toMatch(/"local" is Banda's own/)
  expect(refused[2]).toMatch(/"devbox" is taken/)
  for (const at of [3, 4, 5, 9])
    expect(refused[at]).toMatch(/`ssh` is not letters/)
  for (const at of [6, 7, 8]) expect(refused[at]).toMatch(/`banda` is not/)
  expect(hostsOf(`name = "devbox"`).hosts).toEqual([])
  expect(hostsOf(`[[hosts]\nname=`).refused[0]).toMatch(/^it is not TOML/)
})

it("the follower takes no agent, no X11, no forward, no tunnel, no command of the config's and no shared connection, and runs banda through sh", () => {
  const args = followerArgs(DEVBOX)
  for (const one of ["-T", "-a", "-x"]) expect(args).toContain(one)
  for (const option of [
    "BatchMode=yes",
    "RemoteCommand=none",
    "Tunnel=no",
    "LogLevel=INFO",
    "ForwardAgent=no",
    "ForwardX11=no",
    "ClearAllForwardings=yes",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=2",
    "ControlPath=none",
    "ControlMaster=no",
  ])
    expect(args[args.indexOf(option) - 1]).toBe("-o")
  // The destination comes after `--`, and the remote command last.
  expect(args.slice(-3)).toEqual(["--", "devbox", remoteCommand(DEVBOX.banda)])
  expect(remoteCommand(DEVBOX.banda)).toBe(
    `sh -c 'exec env XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" ~/.local/bin/banda-dev start --with-parent'`
  )
})

/** The folders a test made, removed after each test. */
const folders: string[] = []

/** A folder of the test's own, removed after it. */
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "banda-hosts-"))
  folders.push(dir)
  return dir
}

/** A `banda` at `path` that says where it is and what it was given. */
function fakeBanda(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `#!/bin/sh\necho "$0 $*"\n`, { mode: 0o755 })
}

it.skipIf(process.platform === "win32")(
  "with no banda in hosts.toml the follower runs this build's own there: on PATH, else the newest copy in its data folder, else none, and exits 127",
  () => {
    const own = { folder: "banda-findme", name: "Banda Findme" }
    const home = folder()
    const bin = join(home, "bin")
    const copies = join(home, ".local/share/banda-findme/engine")
    const there = (env: Record<string, string>) =>
      // As the login shell there takes the command ssh gives it.
      spawnSync("/bin/sh", ["-c", remoteCommand(undefined, own)], {
        env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...env },
        encoding: "utf8",
      })
    // None at all.
    const none = there({})
    expect(none.status).toBe(127)
    expect(none.stdout).toBe("")
    expect(none.stderr).toBe("no Banda Findme here\n")
    // The newest copy, as versions sort, not as text; not a half-written
    // one (program.ts's `.<version>-` folders).
    for (const version of ["0.1.0-dev.42", "0.1.0-dev.418", "0.1.0-dev.9"])
      fakeBanda(join(copies, version, "banda"))
    fakeBanda(join(copies, ".0.1.0-dev.500-x1", "banda"))
    expect(there({}).stdout).toBe(
      `${copies}/0.1.0-dev.418/banda start --with-parent\n`
    )
    // XDG_DATA_HOME moves the data folder.
    const data = join(home, "data")
    fakeBanda(join(data, "banda-findme/engine/0.1.0-dev.1/banda"))
    expect(there({ XDG_DATA_HOME: data }).stdout).toBe(
      `${data}/banda-findme/engine/0.1.0-dev.1/banda start --with-parent\n`
    )
    // On PATH first.
    fakeBanda(join(bin, "banda-findme"))
    expect(there({}).stdout).toBe(`${bin}/banda-findme start --with-parent\n`)
  }
)

it("the follower's script takes each channel's names as they are, inside sh's quotes", () => {
  for (const own of Object.values(CHANNELS)) {
    expect(own.folder).toMatch(/^[a-z0-9-]+$/)
    expect(own.name).toMatch(/^[A-Za-z0-9 -]+$/)
    const said = remoteCommand(undefined, own)
    expect(said.startsWith("sh -c '") && said.endsWith("'")).toBe(true)
    // Nothing that ends the quotes, nor that fish reads as an escape.
    expect(said.slice(7, -1)).not.toMatch(/['\\]/)
    expect(said).toContain(
      `"/Applications/${own.name}.app/Contents/Resources/banda"`
    )
  }
})

it.effect(
  "each line from ssh is read up to 4 KiB, the rest of a longer one dropped",
  () =>
    Effect.gen(function* () {
      const bytes = (text: string) => new TextEncoder().encode(text)
      const said = yield* linesOf(
        Stream.make(
          bytes("one\r\ntw"),
          bytes("o\n\n"),
          bytes("x".repeat(3000)),
          bytes("y".repeat(3000) + "z\nafter\n"),
          bytes("é".repeat(3000)),
          bytes("\nlast")
        )
      ).pipe(Stream.runCollect)
      expect(said.slice(0, 3)).toEqual(["one", "two", ""])
      expect(said[3]).toBe("x".repeat(3000) + "y".repeat(1096))
      expect(said[4]).toBe("after")
      // 2 bytes each: 2048 of them.
      expect(said[5]).toBe("é".repeat(2048))
      expect(said[6]).toBe("last")
      expect(said).toHaveLength(7)
    })
)

it("the forward listens on this machine's loopback alone, to that machine's loopback, and ends when it cannot", () => {
  const args = forwardArgs(DEVBOX, 40_001, 4321)
  expect(args[0]).toBe("-N")
  expect(args[args.indexOf("-L") + 1]).toBe("127.0.0.1:40001:127.0.0.1:4321")
  expect(args[args.indexOf("ExitOnForwardFailure=yes") - 1]).toBe("-o")
  for (const option of ["BatchMode=yes", "ForwardAgent=no", "ForwardX11=no"])
    expect(args).toContain(option)
  for (const one of ["-T", "-a", "-x"]) expect(args).toContain(one)
  expect(args).not.toContain("ClearAllForwardings=yes")
  expect(args.slice(-2)).toEqual(["--", "devbox"])
})

it("ssh's config is read for forwards of its own", () => {
  expect(forwardsIn("hostname devbox\nport 22\nforwardagent no\n")).toEqual([])
  expect(
    forwardsIn(
      "hostname devbox\nlocalforward [127.0.0.1]:8080 [localhost]:80\nDynamicForward 1080\nremoteforward 9 x:9\n"
    )
  ).toEqual(["localforward", "dynamicforward", "remoteforward"])
})

it("only Tailscale's sign-in link is a sign-in", () => {
  expect(
    signInOf("# To authenticate, visit: https://login.tailscale.com/a/1a2b3c")
  ).toBe("https://login.tailscale.com/a/1a2b3c")
  for (const line of [
    "To authenticate, visit: http://login.tailscale.com/a/1a2b3c",
    "To authenticate, visit: https://login.tailscale.com.evil.example/a/1",
    "To authenticate, visit: https://login.tailscale.com@evil.example/a/1",
    "To authenticate, visit: https://evil.example/https://login.tailscale.com/",
    "To authenticate, visit: https://login.tailscale.co/a/1",
    "To authenticate, visit: javascript:alert(1)",
    "Welcome to devbox",
  ])
    expect(signInOf(line)).toBeUndefined()
})

it("netstat's listeners of a loopback port are read in any language", () => {
  const said = [
    "",
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:41234          0.0.0.0:0              LISTENING       11",
    "  TCP    127.0.0.1:41234        0.0.0.0:0              ABHÖREN         22",
    "  TCP    127.0.0.1:41234        127.0.0.1:50000        ESTABLISHED     33",
    "  TCP    127.0.0.1:412345       0.0.0.0:0              LISTENING       44",
  ].join("\r\n")
  expect(listenersIn(said, 41_234)).toEqual([22])
  expect(listenersIn(said, 4123)).toEqual([])
})

it("this window's build is read from its banda's --version", () => {
  expect(ownOf("banda 0.1.0-dev.375 (build 1d72c32048b3)")).toEqual({
    version: "0.1.0-dev.375",
    build: "1d72c32048b3",
  })
  expect(ownOf("something else")).toEqual({ version: null, build: null })
})

/** One step a fake ssh run takes: print a line on stdout or stderr, wait
 * for a file of the test's, listen on the forward's port, or exit. */
type Step = {
  out?: string
  err?: string
  until?: string
  listen?: true
  exit?: number
}
/** What the fake ssh plays: what `-G` prints, and each run of the
 * follower and of the forward; the last run plays again. */
type Play = { config?: string; followers: Step[][]; forwards?: Step[][] }

/** The fake `ssh`: it notes each run's arguments, environment and pid, and
 * plays its part (`Play`). As ssh, the follower ends with code 0 as its
 * stdin closes, and the forward listens on the port `-L` names. */
const FAKE = `
const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const at = (name) => path.join(__dirname, name)
const args = process.argv.slice(2)
fs.appendFileSync(at("calls"), JSON.stringify({ args, env: process.env, pid: process.pid }) + "\\n")
const play = JSON.parse(fs.readFileSync(at("play.json"), "utf8"))
if (args[0] === "-G") {
  process.stdout.write(play.config ?? "hostname devbox\\nport 22\\n")
  process.exit(0)
}
const kind = args.includes("-N") ? "forward" : "follower"
const runs = play[kind + "s"] ?? [[{ listen: true }]]
const run = fs.existsSync(at(kind)) ? Number(fs.readFileSync(at(kind), "utf8")) : 0
fs.writeFileSync(at(kind), String(run + 1))
if (kind === "follower") process.stdin.on("end", () => process.exit(0)).resume()
const until = (name) =>
  new Promise((done) => {
    const look = setInterval(() => {
      if (fs.existsSync(at(name))) clearInterval(look), done()
    }, 20)
  })
;(async () => {
  for (const step of runs[Math.min(run, runs.length - 1)]) {
    if (step.out !== undefined) process.stdout.write(step.out + "\\n")
    if (step.err !== undefined) process.stderr.write(step.err + "\\n")
    if (step.until) await until(step.until)
    if (step.listen) {
      const port = Number(args[args.indexOf("-L") + 1].split(":")[1])
      // As ssh with ExitOnForwardFailure, it ends when the port is taken.
      await new Promise((done) =>
        net
          .createServer((socket) => socket.destroy())
          .once("error", () => {
            process.stderr.write("bind [127.0.0.1]:" + port + ": Address already in use\\n")
            process.exit(255)
          })
          .listen(port, "127.0.0.1", done)
      )
    }
    if (step.exit !== undefined) process.exit(step.exit)
  }
  setInterval(() => {}, 1 << 30)
})()
`

/** A fake ssh first on PATH, in a folder of its own, playing `play`. */
function fakeSsh(play: Play) {
  const dir = folder()
  writeFileSync(join(dir, "play.json"), JSON.stringify(play))
  writeFileSync(join(dir, "ssh"), `#!${process.execPath}\n${FAKE}`, {
    mode: 0o755,
  })
  const calls = () =>
    readFileSync(join(dir, "calls"), "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            args: string[]
            env: Record<string, string>
            pid: number
          }
      )
  return {
    dir,
    env: { PATH: `${dir}${delimiter}${process.env.PATH}` },
    /** Each run's arguments, and its environment. */
    calls,
    /** The runs of one kind. */
    runs: (kind: "-G" | "-N" | "follower") =>
      calls().filter(({ args }) =>
        kind === "follower"
          ? args[0] !== "-G" && !args.includes("-N")
          : args.includes(kind)
      ),
    /** Lets a step that waits for `name` go on. */
    touch: (name: string) => writeFileSync(join(dir, name), ""),
  }
}

/** What `start --with-parent` prints first, with `secret` and `port`. */
const running = (secret: string, port: number, protocol = 1) =>
  JSON.stringify({
    protocol,
    port,
    secret,
    build: "abc123",
    version: "0.1.0-dev.2",
    pid: 7,
    unit: "banda-dev.service",
    window: "/run/user/1000/banda-dev/window",
  })

const FAST: Times = {
  first: 50,
  longest: 200,
  refused: 60_000,
  answer: 5_000,
  signin: 10_000,
}

const DEVBOX_TOML = `[[hosts]]\nname = "devbox"\nssh = "devbox"\nbanda = "~/.local/bin/banda-dev"\n`

/** The hosts of `toml`, their ssh `fake`, this window's banda of build
 * `def456`. */
function hostsOn(
  fake: ReturnType<typeof fakeSsh>,
  times: Partial<Times> = {},
  toml = DEVBOX_TOML
) {
  const file = join(fake.dir, "hosts.toml")
  writeFileSync(file, toml)
  return Hosts.layer(file, {
    env: fake.env,
    times: { ...FAST, ...times },
  }).pipe(
    Layer.provide(
      Program.layer({
        program: script(`echo "banda 0.1.0-dev.1 (build def456)"`),
      })
    ),
    Layer.provide(NodeServices.layer)
  )
}

/** Waits for the first host to be as `check` says, and gives it. */
const reaches = (check: (host: HostState) => boolean) =>
  Hosts.use((hosts) =>
    hosts.changes.pipe(
      Stream.map((list) => list[0]!),
      Stream.filter(check),
      Stream.runHead,
      Effect.map(Option.getOrThrow)
    )
  )

/** Every state the first host takes from now, as it takes it. */
const watched = Effect.gen(function* () {
  const seen: HostState[] = []
  yield* Hosts.use((hosts) =>
    hosts.changes.pipe(
      Stream.runForEach((list) => Effect.sync(() => seen.push(list[0]!)))
    )
  ).pipe(Effect.forkScoped)
  return seen
})

/** The forward's port on this machine, as its `nth` run was given it. */
const portOf = (fake: ReturnType<typeof fakeSsh>, nth = 0) => {
  const args = fake.runs("-N")[nth]!.args
  return Number(args[args.indexOf("-L") + 1]!.split(":")[1])
}

/** Whether something listens on loopback port `port`. */
const listens = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once(
      "connect",
      () => (socket.destroy(), resume(Effect.succeed(true)))
    )
    socket.once("error", () => resume(Effect.succeed(false)))
  })

/** Waits until `check` holds; one that throws does not, yet. */
const until = (check: () => boolean) =>
  Effect.gen(function* () {
    const holds = () => {
      try {
        return check()
      } catch {
        return false
      }
    }
    while (!holds()) yield* Effect.sleep(20)
  })

/** What main logged meanwhile. */
let logged: string[] = []
beforeEach(() => {
  logged = []
  vi.spyOn(console, "error").mockImplementation((...said: unknown[]) => {
    logged.push(said.join(" "))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of folders.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

it.live(
  "the page gets the forward's address only once the forward answers, and the secret goes nowhere else",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [[{ out: running("s3cr3t-one", 4321), err: "Welcome" }]],
        forwards: [[{ until: "go" }, { listen: true }]],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        yield* Effect.sleep(500)
        expect(fake.runs("-N")).toHaveLength(1)
        expect((yield* hosts.current)[0]).toEqual({
          name: "devbox",
          state: "connecting",
        })
        expect(
          yield* Effect.timeoutOption(hosts.address("devbox"), 200)
        ).toEqual(Option.none())
        fake.touch("go")
        const address = yield* hosts.address("devbox")
        const port = portOf(fake)
        expect(address).toEqual({
          url: `ws://127.0.0.1:${port}/ws`,
          secret: "s3cr3t-one",
        })
        expect(yield* listens(port)).toBe(true)
        expect((yield* hosts.current)[0]).toEqual({
          name: "devbox",
          state: "live",
          build: "abc123",
          version: "0.1.0-dev.2",
          own: { build: "def456", version: "0.1.0-dev.1" },
        })
        // ssh -G first, then the follower, then the forward to the port
        // the follower was told.
        expect(fake.calls().map(({ args }) => args)).toEqual([
          ["-G", "--", "devbox"],
          followerArgs(DEVBOX),
          forwardArgs(DEVBOX, port, 4321),
        ])
        // What ssh said is in the log, and that the builds differ, once.
        expect(logged).toContain("banda: devbox: ssh said: Welcome")
        expect(logged).toContain(
          `banda: devbox is live, through loopback port ${port}`
        )
        expect(
          logged.filter((line) => line.includes("runs Banda 0.1.0-dev.2"))
        ).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
      expect(JSON.stringify(fake.calls())).not.toContain("s3cr3t-one")
      expect(logged.join("\n")).not.toContain("s3cr3t-one")
    }),
  20_000
)

it.live(
  "the address is forgotten the moment either ssh ends, and the next first line brings a new port and secret",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [{ out: running("one", 1111) }, { until: "cut" }, { exit: 1 }],
          [{ out: running("two", 2222) }],
          [{ out: running("three", 3333) }],
        ],
        forwards: [
          [{ listen: true }],
          [{ listen: true }, { until: "drop" }, { exit: 255 }],
          [{ listen: true }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect((yield* hosts.address("devbox")).secret).toBe("one")
        const seen = yield* watched
        // The follower ends.
        fake.touch("cut")
        const left = yield* reaches((host) => host.state === "away")
        expect(left).toEqual({
          name: "devbox",
          state: "away",
          why: "the link to devbox ended (code 1)",
        })
        // Live, then away at once: never live with the old address.
        yield* Effect.sleep(50)
        expect(seen.map((host) => host.state)).toEqual(["live", "away"])
        expect(
          yield* Effect.timeoutOption(hosts.address("devbox"), 300)
        ).toEqual(Option.none())
        // It comes back with the second run's port and secret.
        const second = yield* hosts.address("devbox")
        expect(second.secret).toBe("two")
        expect(fake.runs("-N")[1]!.args).toContain(
          `127.0.0.1:${portOf(fake, 1)}:127.0.0.1:2222`
        )
        expect(second.url).toBe(`ws://127.0.0.1:${portOf(fake, 1)}/ws`)
        // The forward ends.
        fake.touch("drop")
        expect(yield* reaches((host) => host.state === "away")).toEqual({
          name: "devbox",
          state: "away",
          why: "the forward to devbox ended (code 255)",
        })
        expect(
          yield* Effect.timeoutOption(hosts.address("devbox"), 300)
        ).toEqual(Option.none())
        expect((yield* hosts.address("devbox")).secret).toBe("three")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, { first: 1_000 })))
    }),
  20_000
)

it.live(
  "an engine stopped there as asked leaves the host stopped and Banda running: asking for its address waits, and only starting it starts it",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [{ out: running("one", 1111) }, { until: "stop" }, { exit: 0 }],
          [{ out: running("two", 2222) }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        yield* hosts.address("devbox")
        fake.touch("stop")
        yield* reaches((host) => host.state === "stopped")
        // No timer starts the engine the Person stopped, nor does asking
        // where it listens.
        const asked = yield* Effect.forkScoped(hosts.address("devbox"))
        yield* Effect.sleep(500)
        expect((yield* hosts.current)[0]!.state).toBe("stopped")
        expect(fake.runs("follower")).toHaveLength(1)
        expect(asked.pollUnsafe()).toBeUndefined()
        expect(logged).toContain(
          "banda: devbox's engine stopped as asked; Banda starts it again when asked"
        )
        // Starting it does, and the one waiting gets its address.
        yield* hosts.start("devbox")
        expect((yield* Fiber.join(asked)).secret).toBe("two")
        expect(fake.runs("follower")).toHaveLength(2)
        // Starting a live host does nothing; one not in hosts.toml fails.
        yield* hosts.start("devbox")
        yield* Effect.sleep(200)
        expect(fake.runs("follower")).toHaveLength(2)
        const unknown = yield* Effect.flip(hosts.start("nowhere"))
        expect(unknown.message).toMatch(/no host "nowhere"/)
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a refusal from banda there leaves the host refused: it is tried again at once when asked, else after a long wait",
  () =>
    Effect.gen(function* () {
      const play: Play = {
        followers: [
          [
            {
              out: JSON.stringify({
                error: {
                  code: "protocol",
                  message: "Banda's engine of another build runs: s3cr3t",
                },
              }),
              exit: 1,
            },
          ],
        ],
      }
      const fake = fakeSsh(play)
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect(yield* reaches((host) => host.state === "refused")).toEqual({
          name: "devbox",
          state: "refused",
          why: "devbox runs a Banda of another build, which does not speak this one's protocol",
        })
        yield* Effect.sleep(300)
        expect(fake.runs("follower")).toHaveLength(1)
        // Asking where it listens tries it again, and fails with the new
        // go's refusal, not the old one's.
        const asked = yield* Effect.flip(hosts.address("devbox"))
        expect(asked.message).toMatch(/^devbox: devbox runs a Banda/)
        expect(fake.runs("follower")).toHaveLength(2)
        // So does starting it.
        yield* hosts.start("devbox")
        yield* until(() => fake.runs("follower").length === 3)
        const unknown = yield* Effect.flip(hosts.address("nowhere"))
        expect(unknown.message).toMatch(/no host "nowhere"/)
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
      // With no one asking, after the long wait.
      const slow = fakeSsh(play)
      yield* Effect.gen(function* () {
        yield* until(() => slow.runs("follower").length === 2)
        expect(logged).toContainEqual(
          expect.stringMatching(
            /^banda: devbox is refused: .*; Banda tries again in 300 ms, or when asked$/
          )
        )
      }).pipe(Effect.scoped, Effect.provide(hostsOn(slow, { refused: 300 })))
    }),
  20_000
)

it.live(
  "with no Banda there the host is refused, saying how to set it, and not tried again soon",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [[{ err: "no Banda Local here", exit: 127 }]],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect(yield* reaches((host) => host.state === "refused")).toEqual({
          name: "devbox",
          state: "refused",
          why: `no ${channel.name} found on devbox; set banda in hosts.toml`,
        })
        // Past the wait after an ssh that ends: not tried again.
        yield* Effect.sleep(400)
        expect(fake.runs("follower")).toHaveLength(1)
        const asked = yield* Effect.flip(hosts.address("devbox"))
        expect(asked.message).toBe(
          `devbox: no ${channel.name} found on devbox; set banda in hosts.toml`
        )
        // The follower looked for it, as no banda is set.
        expect(fake.runs("follower")[0]!.args.at(-1)).toBe(
          remoteCommand(undefined)
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          hostsOn(fake, {}, `[[hosts]]\nname = "devbox"\nssh = "devbox"\n`)
        )
      )
      // A `banda` set in hosts.toml and not there says so.
      const set = fakeSsh({ followers: [[{ exit: 127 }]] })
      yield* reaches((host) => host.state === "refused").pipe(
        Effect.map((host) =>
          expect(host).toEqual({
            name: "devbox",
            state: "refused",
            why: "no ~/.local/bin/banda-dev on devbox; check banda in hosts.toml",
          })
        ),
        Effect.scoped,
        Effect.provide(hostsOn(set))
      )
    }),
  20_000
)

it.live(
  "an engine there that speaks another protocol than the page leaves the host refused",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ out: running("one", 1111, 2) }]] })
      yield* Effect.gen(function* () {
        expect(yield* reaches((host) => host.state === "refused")).toEqual({
          name: "devbox",
          state: "refused",
          why: "devbox's engine speaks protocol 2, this window 1",
        })
        expect(fake.runs("-N")).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a host whose ssh config forwards ports of its own is refused before ssh connects",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        config: "hostname devbox\nlocalforward 8080 [localhost]:80\n",
        followers: [[{ out: running("one", 1111) }]],
      })
      yield* Effect.gen(function* () {
        const refused = yield* reaches((host) => host.state === "refused")
        expect(refused).toMatchObject({
          why: expect.stringMatching(/forwards ports.*localforward/),
        })
        expect(fake.calls().map(({ args }) => args)).toEqual([
          ["-G", "--", "devbox"],
        ])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "Tailscale's sign-in link waits for the Person, past the time to answer; no other link is a sign-in",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [
            { err: "visit: https://login.tailscale.com.evil.example/a/1" },
            { err: "visit: http://login.tailscale.com/a/2" },
            { err: "# Tailscale SSH requires an additional check." },
            {
              err: "# To authenticate, visit: https://login.tailscale.com/a/3c",
            },
            { until: "signed" },
            { out: running("one", 1111) },
            { until: "later" },
            {
              err: "# To authenticate, visit: https://login.tailscale.com/a/later",
            },
          ],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const seen = yield* watched
        expect(yield* reaches((host) => host.state === "signin")).toEqual({
          name: "devbox",
          state: "signin",
          url: "https://login.tailscale.com/a/3c",
        })
        // Longer than the host has to answer: the ssh is kept.
        yield* Effect.sleep(800)
        expect((yield* hosts.current)[0]!.state).toBe("signin")
        expect(fake.runs("follower")).toHaveLength(1)
        fake.touch("signed")
        expect((yield* hosts.address("devbox")).secret).toBe("one")
        // Once ssh is in, what it prints is the other machine's: a link
        // then is no sign-in.
        fake.touch("later")
        yield* until(() =>
          logged.some((line) => line.includes("login.tailscale.com/a/later"))
        )
        expect((yield* hosts.current)[0]!.state).toBe("live")
        expect(
          seen.filter((host) => host.state === "signin").map((host) => host)
        ).toEqual([
          {
            name: "devbox",
            state: "signin",
            url: "https://login.tailscale.com/a/3c",
          },
        ])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, { answer: 300 })))
    }),
  20_000
)

it.live(
  "an ssh that cannot connect, or a first line that is not Banda's, leaves the host away, and it is tried again",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [{ err: "ssh: connect to host devbox port 22: refused", exit: 255 }],
          [{ out: "Welcome to devbox!" }],
          [{ out: running("one", 1111) }],
        ],
      })
      yield* Effect.gen(function* () {
        const seen = yield* watched
        yield* reaches((host) => host.state === "live")
        expect(
          seen.flatMap((host) => (host.state === "away" ? [host.why] : []))
        ).toEqual([
          "ssh could not reach devbox",
          "devbox's banda said something unexpected",
        ])
        expect(logged.join("\n")).not.toContain("Welcome to devbox!")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a forward that cannot listen tries another port",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [[{ out: running("one", 1111) }]],
        forwards: [
          [{ err: "bind [127.0.0.1]:1: Address already in use", exit: 255 }],
          [{ listen: true }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const address = yield* hosts.address("devbox")
        expect(fake.runs("-N")).toHaveLength(2)
        expect(fake.runs("follower")).toHaveLength(1)
        expect(address.url).toBe(`ws://127.0.0.1:${portOf(fake, 1)}/ws`)
        expect(logged).toContain(
          "banda: the forward to devbox could not listen on its port; it tries another"
        )
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a forward that ends early for another reason waits as after any end, and the next go starts from ssh's config",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [[{ out: running("one", 1111) }]],
        forwards: [
          [{ err: "ssh: connect to host devbox port 22: refused", exit: 255 }],
          [{ listen: true }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const seen = yield* watched
        const address = yield* hosts.address("devbox")
        expect(
          seen.flatMap((host) => (host.state === "away" ? [host.why] : []))
        ).toEqual(["the forward to devbox ended before it answered (code 255)"])
        expect(fake.runs("-G")).toHaveLength(2)
        expect(fake.runs("follower")).toHaveLength(2)
        expect(fake.runs("-N")).toHaveLength(2)
        expect(address.url).toBe(`ws://127.0.0.1:${portOf(fake, 1)}/ws`)
        expect(logged.join("\n")).not.toContain("tries another")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a program that took the forward's port first is not the forward: it gets no address, and the forward tries another port",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [[{ out: running("s3cr3t-one", 1111) }]],
        forwards: [[{ until: "taken" }, { listen: true }], [{ listen: true }]],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const seen = yield* watched
        yield* until(() => fake.runs("-N").length === 1)
        const taken = portOf(fake)
        // Another user's program listens there before ssh does.
        yield* Effect.acquireRelease(
          Effect.callback<Server>((resume) => {
            const server = createServer((socket) => socket.destroy())
            server.listen(taken, "127.0.0.1", () =>
              resume(Effect.succeed(server))
            )
          }),
          (server) => Effect.sync(() => server.close())
        )
        yield* Effect.sleep(500)
        expect(seen.map((host) => host.state)).not.toContain("live")
        expect(
          yield* Effect.timeoutOption(hosts.address("devbox"), 200)
        ).toEqual(Option.none())
        expect(logged).toContain(
          `banda: another program listens on port ${taken}, not the forward to devbox; Banda waits for the forward`
        )
        // ssh cannot listen, ends, and the next forward takes another port.
        fake.touch("taken")
        const address = yield* hosts.address("devbox")
        expect(portOf(fake, 1)).not.toBe(taken)
        expect(address.url).toBe(`ws://127.0.0.1:${portOf(fake, 1)}/ws`)
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "quitting Banda ends both ssh",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ out: running("one", 1111) }]] })
      yield* Hosts.use((hosts) => hosts.address("devbox")).pipe(
        Effect.provide(hostsOn(fake))
      )
      const pids = [...fake.runs("follower"), ...fake.runs("-N")].map(
        ({ pid }) => pid
      )
      expect(pids).toHaveLength(2)
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
    }),
  20_000
)

it.live(
  "what the other machine prints on stderr is logged plain, cut short, a few lines a minute, without the secret",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [
            { out: running("s3cr3t-one", 1111) },
            { err: "it was s3cr3t-one\u001b[31m red" },
            ...Array.from({ length: 40 }, (_, at) => ({ err: `line ${at}` })),
          ],
        ],
      })
      yield* Effect.gen(function* () {
        yield* reaches((host) => host.state === "live")
        yield* Effect.sleep(300)
        const told = logged.filter((line) => line.startsWith("banda: devbox:"))
        expect(told[0]).toBe("banda: devbox: ssh said: it was … [31m red")
        expect(told).toHaveLength(21)
        expect(told.at(-1)).toMatch(/ssh says more/)
        expect(logged.join("\n")).not.toContain("s3cr3t-one")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "past 4 KiB, a line from either ssh is dropped: what comes after counts for nothing",
  () =>
    Effect.gen(function* () {
      const long = "x".repeat(5000)
      const fake = fakeSsh({
        followers: [
          [
            { err: `${long} https://login.tailscale.com/a/1` },
            // Whole, it is where the engine listens.
            { out: `${" ".repeat(5000)}${running("one", 1111)}` },
          ],
          [{ out: running("two", 2222) }],
        ],
        forwards: [
          [{ err: `${long} cannot listen to port: 5`, exit: 255 }],
          [{ listen: true }],
        ],
      })
      yield* Effect.gen(function* () {
        const seen = yield* watched
        const live = yield* reaches((host) => host.state === "live")
        expect(live).toMatchObject({ state: "live" })
        expect(seen.map((host) => host.state)).not.toContain("signin")
        expect(
          seen.flatMap((host) => (host.state === "away" ? [host.why] : []))
        ).toEqual([
          "devbox's banda said something unexpected",
          "the forward to devbox ended before it answered (code 255)",
        ])
        expect(
          (yield* Hosts.use((hosts) => hosts.address("devbox"))).secret
        ).toBe("two")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a bad host in hosts.toml is logged and left out, and the good ones are reached",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ out: running("one", 1111) }]] })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect((yield* hosts.current).map((host) => host.name)).toEqual([
          "devbox",
        ])
        expect(logged.some((line) => /host 2: `ssh`/.test(line))).toBe(true)
        yield* hosts.address("devbox")
      }).pipe(
        Effect.scoped,
        Effect.provide(
          hostsOn(
            fake,
            {},
            `${DEVBOX_TOML}\n[[hosts]]\nname = "evil"\nssh = "-oProxyCommand=x"\n`
          )
        )
      )
    }),
  20_000
)

it.live("with no hosts.toml there are no hosts", () =>
  Effect.gen(function* () {
    const fake = fakeSsh({ followers: [] })
    const none = Hosts.layer(join(fake.dir, "missing.toml"), {
      env: fake.env,
    }).pipe(
      Layer.provide(Program.layer({ program: "banda" })),
      Layer.provide(NodeServices.layer)
    )
    expect(
      yield* Hosts.use((hosts) => hosts.current).pipe(Effect.provide(none))
    ).toEqual([])
    expect(logged).toEqual([])
  })
)
