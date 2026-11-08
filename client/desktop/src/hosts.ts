/**
 * Other machines' engines, as the window reaches them over ssh (ADR 0081,
 * decision 4: the `ssh` route). `hosts.toml`, in the config folder, names
 * each host; only main reads it, and writes it as the page adds, changes
 * or takes out a host, its comments, its other hosts and a hand edit made
 * meanwhile kept (`rewrite`). It applies as it changes
 * (ADR 0095, decision 9): a host that comes is reached, one that goes has
 * its ssh ended, and one whose `ssh` or `banda` changed is reached again.
 * For each, main runs two of the system's ssh, never through a shell:
 *
 * - the follower runs `banda start --with-parent` there, which starts that
 *   machine's engine when it does not run and prints where it listens, as
 *   the window's own does here (engine.ts), then follows it. On a Mac,
 *   whose engine is its window's child until its launchd agent (ADR 0086,
 *   plan step 7), it starts none: it follows the one Banda's window runs
 *   there, and while none is open the host is away;
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
 * sign-in link once checked. Those words name no machine: the page puts
 * the machine's own name before them (ADR 0095, decision 2). Test's are
 * the one exception: the system the machine runs, and its own name and
 * icon, as its `banda status` says them, cleaned as the page cleans a
 * Welcome's (decision 2). An engine
 * that stops there as asked leaves this Banda running, and is started
 * again only when the page asks; so is one Stop Banda stopped, whether the
 * host was live then or not. A refused host is tried again every ten
 * minutes, or when the page asks. Quitting Banda ends both ssh; the engine
 * there runs on, as that machine's service.
 *
 * Test asks what is at an address and starts nothing there (#837): what
 * the machine is and its own name and icon, the `banda` found and its
 * build, and whether its engine runs, as `banda status` says. Stop Banda
 * there is that machine's own `banda stop`.
 */
