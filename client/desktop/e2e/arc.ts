/**
 * The machine "arc" for the end-to-end tests, as much another machine as
 * one computer can make it (ADR 0106, step 1a′). ssh is a fake first on
 * the window's PATH, as in hosts.spec.ts: it runs what main asks there
 * with arc's own folders, and forwards the port itself, as ssh does. Two
 * things keep arc from being this machine under another name.
 *
 * Its disk. Where bwrap can make a mount namespace, everything that runs
 * on arc runs in one where arc's own home is mounted at this machine's
 * home's path: one path names arc's file for arc and this machine's for
 * the window, as ~/code/banda does on Roma's two machines, and a window
 * that reads its own file for arc's reads "mac". Where it cannot, as in
 * devbox's containers, which give no user namespaces, arc's Projects are
 * only in arc's own folders: a window that asks this machine's engine for
 * them finds nothing there. A whole path read from this machine's disk
 * still finds arc's file then, which only the namespace catches, so the
 * job that runs same-path.spec.ts on a VM of its own sets
 * BANDA_SAME_PATH=require (ci.yml's `same-path`).
 *
 * Its link. The forward holds what it carries `latency` ms a round trip,
 * half each way, as from far away. In a black hole it carries nothing and
 * says nothing, with no reset either, as a machine gone to sleep or a
 * network gone dead: what was sent waits, as TCP keeps it, and goes on if
 * the hole closes first, and ssh gives up once its keepalives go
 * unanswered as long as main's ServerAliveInterval and ServerAliveCountMax
 * say. A new ssh then waits its ConnectTimeout and gives up. The forward
 * notes each message the window sends arc, so a test counts what a
 * gesture costs.
 */
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { startWindow } from "./window"

const repository = resolve(import.meta.dirname, "../../..")
const program = join(repository, "target/debug/banda")
const agent = join(repository, "target/debug/banda-fake-agent")

/**
 * Whether arc gets a mount namespace of its own here: bwrap, and the user
 * namespace it needs where it is not setuid. `BANDA_SAME_PATH=require`
 * fails the spec where it cannot, so the job that runs for it never
 * passes on arc's own folders alone; `off` never tries.
 */
export const SAME_PATH = (() => {
  const asked = process.env.BANDA_SAME_PATH
  if (asked === "off") return false
  try {
    execFileSync("bwrap", ["--dev-bind", "/", "/", "--", "true"], {
      stdio: "pipe",
    })
    return true
  } catch (error) {
    if (asked === "require")
      throw new Error(
        "BANDA_SAME_PATH=require, but bwrap makes no mount namespace here",
        { cause: error }
      )
    return false
  }
})()

/** A word as sh takes it, whatever it holds. */
const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * ssh as main runs it, for the host "arc": `-G` says a config with no
 * forwards; the forward (`-N`) is forward.cjs; any other runs its command
 * on arc, through `on` with `exports`, once the round trips of ssh's
 * handshake are done. In a black hole it waits its ConnectTimeout and
 * gives up.
 */
const fakeSsh = (on: string[], exports: Record<string, string>) => `#!/bin/sh
here=$(dirname "$0")
case "$1" in -G) printf 'hostname arc\\nport 22\\n'; exit 0 ;; esac
wait=10
for arg; do
  last=$arg
  case $arg in ConnectTimeout=*) wait=\${arg#ConnectTimeout=} ;; esac
done
for arg; do
  if [ "$arg" = -N ]; then
    exec ${quoted(process.execPath)} "$here/forward.cjs" "$@"
  fi
done
if [ -e "$here/blackhole" ]; then
  sleep "$wait"
  echo "ssh: connect to host arc port 22: Connection timed out" >&2
  exit 255
fi
sleep "$(cat "$here/handshake")"
unset BANDA_TOKEN BANDA_ENGINE
${Object.entries(exports)
  .map(([name, value]) => `export ${name}=${quoted(value)}`)
  .join("\n")}
exec ${[...on.map(quoted), "sh", "-c", '"$last"'].join(" ")}
`

/** The round trips ssh's handshake takes: TCP's, the versions, the keys,
 * the sign-in and the channel. */
const HANDSHAKE = 4

/**
 * The fake forward: 127.0.0.1:FROM to 127.0.0.1:TO, as `-L` names them,
 * listening once the handshake's round trips are done. Each chunk is held
 * half the `latency` in its folder, in order, each way; while `blackhole`
 * is there nothing moves, and ssh gives up as its options say. It writes
 * its two ports to `forward.port`, and what the window asks to `asked`.
 */
const FORWARD = `
const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const args = process.argv.slice(2)
const option = (name, or) => {
  for (let at = 0; at < args.length - 1; at++)
    if (args[at] === "-o" && args[at + 1].startsWith(name + "="))
      return Number(args[at + 1].slice(name.length + 1))
  return or
}
const [, from, , to] = args[args.indexOf("-L") + 1].split(":")
const read = (name) => {
  try {
    return fs.readFileSync(path.join(__dirname, name), "utf8")
  } catch {
    return undefined
  }
}
let latency = Number(read("latency") ?? 0)
let hole = read("blackhole") !== undefined
const END = Symbol("end")
const ways = new Set()

// One way of one connection: each chunk waits until its time, and none
// moves while in the hole; once out, all that waited goes, in order.
const way = (into) => {
  const held = []
  let timer
  const pump = () => {
    timer = undefined
    if (hole || into.destroyed) return
    while (held.length > 0 && held[0].at <= Date.now()) {
      const { chunk } = held.shift()
      if (chunk === END) into.end()
      else into.write(chunk)
    }
    if (held.length > 0) timer = setTimeout(pump, held[0].at - Date.now())
  }
  const one = {
    carry(chunk) {
      held.push({ at: Date.now() + latency / 2, chunk })
      if (timer === undefined) pump()
    },
    again() {
      if (timer === undefined) pump()
    },
  }
  ways.add(one)
  into.on("close", () => (clearTimeout(timer), ways.delete(one)))
  return one
}

// What \`from\` says goes to \`into\`, as late as the link is; a side that
// goes without ending ends the other as it goes.
const carry = (from, into) => {
  const one = way(into)
  let ended = false
  from.on("data", (chunk) => one.carry(chunk))
  from.on("end", () => ((ended = true), one.carry(END)))
  from.on("close", () => ended || into.destroy())
  from.on("error", () => {})
}

// What the window asks arc on \`socket\`, a JSON line each in \`asked\`:
// each frame of the engine's WebSocket, by its type and the method it
// names, as the window sends it. A connection that is no WebSocket's
// notes its first request's line.
const asked = (socket) => {
  const note = (what) =>
    fs.appendFileSync(path.join(__dirname, "asked"), JSON.stringify(what) + "\\n")
  let held = Buffer.alloc(0)
  let upgraded = false
  let other = false
  let parts = []
  socket.on("data", (chunk) => {
    if (other) return
    held = Buffer.concat([held, chunk])
    if (!upgraded) {
      const end = held.indexOf("\\r\\n\\r\\n")
      if (end < 0) return
      const head = held.subarray(0, end).toString()
      if (!/^upgrade: *websocket/im.test(head)) {
        other = true
        return note({ type: "http", method: head.split("\\r\\n")[0] })
      }
      upgraded = true
      held = held.subarray(end + 4)
    }
    // RFC 6455's frames, masked as a client sends them.
    while (held.length >= 2) {
      let length = held[1] & 0x7f
      let at = 2
      if (length === 126) {
        if (held.length < 4) return
        length = held.readUInt16BE(2)
        at = 4
      } else if (length === 127) {
        if (held.length < 10) return
        length = Number(held.readBigUInt64BE(2))
        at = 10
      }
      const mask = held[1] & 0x80 ? held.subarray(at, (at += 4)) : undefined
      if (held.length < at + length) return
      const payload = Buffer.from(held.subarray(at, at + length))
      if (mask)
        for (let byte = 0; byte < length; byte++) payload[byte] ^= mask[byte % 4]
      const last = held[0] & 0x80
      const control = (held[0] & 0x0f) >= 8
      held = held.subarray(at + length)
      if (control) continue
      parts.push(payload)
      if (!last) continue
      const text = Buffer.concat(parts).toString()
      parts = []
      try {
        const frame = JSON.parse(text)
        note({ type: frame.type, method: frame.method })
      } catch {
        note({ type: "binary" })
      }
    }
  })
}

const gone = (said) => {
  console.error(said)
  process.exit(255)
}

if (hole) {
  setTimeout(
    () => gone("ssh: connect to host arc port 22: Connection timed out"),
    option("ConnectTimeout", 10) * 1000
  )
} else {
  let giveUp
  setInterval(() => {
    latency = Number(read("latency") ?? 0)
    const now = read("blackhole") !== undefined
    if (now === hole) return
    hole = now
    // ssh asks every ServerAliveInterval s with nothing heard, and goes
    // once more than ServerAliveCountMax asks were not answered.
    const every = option("ServerAliveInterval", 0)
    if (hole && every > 0)
      giveUp = setTimeout(
        () => gone("Timeout, server arc not responding."),
        every * (option("ServerAliveCountMax", 3) + 1) * 1000
      )
    if (!hole) {
      clearTimeout(giveUp)
      for (const one of ways) one.again()
    }
  }, 50)
  setTimeout(() => {
    net
      .createServer({ allowHalfOpen: true }, (socket) => {
        const there = net.connect({
          port: Number(to),
          host: "127.0.0.1",
          allowHalfOpen: true,
        })
        asked(socket)
        carry(socket, there)
        carry(there, socket)
      })
      .listen(Number(from), "127.0.0.1", () =>
        fs.writeFileSync(path.join(__dirname, "forward.port"), from + " " + to)
      )
  }, latency * ${HANDSHAKE})
}
`