import { createConnection, createServer, type AddressInfo } from "node:net"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  watch,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  type Address,
  type MachineIcon,
  type Named,
  PROTOCOL,
} from "@banda/contract"
import { Refused, writeWholeIf } from "@banda/desktop-kit"
import type { HostEntry, HostState, HostTest } from "@banda/web/host"
import { parse } from "smol-toml"
import {
  Cause,
  Clock,
  Console,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { channel } from "./channel"
import { command } from "./child"
import { Program, versionOf } from "./program"

/** One host of `hosts.toml`: this device's key for it, where ssh goes,
 * and the `banda` it runs there, or none to find this build's own there.
 * The shape stays for `banda --host` (ADR 0081, decision 13). */
type Entry = HostEntry

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

/** `hosts.toml`'s `text` as TOML, or why it is not. */
function tableOf(text: string): Record<string, unknown> | string {
  try {
    return parse(text)
  } catch (error) {
    return `it is not TOML: ${String(error).split("\n")[0]}`
  }
}

/** The good hosts of `hosts.toml`'s `text`, and why each other one is
 * refused. A host with no `banda` runs this build's own there, as the
 * follower finds it (`remoteCommand`). */
export function hostsOf(text: string): { hosts: Entry[]; refused: string[] } {
  const table = tableOf(text)
  return typeof table === "string"
    ? { hosts: [], refused: [table] }
    : hostsIn(table)
}

/** The good hosts of `hosts.toml`'s `table`, and why each other is
 * refused. */
function hostsIn(table: Record<string, unknown>): {
  hosts: Entry[]
  refused: string[]
} {
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
function refusalOf(
  entry: unknown,
  taken: readonly { name?: unknown }[]
): string | undefined {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return "it is not a table"
  const { name, ssh, banda } = entry as Record<string, unknown>
  if (typeof name !== "string" || !NAME.test(name))
    return "`name` is not lowercase letters, digits and -"
  if (KEPT.has(name)) return `\`name\` ${JSON.stringify(name)} is Banda's own`
  if (taken.some((one) => one.name === name))
    return `\`name\` ${JSON.stringify(name)} is taken by an earlier host`
  return addressRefusal(ssh, banda)
}

/** Why `ssh` and `banda` are no good; none when they are. */
function addressRefusal(ssh: unknown, banda: unknown): string | undefined {
  if (typeof ssh !== "string" || !DESTINATION.test(ssh))
    return "`ssh` is not letters, digits and . _ @ : [ ] / -, not starting with -"
  if (banda !== undefined && (typeof banda !== "string" || !BANDA.test(banda)))
    return "`banda` is not a whole path or one from ~/, in letters, digits and . _ / ~ -"
  return undefined
}

/** What the file `file` holds: its text, none when it is not there, or
 * why it cannot be read. */
function textOf(file: string): { text: string } | { why: string } {
  try {
    return { text: readFileSync(file, "utf8") }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: "" }
    return { why: `it cannot be read: ${String(error)}` }
  }
}

/** What changes from hosts `before` to hosts `after`, by name: the hosts
 * that come, those that go, and those whose `ssh` or `banda` changed,
 * which are reached again. */
export function diffOf(before: readonly Entry[], after: readonly Entry[]) {
  const was = new Map(before.map((one) => [one.name, one]))
  const now = new Set(after.map(({ name }) => name))
  const names = (list: readonly Entry[]) => list.map(({ name }) => name)
  return {
    added: names(after.filter(({ name }) => !was.has(name))),
    removed: names(before.filter(({ name }) => !now.has(name))),
    changed: names(
      after.filter((one) => {
        const old = was.get(one.name)
        return old && (old.ssh !== one.ssh || old.banda !== one.banda)
      })
    ),
  }
}

/** The hosts listed in `table` as they are written, good or not. */
const listOf = (table: Record<string, unknown>): unknown[] =>
  Array.isArray(table.hosts) ? table.hosts : []

/** `value` as JSON with each table's keys in order, so two tables compare
 * by what they hold. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, held: unknown) =>
    held && typeof held === "object" && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : held
  )

/** Banda's words for a `hosts.toml` it would not change as asked. */
const LAID_OUT =
  "hosts.toml is written in a way Banda cannot change safely: change it by hand"

/** `text`, once it reads as `table`, which Banda's change made of the
 * file's; else why not. */
function checked(
  text: string,
  table: Record<string, unknown>
): { text: string } | { why: string } {
  const read = tableOf(text)
  return typeof read !== "string" && canonical(read) === canonical(table)
    ? { text }
    : { why: LAID_OUT }
}

/** `text` with `entry` as a new `[[hosts]]` at its end, the rest as it
 * was; or why it cannot be. Its values are plain (`refusalOf`), so JSON's
 * quotes are TOML's. */
export function addedTo(
  text: string,
  entry: Entry
): { text: string } | { why: string } {
  const table = tableOf(text)
  if (typeof table === "string") return { why: `hosts.toml: ${table}` }
  const added = {
    name: entry.name,
    ssh: entry.ssh,
    ...(entry.banda === undefined ? {} : { banda: entry.banda }),
  }
  const lines = [
    "[[hosts]]",
    ...Object.entries(added).map(([key, value]) => `${key} = "${value}"`),
  ]
  const before = text.trimEnd()
  return checked(`${before ? `${before}\n\n` : ""}${lines.join("\n")}\n`, {
    ...table,
    hosts: [...listOf(table), added],
  })
}

/** A line that starts a table, and one that starts a `[[hosts]]`. */
const HEADER = /^\s*\[\[?[^[\]=#]+\]\]?\s*(?:#.*)?$/
const HOSTS = /^\s*\[\[\s*hosts\s*\]\]\s*(?:#.*)?$/
const COMMENT = /^\s*#/

/** Host `name` in `hosts.toml`'s `text`: the file as a table, its hosts
 * and where `name` is among them, the file's lines, those that start a
 * table, and the one that starts its `[[hosts]]`; or why it cannot be
 * found safely. */
function blockOf(
  text: string,
  name: string
):
  | {
      table: Record<string, unknown>
      listed: unknown[]
      at: number
      lines: string[]
      headers: number[]
      header: number
    }
  | { why: string } {
  const table = tableOf(text)
  if (typeof table === "string") return { why: `hosts.toml: ${table}` }
  const listed = listOf(table)
  const at = listed.findIndex(
    (one) => (one as Record<string, unknown> | null)?.name === name
  )
  if (at < 0) return { why: noHostWords(name) }
  const lines = text.split("\n")
  const headers = lines.flatMap((line, index) =>
    HEADER.test(line) ? [index] : []
  )
  const header = headers.filter((index) => HOSTS.test(lines[index]!))[at]
  if (header === undefined) return { why: LAID_OUT }
  return { table, listed, at, lines, headers, header }
}

/** `text` with host `name` taken out, the rest as it was: its
 * `[[hosts]]`, what it holds, and the comment just above it, unless that
 * starts the file; or why it cannot be. */
export function removedFrom(
  text: string,
  name: string
): { text: string } | { why: string } {
  const block = blockOf(text, name)
  if ("why" in block) return block
  const { table, listed, at, lines, headers, header } = block
  /** Where the block of the table at line `index` starts: at the comment
   * just above it, unless that starts the file. */
  const startOf = (index: number) => {
    let start = index
    while (start > 0 && COMMENT.test(lines[start - 1]!)) start -= 1
    return start === 0 ? index : start
  }
  const next = headers.find((index) => index > header)
  const kept = [
    ...lines.slice(0, startOf(header)),
    ...(next === undefined ? [] : lines.slice(startOf(next))),
  ]
  const left = kept.join("\n").trimEnd()
  const rest = Object.fromEntries(
    Object.entries(table).filter(([key]) => key !== "hosts")
  )
  const others = listed.filter((_, index) => index !== at)
  return checked(
    left ? `${left}\n` : "",
    others.length > 0 ? { ...rest, hosts: others } : rest
  )
}

/** A line that gives `key` a plain string, with or without a comment
 * after it: `ssh = "roma@arc"   # at home`. */
const keyLine = (key: string) =>
  new RegExp(`^(\\s*${key}\\s*=\\s*)(?:"[^"\\\\]*"|'[^']*')(\\s*(?:#.*)?)$`)
const BLANK = /^\s*(?:#.*)?$/

/** `text` with host `name`'s `ssh` and `banda` set in place as `change`
 * says, an empty one taken out: the line that holds each, its comment
 * kept, or a new line after the host's last; its other keys, the
 * comments and every other host as they were. Or why it cannot be. Its
 * values are plain (`addressRefusal`), so JSON's quotes are TOML's. */
export function setIn(
  text: string,
  name: string,
  change: { ssh?: string; banda?: string }
): { text: string } | { why: string } {
  const block = blockOf(text, name)
  if ("why" in block) return block
  const { table, listed, at, lines, headers, header } = block
  let end = headers.find((index) => index > header) ?? lines.length
  const now: Record<string, unknown> = { ...(listed[at] as object) }
  for (const key of ["ssh", "banda"] as const) {
    const value = change[key]
    if (value === undefined || (now[key] ?? "") === value) continue
    const line = keyLine(key)
    const held = lines.findIndex(
      (one, index) => index > header && index < end && line.test(one)
    )
    if (value === "") {
      delete now[key]
      if (held < 0) continue
      lines.splice(held, 1)
      end -= 1
    } else {
      now[key] = value
      if (held >= 0)
        lines[held] = lines[held]!.replace(
          line,
          (_, before: string, after: string) => `${before}"${value}"${after}`
        )
      else {
        let last = end - 1
        while (last > header && BLANK.test(lines[last]!)) last -= 1
        lines.splice(last + 1, 0, `${key} = "${value}"`)
        end += 1
      }
    }
  }
  return checked(lines.join("\n"), {
    ...table,
    hosts: listed.map((one, index) => (index === at ? now : one)),
  })
}

/** The machine an ssh destination names, as its config's Host or
 * HostName would: no `ssh://`, user, port or brackets, in lowercase. A
 * bare address with two `:` or more is an IPv6 one, whole. */
const machineOf = (ssh: string) => {
  const link = ssh.startsWith("ssh://")
  const rest = link ? ssh.slice("ssh://".length) : ssh
  const host = rest.slice(rest.lastIndexOf("@") + 1)
  const bracketed = /^\[([^\]]*)\]/.exec(host)?.[1]
  const bare = !link && /:.*:/.test(host)
  return (bracketed ?? (bare ? host : host.split(/[:/]/)[0]!)).toLowerCase()
}

/** A name for a new host, made from its address `ssh` (ADR 0095,
 * decision 9): its machine's, to its first dot unless it is an address of
 * numbers, in the letters a name takes, and numbered past the names
 * `taken` and Banda's own. */
export function nameFrom(
  ssh: string,
  taken: readonly { name?: unknown }[]
): string {
  const machine = machineOf(ssh)
  const word = /^[\d.]+$|:/.test(machine) ? machine : machine.split(".")[0]!
  const base =
    word
      .replace(/[^a-z0-9-]+/g, "-")
      .slice(0, 32)
      .replace(/^-+|-+$/g, "") || "machine"
  const names = new Set([...KEPT, ...taken.map(({ name }) => name)])
  let named = base
  for (let next = 2; names.has(named); next++) named = `${base}-${next}`
  return named
}

/** The hosts listed in `text`'s `table` that are tables, good or not. */
const tablesIn = (table: Record<string, unknown> | string) =>
  (typeof table === "string" ? [] : listOf(table)).filter(
    (one): one is { name?: unknown; ssh?: unknown } =>
      typeof one === "object" && one !== null && !Array.isArray(one)
  )

/** Why `ssh` cannot go beside the hosts `others`: one of them reaches
 * its machine already, at this address or another (`machineOf`), as
 * `roma@arc` and `arc` do. */
function reachedBy(
  ssh: string,
  others: readonly { name?: unknown; ssh?: unknown }[]
): string | undefined {
  const machine = machineOf(ssh)
  const there = others.find(
    (one) => typeof one.ssh === "string" && machineOf(one.ssh) === machine
  )
  if (!there) return undefined
  const name = typeof there.name === "string" ? there.name : machine
  return `${name} is in hosts.toml already`
}

/** `hosts.toml`'s `text` with `machine` added (`addedTo`), and the entry
 * written: its name made from `ssh` when it has none. Or why not: a host
 * Banda refuses, a name taken, or a machine there already. */
export function addOf(
  text: string,
  machine: { name?: string; ssh: string; banda?: string }
): { text: string; value: Entry } | { why: string } {
  const taken = tablesIn(tableOf(text))
  const entry: Entry = {
    name: machine.name || nameFrom(machine.ssh, taken),
    ssh: machine.ssh,
    ...(machine.banda ? { banda: machine.banda } : {}),
  }
  const why = refusalOf(entry, taken) ?? reachedBy(entry.ssh, taken)
  if (why) return { why }
  const added = addedTo(text, entry)
  return "why" in added ? added : { text: added.text, value: entry }
}

/** `hosts.toml`'s `text` with host `name`'s `ssh` or `banda` changed as
 * `change` says (`setIn`), an empty `banda` none; and the entry written.
 * Or why not: no such host, an address Banda refuses, or one of a
 * machine another host reaches. */
export function setOf(
  text: string,
  name: string,
  change: { ssh?: string; banda?: string }
): { text: string; value: Entry } | { why: string } {
  const table = tableOf(text)
  if (typeof table === "string") return { why: `hosts.toml: ${table}` }
  const listed = tablesIn(table)
  const at = listed.findIndex((one) => one.name === name)
  const was = listed[at] as Record<string, unknown> | undefined
  if (!was) return { why: noHostWords(name) }
  const banda = change.banda ?? was.banda
  const entry = {
    name,
    ssh: change.ssh ?? was.ssh,
    ...(banda === undefined || banda === "" ? {} : { banda }),
  }
  // Only an address moved to another machine is checked, so a machine the
  // file has twice from before stays editable.
  const ssh = String(entry.ssh)
  const moved = machineOf(ssh) !== machineOf(String(was.ssh))
  const others = listed.filter((_, index) => index !== at)
  const why =
    refusalOf(entry, listed.slice(0, at)) ??
    (moved ? reachedBy(ssh, others) : undefined)
  if (why) return { why }
  const set = setIn(text, name, change)
  return "why" in set ? set : { text: set.text, value: entry as Entry }
}

/** Banda's words for a `hosts.toml` that changed by hand again as Banda
 * wrote it. */
const CHANGED = "hosts.toml changed while Banda wrote it; try again"

/** Changes `file` as `edit` makes its text, written whole, and gives what
 * `edit` says of it; or why not. Just before the rename the file is read
 * again: a change by hand since `edit` read it is not lost, as `edit`
 * runs once more on the file as it is then; should it change again,
 * Banda refuses. A text `edit` leaves as it was is not written. */
export function rewrite<A>(
  file: string,
  edit: (text: string) => { text: string; value: A } | { why: string }
): { value: A } | { why: string } {
  for (let tries = 0; tries < 2; tries++) {
    const read = textOf(file)
    if ("why" in read) return { why: `hosts.toml ${read.why}` }
    const made = edit(read.text)
    if ("why" in made) return made
    const done = { value: made.value }
    if (made.text === read.text) return done
    const still = () => {
      const now = textOf(file)
      return "text" in now && now.text === read.text
    }
    try {
      if (writeWholeIf(file, made.text, modeOf(file), still)) return done
    } catch (error) {
      return { why: `hosts.toml cannot be written: ${String(error)}` }
    }
  }
  return { why: CHANGED }
}

/** The Hosts of an ssh config's `text` to suggest for Add, in their
 * order, once each: no pattern (`*`, `?`, `!`), none that is not a
 * destination Banda takes, and none of a machine `taken` reaches already.
 * A Match names no Host. */
export function suggestionsOf(text: string, taken: readonly Entry[]): string[] {
  const reached = new Set(taken.map(({ ssh }) => machineOf(ssh)))
  const found = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const [, keyword, rest = ""] =
      /^\s*(\w+)(?:\s*=\s*|\s+)(.*)$/.exec(line) ?? []
    if (keyword?.toLowerCase() !== "host") continue
    // A quoted name is one word, as ssh reads it; one with a space or a
    // quote left is no destination.
    for (const [word, quoted] of rest
      .replace(/\s#.*$/, "")
      .matchAll(/"([^"]*)"|\S+/g)) {
      const alias = quoted ?? word
      if (
        alias &&
        !/[*?!]/.test(alias) &&
        DESTINATION.test(alias) &&
        !reached.has(machineOf(alias))
      )
        found.add(alias)
    }
  }
  return [...found]
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
/** What `banda start --with-parent` exits with there while no Banda is
 * open on a machine whose engine is only its window's child, as a Mac's
 * (engine/src/control.rs): it starts none for this window, which tries
 * again as after any end. */
const NOT_OPEN = 75

/** This build's names, which the follower looks for there: its program
 * on PATH and its data folder (`banda-dev`), and its app (`Banda Dev`). */
type Own = { readonly folder: string; readonly name: string }

/** The session's runtime folder, when ssh set none, so systemd's user
 * manager answers there. */
const RUNTIME = `env XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"`

/** What runs `banda` there through `sh`, whatever the login shell is:
 * the lines `run` makes of the `banda` it is given. `banda` is plain
 * (`BANDA`), so it goes in as it is, and `~/` is home there. With no
 * `banda`, it runs the first of this build's own it finds: on PATH, the
 * newest copy the window there keeps in its data folder (program.ts,
 * channel.ts), as that machine's `uname` says where that is, or macOS's
 * app; with none, it exits 127. `own`'s names are channel.ts's, in
 * letters, digits, spaces and -. */
const throughSh = (
  banda: string | undefined,
  own: Own,
  run: (banda: string) => string[]
) => {
  const lines =
    banda !== undefined
      ? run(banda)
      : [
          `case $(uname) in Darwin) d="$HOME/Library/Application Support" ;; *) d="\${XDG_DATA_HOME:-$HOME/.local/share}" ;; esac`,
          `b=$(command -v ${own.folder}) || b=$(ls -1d "$d"/${own.folder}/engine/*/banda 2>/dev/null | sort -V | tail -n 1)`,
          `[ -x "$b" ] || b="/Applications/${own.name}.app/Contents/Resources/banda"`,
          `[ -x "$b" ] || { echo "no ${own.name} here" >&2; exit ${NOT_FOUND}; }`,
          ...run(`"$b"`),
        ]
  return `sh -c '${lines.join("; ")}'`
}

/** What the follower runs there (`throughSh`): `banda start
 * --with-parent`, with `BANDA_OVER_SSH`, so a Mac's starts no engine that
 * lives only as long as the link. */
export const remoteCommand = (banda: string | undefined, own: Own = channel) =>
  throughSh(banda, own, (b) => [
    `exec ${RUNTIME} BANDA_OVER_SSH=1 ${b} start --with-parent`,
  ])

/** What Test runs there (`throughSh`): what the machine is, its banda's
 * version, and `banda status`, which starts nothing. */
export const probeCommand = (banda: string | undefined, own: Own = channel) =>
  throughSh(banda, own, (b) => [
    "uname -s",
    `${b} --version && exec ${RUNTIME} ${b} status`,
  ])

/** What Stop Banda runs there (`throughSh`): its own `banda stop`, which
 * refuses while Agents work, unless `force`. */
export const stopCommand = (
  banda: string | undefined,
  force: boolean,
  own: Own = channel
) =>
  throughSh(banda, own, (b) => [
    `exec ${RUNTIME} ${b} stop${force ? " --force" : ""}`,
  ])

/** The arguments of an ssh that runs `remote` on `host`: no forward of
 * the config's either. */
const commandArgs = (host: Entry, remote: string) => [
  ...PLAIN_SSH,
  "-o",
  "ClearAllForwardings=yes",
  "--",
  host.ssh,
  remote,
]

/** The follower's arguments. */
export const followerArgs = (host: Entry) =>
  commandArgs(host, remoteCommand(host.banda))

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

/** Why `host`, whose config `ssh -G` said, is refused for its forwards;
 * none when it has none. */
const forwardsWhy = (host: Entry, said: string) => {
  const forwards = [...new Set(forwardsIn(said))]
  return forwards.length > 0
    ? `ssh's config forwards ports for ${host.ssh} (${forwards.join(", ")}), which Banda would have to drop with its own`
    : undefined
}

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
/** What `banda status` prints there: whether its engine runs, and what
 * it says of itself; and the system the machine runs, and its own name
 * and icon, which are read by hand (`namedOf`), so a bad one leaves the
 * rest (engine/src/control.rs). */
const Status = Schema.fromJsonString(
  Schema.Struct({
    running: Schema.Boolean,
    protocol: Schema.optional(Schema.Number),
    build: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    system: Schema.optional(Schema.Unknown),
    named: Schema.optional(Schema.Unknown),
  })
)

/** Text the other machine wrote of itself, as the page may draw it, as
 * the page cleans a Welcome's name (`cleanNamed` in client/ui): no
 * control or format characters (Unicode's Cc and Cf: the bidi controls,
 * zero-width spaces), nor line or paragraph separators, cut at `most`
 * characters, trimmed; none when none is left. */
const cleaned = (said: unknown, most: number) => {
  if (typeof said !== "string") return null
  const text = [...said.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")]
  return text.slice(0, most).join("").trim() || null
}

/** The ten icons a machine takes (ADR 0095, decision 1). */
const ICONS: Record<MachineIcon, true> = {
  laptop: true,
  desktop: true,
  tower: true,
  server: true,
  database: true,
  storage: true,
  router: true,
  vm: true,
  phone: true,
  tablet: true,
}

/** A machine's name and icon as its `banda status` says them, cleaned as
 * the page cleans a Welcome's (ADR 0095, decision 2): the name cut at 16
 * characters, an icon not of the ten as `desktop`; none with no name. */
function namedOf(said: unknown): Named | null {
  if (typeof said !== "object" || said === null) return null
  const { name, icon } = said as Record<string, unknown>
  const named = cleaned(name, 16)
  if (!named) return null
  return {
    name: named,
    icon:
      typeof icon === "string" && Object.hasOwn(ICONS, icon)
        ? (icon as MachineIcon)
        : "desktop",
  }
}

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

type Build = ReturnType<typeof ownOf>

/** What Test found, from the `lines` its probe printed there
 * (`probeCommand`) and the `code` it ended with: the system the machine
 * runs and its own name and icon, as `banda status` says them, else what
 * `uname` says it is; its banda's build as `--version` says it; and its
 * engine while one runs, as `banda status` says. `own` is this window's
 * build. */
export function foundIn(
  lines: readonly string[],
  code: number,
  own: Build
): HostTest {
  const [system, version = "", status = ""] = lines
  if (!/^banda \S/.test(version)) return { state: "away", why: UNEXPECTED }
  const running = Schema.decodeUnknownOption(Status)(status)
  if (code !== 0 || Option.isNone(running))
    return {
      state: "refused",
      why: `banda there could not say whether its engine runs (code ${code})`,
    }
  const engine = running.value
  return {
    state: "found",
    system:
      cleaned(engine.system, 40) ??
      (system === "Linux" ? "Linux" : system === "Darwin" ? "macOS" : null),
    named: namedOf(engine.named),
    banda: ownOf(version),
    own,
    engine: engine.running
      ? {
          build: buildOf(engine.build),
          version: versionNamed(engine.version),
          speaks: engine.protocol === PROTOCOL,
        }
      : null,
  }
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
  /** For Test to answer. */
  test: number
}

const TIMES: Times = {
  first: 2_000,
  longest: 60_000,
  refused: 10 * 60_000,
  answer: 60_000,
  signin: 10 * 60_000,
  test: 30_000,
}

/** How long Stop Banda waits for the engine there to stop: as long as
 * `banda stop` waits, and the link. */
const STOP_WAIT = 60_000
/** How long `hosts.toml` is left alone after a change before it is read,
 * as an editor may write it in steps. */
const SETTLE = 300

/** How many ports the forward tries, as another program may take the one
 * picked before ssh listens on it. */
const PORT_TRIES = 3
/** How many lines from ssh the log takes from a host in a minute. */
const LINES_A_MINUTE = 20

/** A host's state without its entry, as the page sees it. */
type Without<T> = T extends unknown ? Omit<T, "name" | "ssh" | "banda"> : never
type Link = Without<HostState>

/** A host as main keeps it: its entry, which the page's Settings show
 * and change, its state, its address while live, which go at it this is,
 * and what starts the next go at once while it is stopped or refused. */
type Kept = {
  readonly name: string
  readonly ssh: string
  readonly banda?: string
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
    /** Each host of `hosts.toml`, as it is now, with its entry there. */
    readonly current: Effect.Effect<HostState[]>
    /** The hosts, now and each time one changes. */
    readonly changes: Stream.Stream<HostState[]>
    /** Where host `name`'s engine listens, through the forward: it waits
     * while the host connects, and while its engine is stopped there, and
     * tries a refused one again at once; it fails for one refused, or not
     * in `hosts.toml`, or taken out of it meanwhile. */
    readonly address: (name: string) => Effect.Effect<Address, Refused>
    /** Starts host `name` again at once when its engine is stopped there
     * or it is refused; it fails for one not in `hosts.toml`. */
    readonly start: (name: string) => Effect.Effect<void, Refused>
    /** Adds `machine` to `hosts.toml`, as a `[[hosts]]` at its end, and
     * reaches it at once: its name made from `ssh` when it has none. The
     * entry written; it fails for one refused, or one whose name is
     * there already, or whose machine is at this address or another. */
    readonly add: (machine: {
      name?: string
      ssh: string
      banda?: string
    }) => Effect.Effect<Entry, Refused>
    /** Changes host `name`'s `ssh` or `banda` in `hosts.toml`, in place,
     * the rest as it was, and reaches it again; an empty `banda` is none.
     * The entry written; it fails for a host not there, an address
     * refused, or one of a machine another host reaches. */
    readonly set: (
      name: string,
      change: { ssh?: string; banda?: string }
    ) => Effect.Effect<Entry, Refused>
    /** Takes host `name` out of `hosts.toml`, the rest as it was, and ends
     * its ssh. */
    readonly remove: (name: string) => Effect.Effect<void, Refused>
    /** What is at `ssh`, with `banda` or this build's own, starting
     * nothing there. */
    readonly test: (
      ssh: string,
      banda?: string
    ) => Effect.Effect<HostTest, Refused>
    /** Stops host `name`'s engine through its own `banda stop`, and holds
     * the host stopped until `start`, live or not: `working`, having
     * stopped nothing, while Agents work there, unless `force`. */
    readonly stop: (
      name: string,
      force: boolean
    ) => Effect.Effect<"stopped" | "working", Refused>
    /** The Hosts of the ssh config to suggest for Add (`suggestionsOf`). */
    readonly suggestions: Effect.Effect<string[]>
  }
>()("banda/Hosts") {
  /** The hosts of `file`, each run by ssh from `env`'s PATH, or the
   * window's; `sshConfig` is the ssh config the suggestions come from. */
  static readonly layer = (
    file: string,
    {
      env,
      times = TIMES,
      sshConfig = join(homedir(), ".ssh", "config"),
    }: { env?: Record<string, string>; times?: Times; sshConfig?: string } = {}
  ) =>
    Layer.effect(Hosts)(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const program = yield* Program
        const scope = yield* Effect.scope
        const all = yield* SubscriptionRef.make<readonly Kept[]>([])
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
        const run: Run = { spawner, env, times, own }
        /** The hosts reached now, by name: each one's entry, and the fiber
         * that keeps it reached. */
        const reached = new Map<
          string,
          { entry: Entry; fiber: Fiber.Fiber<unknown> }
        >()
        /** The text of `hosts.toml` last applied; none before the first. */
        let applied: string | undefined
        /** One change of the hosts at a time: a read of `hosts.toml`, or a
         * write and its read. */
        const lock = yield* Semaphore.make(1)
        /** Host `name` as main keeps it now; none when it is not there. */
        const keptOf = (name: string) =>
          Effect.map(SubscriptionRef.get(all), (list) =>
            list.find((one) => one.name === name)
          )

        /** Keeps `host` reached, until the layer's scope closes or it goes
         * from `hosts.toml`; `stopped`, it first waits for the page to start
         * it, as the Person stopped its engine. */
        const reach = (host: Entry, stopped = false) =>
          Effect.gen(function* () {
            const change = (to: (one: Kept) => Kept) =>
              SubscriptionRef.update(all, (list) =>
                list.map((one) => (one.name === host.name ? to(one) : one))
              )
            const tell: Tell = {
              set: (link, address) =>
                change((one) => ({ ...one, link, address })),
              begin: (next, link = { state: "connecting" }) =>
                change((one) => ({
                  name: one.name,
                  ssh: one.ssh,
                  banda: one.banda,
                  link,
                  go: one.go + 1,
                  next,
                })),
            }
            // Shown stopped before its fiber runs, so `start` finds its wait.
            const held = stopped ? yield* Deferred.make<void>() : undefined
            if (held) yield* tell.begin(held, { state: "stopped" })
            const fiber = yield* Effect.forkIn(
              keep(host, tell, run, held),
              scope
            )
            reached.set(host.name, { entry: host, fiber })
          })

        /** Holds `host` stopped, as Stop Banda stopped its engine there: a
         * go that is on ends, its ssh with it, and none starts until the
         * page asks. A live host's follower may have seen the stop already;
         * an away or refused one would start the engine again at its next
         * try. Nothing, when `host` went from `hosts.toml` or changed
         * meanwhile. */
        const hold = (host: Entry) =>
          Effect.gen(function* () {
            const one = reached.get(host.name)
            if (one?.entry !== host) return
            if ((yield* keptOf(host.name))?.link.state === "stopped") return
            yield* Fiber.interrupt(one.fiber)
            yield* reach(host, true)
          })

        /** Makes the hosts reached `hosts`, in their order: a host that
         * went has its ssh ended, and one that changed is reached anew,
         * without the address it had. */
        const apply = (hosts: readonly Entry[]) =>
          Effect.gen(function* () {
            const changes = diffOf(
              [...reached.values()].map(({ entry }) => entry),
              hosts
            )
            const ended = [...changes.removed, ...changes.changed]
            // Together, as each waits for its ssh to end.
            yield* Fiber.interruptAll(
              ended.map((name) => reached.get(name)!.fiber)
            )
            for (const name of ended) reached.delete(name)
            yield* SubscriptionRef.update(all, (before) =>
              hosts.map(({ name, ssh, banda }): Kept => {
                const was = before.find((one) => one.name === name)
                return was && reached.has(name)
                  ? was
                  : {
                      name,
                      ssh,
                      banda,
                      link: { state: "connecting" },
                      go: was?.go ?? 0,
                    }
              })
            )
            for (const host of hosts)
              if (!reached.has(host.name)) yield* reach(host)
            return changes
          })

        /** Reads `hosts.toml` and applies it when it changed. A file that
         * is not TOML, as one saved half-written, or that cannot be read
         * leaves the hosts as they are, once they were read. */
        const reread = Effect.gen(function* () {
          const read = textOf(file)
          if ("text" in read && read.text === applied) return
          const first = applied === undefined
          const table = "text" in read ? tableOf(read.text) : read.why
          if (typeof table === "string" && !first)
            return yield* Console.error(
              `banda: ${file}: ${table}; the hosts stay as they were`
            )
          applied = "text" in read ? read.text : ""
          const { hosts, refused } =
            typeof table === "string"
              ? { hosts: [], refused: [table] }
              : hostsIn(table)
          for (const why of refused)
            yield* Console.error(`banda: ${file}: ${why}`)
          const { added, removed, changed } = yield* apply(hosts)
          if (first) return
          for (const [names, words] of [
            [added, "is added; Banda reaches it"],
            [removed, "is taken out; its ssh ends"],
            [changed, "changed; Banda reaches it again"],
          ] as const)
            for (const name of names)
              yield* Console.error(`banda: ${file}: ${name} ${words}`)
        })
        yield* lock.withPermit(reread)
        yield* Effect.forkScoped(
          changesOf(file).pipe(
            Stream.debounce(SETTLE),
            Stream.runForEach(() => lock.withPermit(reread)),
            // A watch that failed hears nothing more: a last read, and the
            // log says so.
            Effect.catch((error) =>
              Console.error(
                `banda: ${file}: Banda no longer sees it change (${String(error)}); restart Banda after a change`
              ).pipe(Effect.andThen(lock.withPermit(reread)))
            )
          )
        )

        /** Changes `hosts.toml` as `edit` makes its text (`rewrite`), its
         * mode kept, then reads it as any change; gives what `edit` says
         * of it. */
        const change = <A>(
          edit: (text: string) => { text: string; value: A } | { why: string }
        ) =>
          lock.withPermit(
            Effect.suspend(() => {
              const done = rewrite(file, edit)
              return "why" in done
                ? Effect.fail(new Refused({ message: done.why }))
                : Effect.as(reread, done.value)
            })
          )

        const seen = (list: readonly Kept[]): HostState[] =>
          list.map(({ name, ssh, banda, link }) => ({
            name,
            ssh,
            ...(banda !== undefined && { banda }),
            ...link,
          }))
        /** Host `name` as it is now, and its next go started at once when
         * it waits in one of `states`. */
        const wake = (name: string, states: Link["state"][]) =>
          Effect.gen(function* () {
            const kept = yield* keptOf(name)
            if (!kept) return yield* noHost(name)
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
                    one === undefined ||
                    one.address !== undefined ||
                    (one.link.state === "refused" && one.go > past)
                ),
                Stream.runHead
              )
              const one = Option.getOrUndefined(found)
              if (one?.address) return one.address
              if (one?.link.state !== "refused") return yield* noHost(name)
              return yield* new Refused({
                message: `${name}: ${one.link.why}`,
              })
            }),
          start: (name: string) =>
            Effect.asVoid(wake(name, ["stopped", "refused"])),
          add: (machine) => change((text) => addOf(text, machine)),
          set: (name, to) => change((text) => setOf(text, name, to)),
          remove: (name) =>
            Effect.asVoid(
              change((text) => {
                const removed = removedFrom(text, name)
                return "why" in removed
                  ? removed
                  : { text: removed.text, value: undefined }
              })
            ),
          test: (ssh, banda) =>
            Effect.suspend(() => {
              const why = addressRefusal(ssh, banda)
              return why
                ? Effect.fail(new Refused({ message: why }))
                : probe({ name: ssh, ssh, banda }, run)
            }),
          stop: (name, force) =>
            Effect.gen(function* () {
              const host = reached.get(name)?.entry
              if (!host) return yield* noHost(name)
              const done = yield* stopThere(host, force, run)
              if (done === "stopped") yield* lock.withPermit(hold(host))
              return done
            }),
          suggestions: Effect.sync(() => {
            const read = textOf(sshConfig)
            return "why" in read
              ? []
              : suggestionsOf(
                  read.text,
                  [...reached.values()].map(({ entry }) => entry)
                )
          }),
        }
      })
    )
}

/** Banda's words for a host `name` it does not have. */
const noHostWords = (name: string) =>
  `There is no host ${JSON.stringify(name)} in hosts.toml.`
const noHost = (name: string) => new Refused({ message: noHostWords(name) })

/** The mode of `file`, to keep as it is written anew; none when it is not
 * there. */
function modeOf(file: string): number | undefined {
  try {
    return statSync(file).mode & 0o777
  } catch {
    return undefined
  }
}

/** Each time something may have changed `file`, as its folder's watch
 * says: a write, a rename over it, its removal; and once as the watch
 * begins, so a change since the first read is seen too. The folder is
 * made when it is not there, so a file made later is seen. A folder that
 * cannot be watched leaves the file as it was read, and says so; a watch
 * that fails later ends the stream with its error. */
const changesOf = (file: string) =>
  Stream.callback<void, Error>((queue) => {
    const folder = dirname(file)
    const name = basename(file)
    const changed = () => Queue.offerUnsafe(queue, undefined)
    return Effect.acquireRelease(
      Effect.try(() => {
        mkdirSync(folder, { recursive: true })
        const watcher = watch(folder, { persistent: false }, (_, which) => {
          if (which === null || which === name) changed()
        }).on("error", (error) =>
          Queue.failCauseUnsafe(queue, Cause.fail(error))
        )
        changed()
        return watcher
      }),
      (watcher) => Effect.sync(() => watcher.close())
    ).pipe(
      Effect.catch((error) =>
        Console.error(
          `banda: ${file}: Banda does not see it change (${String(error.cause)}); restart Banda after a change`
        )
      )
    )
  })

/** How a go tells the host's state: `set` it, or `begin` a go, which
 * `next` ends the wait before, as `link` (connecting, or stopped for the
 * wait before the first go). */
type Tell = {
  readonly set: (link: Link, address?: Address) => Effect.Effect<void>
  readonly begin: (
    next: Deferred.Deferred<void>,
    link?: Link
  ) => Effect.Effect<void>
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
 * stopped. With `held`, it waits so before its first go, as Stop Banda
 * stopped it. A refused one is tried again after a long wait, or as the
 * page asks. */
const keep = (
  host: Entry,
  { set, begin }: Tell,
  run: Run,
  held?: Deferred.Deferred<void>
) =>
  Effect.gen(function* () {
    const { times } = run
    const told = new Set<string>()
    const said = heard(host.name)
    /** Waits for the page to start the engine stopped there. */
    const stoppedUntil = (next: Deferred.Deferred<void>) =>
      Console.error(
        `banda: ${host.name}'s engine stopped as asked; Banda starts it again when asked`
      ).pipe(Effect.andThen(Deferred.await(next)))
    if (held) yield* stoppedUntil(held)
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
        yield* stoppedUntil(next)
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
    const forwards = forwardsWhy(host, config.success)
    if (forwards) return { state: "refused", why: forwards } satisfies Ended

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
        why: `the engine there speaks protocol ${protocol}, this window ${PROTOCOL}`,
      } satisfies Ended
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      !/^[\x21-\x7e]+$/.test(secret)
    )
      return away(UNEXPECTED)
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

/** Banda's words for a line from banda there that is not Banda's. */
const UNEXPECTED = "banda there said something unexpected"

/** Why `host` has no banda there to run. */
const notFound = (host: Entry) =>
  host.banda === undefined
    ? `no ${channel.name} found there; set banda in hosts.toml`
    : `no ${host.banda} there; check banda in hosts.toml`

/** Why `host` is away, from the code its ssh ended with, should ssh
 * itself have ended it: a signal, or its own failure, 255. */
const sshEnded = (host: Entry, code: number) =>
  code === KILLED
    ? `ssh to ${host.ssh} was killed`
    : code === 255
      ? `ssh could not reach ${host.ssh}`
      : undefined

/** How the follower's end leaves the host: code 0 is its engine stopped
 * as asked, 255 ssh's own failure, 127 no `banda` there, 75 no Banda open
 * there, none a signal. */
function endOf(host: Entry, code: number): Ended {
  if (code === 0) return { state: "stopped" }
  const ssh = sshEnded(host, code)
  if (ssh) return away(ssh)
  if (code === NOT_OPEN) return away(`${channel.name} is not open there`)
  if (code === NOT_FOUND) return { state: "refused", why: notFound(host) }
  return away(`the link to ${host.ssh} ended (code ${code})`)
}

/** banda's refusal there, as the page may say it: its code, when plain. */
const refusedWords = (code: string) =>
  `banda there refused (${/^[a-z_]{1,32}$/.test(code) ? code : "?"})`

/** A first line that is not where the engine listens: `banda`'s refusal,
 * as of a protocol this build does not speak, or else not Banda's. */
const refusalIn = (host: Entry, line: string) =>
  Option.match(Schema.decodeUnknownOption(Refusal)(line), {
    onNone: () => Effect.succeed(away(UNEXPECTED)),
    onSome: ({ error }) =>
      Console.error(
        `banda: ${host.name}'s banda refused: ${plain(error.message)}`
      ).pipe(
        Effect.as<Ended>({
          state: "refused",
          why:
            error.code === "protocol"
              ? "Banda there is of another build, which does not speak this one's protocol"
              : refusedWords(error.code),
        })
      ),
  })

/** How many lines of what a command there prints are kept. */
const LINES_KEPT = 8

/** What came of a command run there over ssh: the lines it printed, up
 * to `LINES_KEPT`, and the code it ended with; Tailscale's sign-in link,
 * as ssh waits for the Person before it is in; or `late`. */
type Ran = { lines: string[]; code: number } | { url: string } | "late"

/** Runs `remote` on `host` over ssh, as the follower's ssh runs it, for
 * at most `wait` ms (`Ran`). Its stderr is logged as the follower's. */
const overSsh = (host: Entry, remote: string, run: Run, wait: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const said = heard(host.name)
      const child = yield* run.spawner.spawn(
        command("ssh", commandArgs(host, remote), run.env, "pipe")
      )
      const lines: string[] = []
      const signin = yield* Deferred.make<string>()
      yield* Effect.forkScoped(
        linesOf(child.stderr).pipe(
          Stream.runForEach((line) => {
            // Once it printed, ssh is in: a link is the other machine's.
            const url = lines.length === 0 ? signInOf(line) : undefined
            return (url ? Deferred.succeed(signin, url) : Effect.void).pipe(
              Effect.andThen(said(line, undefined))
            )
          }),
          Effect.ignore
        )
      )
      const ended = Effect.all(
        [
          linesOf(child.stdout).pipe(
            Stream.runForEach((line) =>
              Effect.sync(() => {
                if (lines.length < LINES_KEPT) lines.push(line)
              })
            )
          ),
          exited(child),
        ],
        { concurrency: 2 }
      )
      return yield* Effect.raceAll([
        Effect.map(ended, ([, code]): Ran => ({ lines, code })),
        Effect.map(Deferred.await(signin), (url): Ran => ({ url })),
        Effect.as(Effect.sleep(wait), "late" as Ran),
      ])
    })
  )