export type Arc = {
  dir: string
  /** Whether one path names arc's file for arc and this machine's for
   * the window (above). */
  samePath: boolean
  /** The folder each machine keeps its Projects in, as it names it: the
   * same path where `samePath`. */
  code: { arc: string; here: string }
  /** Where the file arc names `path` is on this machine's disk, for the
   * test to put arc's files there or read them. */
  disk: (path: string) => string
  /** The environment of a program on arc. */
  env: NodeJS.ProcessEnv
  /** Where the fake ssh is, for the window's PATH. */
  bin: string
  /** Runs `banda` on arc; what it printed. */
  banda: (...args: string[]) => string
  /** arc's engine, started apart from the window's ssh, as a service
   * there is: the window's ssh follows it, and its going leaves it
   * running, its Agents' turns with it. How to stop it. */
  start: () => Promise<() => Promise<void>>
  /** Starts a Thread on arc's engine in `project` with `text`. */
  send: (project: string, text: string) => void
  /** arc's Threads in `project`, each its title and how its turn stands. */
  states: (project: string) => (string | undefined)[][]
  /** arc's link holds each round trip `ms` from now on. */
  latency: (ms: number) => void
  /** arc's link is a black hole while `on` (above). */
  blackhole: (on: boolean) => void
  /** What the window has asked arc through its link so far, in order:
   * each WebSocket frame's type and the method it names, or an HTTP
   * request's line, to count what a gesture costs. */
  asked: () => { type: string; method?: string }[]
  /** The forward's port on this machine's loopback, and the engine's it
   * carries to there, once it listens. */
  ports: () => { from: number; to: number }
  close: () => void
}

/** The machine "arc": its own folders and disk, the fake agent its
 * Harness, `latency` ms a round trip away. */