/** Test: what is at `host`'s address, as `probeCommand` asks there,
 * starting nothing (#837). */
const probe = (host: Entry, run: Run): Effect.Effect<HostTest> =>
  Effect.gen(function* () {
    const config = yield* configOf(host, run).pipe(Effect.result)
    if (config._tag === "Failure")
      return { state: "refused", why: config.failure } as const
    const forwards = forwardsWhy(host, config.success)
    if (forwards) return { state: "refused", why: forwards } as const
    const ran = yield* overSsh(
      host,
      probeCommand(host.banda),
      run,
      run.times.test
    )
    if (ran === "late")
      return {
        state: "away",
        why: `${host.ssh} did not answer in time`,
      } as const
    if ("url" in ran) return { state: "signin", url: ran.url } as const
    const ssh = sshEnded(host, ran.code)
    if (ssh) return { state: "away", why: ssh } as const
    if (ran.code === NOT_FOUND)
      return { state: "refused", why: notFound(host) } as const
    return foundIn(ran.lines, ran.code, yield* run.own)
  }).pipe(
    Effect.catch((error: { message: string }) =>
      Console.error(`banda: Test ${host.ssh}: ${error.message}`).pipe(
        Effect.as<HostTest>({ state: "away", why: "ssh did not start" })
      )
    )
  )

/** Stop Banda on `host`: its own `banda stop` there (`stopCommand`). */
const stopThere = (host: Entry, force: boolean, run: Run) =>
  Effect.gen(function* () {
    const ran = yield* overSsh(
      host,
      stopCommand(host.banda, force),
      run,
      STOP_WAIT
    ).pipe(
      Effect.mapError(
        (error: { message: string }) =>
          new Refused({ message: `ssh did not start: ${error.message}` })
      )
    )
    const refuse = (message: string) => Effect.fail(new Refused({ message }))
    if (ran === "late") return yield* refuse("Banda there did not stop in time")
    if ("url" in ran)
      return yield* refuse(`sign in to Tailscale to reach ${host.ssh} first`)
    if (ran.code === 0) return "stopped" as const
    const refusal =
      ran.code === 1
        ? Option.getOrUndefined(
            Schema.decodeUnknownOption(Refusal)(ran.lines[0] ?? "")
          )
        : undefined
    if (refusal) {
      yield* Console.error(
        `banda: ${host.name}'s banda refused to stop: ${plain(refusal.error.message)}`
      )
      if (refusal.error.code === "conflict" && !force) return "working" as const
      return yield* refuse(refusedWords(refusal.error.code))
    }
    return yield* refuse(
      sshEnded(host, ran.code) ??
        (ran.code === NOT_FOUND
          ? notFound(host)
          : `Banda there did not stop (code ${ran.code})`)
    )
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