export function newArc({ latency = 0 } = {}): Arc {
  const dir = mkdtempSync(join(tmpdir(), "banda-arc-"))
  const at = (path: string) => join(dir, path)
  // This machine's home, and arc's own, which arc's namespace mounts
  // over it.
  const home = at("home")
  const own = at("arc/home")
  for (const folder of [home, own])
    mkdirSync(join(folder, "code"), { recursive: true })
  mkdirSync(at("config"), { recursive: true })
  mkdirSync(at("bin"))
  writeFileSync(
    at("config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake AI"\ncommand = ${JSON.stringify(agent)}\nenv = { FAKE_AGENT_MCP = ${JSON.stringify(at("mcp.json"))} }\n`
  )
  writeFileSync(at("config/sharing.toml"), "problems = false\n")
  writeFileSync(at("config/machine.toml"), 'name = "arc"\nicon = "server"\n')
  const folders = {
    BANDA_ROOT: at("root"),
    BANDA_DATA: at("data"),
    BANDA_STATE: at("state"),
    BANDA_CONFIG: at("config"),
    BANDA_CACHE: at("cache"),
    // The engine stays in arc's namespace: never a systemd unit, which
    // its user manager would start outside it.
    BANDA_ENGINE_AS: "child",
  }
  const samePath = SAME_PATH
  // What every program on arc runs through. Killed, bwrap takes what it
  // runs with it, as an ssh that ends takes its command.
  const on = samePath
    ? [
        "bwrap",
        "--dev-bind",
        "/",
        "/",
        "--bind",
        own,
        home,
        "--die-with-parent",
        "--",
      ]
    : []
  const run = (what: string, args: string[]) =>
    on.length > 0
      ? { file: on[0]!, args: [...on.slice(1), what, ...args] }
      : { file: what, args }
  writeFileSync(at("bin/ssh"), fakeSsh(on, folders), { mode: 0o755 })
  writeFileSync(at("bin/forward.cjs"), FORWARD)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...folders,
    BANDA_LOG: "warn",
    BANDA_FENCE: "off",
  }
  delete env.BANDA_TOKEN
  delete env.BANDA_ENGINE
  const banda = (...args: string[]) => {
    const { file, args: all } = run(program, args)
    return execFileSync(file, all, { env, encoding: "utf8" })
  }
  const arc: Arc = {
    dir,
    samePath,
    code: {
      arc: join(samePath ? home : own, "code"),
      here: join(home, "code"),
    },
    disk: (path) => {
      const inside = relative(home, path)
      return samePath && !inside.startsWith("..") ? join(own, inside) : path
    },
    env,
    bin: at("bin"),
    banda,
    start: async () => {
      const { file, args } = run(program, ["start", "--with-parent"])
      const engine = spawn(file, args, {
        env,
        stdio: ["pipe", "pipe", "inherit"],
      })
      await once(engine.stdout, "data")
      return async () => {
        if (engine.exitCode !== null || engine.signalCode !== null) return
        engine.stdin.end()
        await once(engine, "close")
      }
    },
    send: (project, text) => {
      banda(
        "call",
        "agents.send",
        "--project",
        project,
        "--params",
        JSON.stringify({ harness: "fake", text, settings: null })
      )
    },
    states: (project) => {
      const { ok } = JSON.parse(
        banda("call", "agents.threads", "--project", project)
      ) as { ok: { threads: { title: string; latest?: { state: string } }[] } }
      return ok.threads.map((thread) => [thread.title, thread.latest?.state])
    },
    latency: (ms) => {
      writeFileSync(at("bin/latency"), String(ms))
      writeFileSync(at("bin/handshake"), String((ms * HANDSHAKE) / 1000))
    },
    blackhole: (on) =>
      on
        ? writeFileSync(at("bin/blackhole"), "")
        : rmSync(at("bin/blackhole"), { force: true }),
    asked: () =>
      existsSync(at("bin/asked"))
        ? readFileSync(at("bin/asked"), "utf8")
            .split("\n")
            .filter(Boolean)
            .map(
              (line) => JSON.parse(line) as { type: string; method?: string }
            )
        : [],
    ports: () => {
      const [from, to] = readFileSync(at("bin/forward.port"), "utf8")
        .split(" ")
        .map(Number)
      return { from: from!, to: to! }
    },
    close: () => {
      try {
        execFileSync(program, ["stop", "--force"], { env, stdio: "ignore" })
      } catch {
        // It stopped already.
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
  arc.latency(latency)
  return arc
}

/** Writes `files`, by their paths in `folder`, each with its text. */
export function put(folder: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), text)
  }
}

/** The window, its hosts.toml naming arc and the fake ssh first on its
 * PATH, its sidebar grouped by Project. */
export const withArc = (arc: Arc) =>
  startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "projects"\n',
    files: {
      "config/hosts.toml": `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`,
    },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })
