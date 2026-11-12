import { spawnSync } from "node:child_process"
import { createConnection, createServer, type Server } from "node:net"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import type { HostState } from "@banda/core"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import { channel, CHANNELS } from "./channel"
import {
  addedTo,
  addOf,
  diffOf,
  followerArgs,
  forwardArgs,
  forwardsIn,
  failedIn,
  foundIn,
  Hosts,
  installCommand,
  terminalArgs,
  installedIn,
  hostsOf,
  linesOf,
  listenersIn,
  nameFrom,
  ownOf,
  probeCommand,
  remoteCommand,
  removedFrom,
  rewrite,
  setIn,
  setOf,
  signInOf,
  stopCommand,
  suggestionsOf,
  TIMES,
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

/** How long ssh with `args` waits for each answer before it is in, in
 * ms: ServerAliveInterval times ServerAliveCountMax (OpenSSH). */
const waitsBeforeIn = (args: string[]) => {
  const said = (key: string) =>
    Number(args.find((one) => one.startsWith(`${key}=`))?.split("=")[1])
  return said("ServerAliveInterval") * said("ServerAliveCountMax") * 1000
}

it("a terminal's ssh is Banda's own, but with a terminal and free to ask", () => {
  const args = terminalArgs("roma@devbox", "claude")
  expect(args.slice(-3)).toEqual(["--", "roma@devbox", "claude"])
  expect(args).toContain("-t")
  expect(args).not.toContain("-T")
  expect(args).not.toContain("BatchMode=yes")
  for (const option of followerArgs(DEVBOX).slice(0, -3))
    if (option !== "-T" && option !== "BatchMode=yes" && option !== "-o")
      expect(args).toContain(option)
  for (let at = 0; at < args.length - 3; at++)
    if (args[at] === "-o") expect(args[at + 1]).toMatch(/^[A-Za-z0-9]+=/)
})

it("the follower takes no agent, no X11, no forward, no tunnel, no command of the config's and no shared connection, gives up soon on a machine that does not answer but waits out a sign-in, and runs banda through sh", () => {
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
    "ConnectTimeout=10",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=48",
    "ControlPath=none",
    "ControlMaster=no",
  ])
    expect(args[args.indexOf(option) - 1]).toBe("-o")
  // ssh waits as long for each answer before it is in, while Tailscale
  // SSH says nothing as the Person signs in: longer than they are given.
  expect(waitsBeforeIn(args)).toBeGreaterThan(TIMES.signin)
  // The destination comes after `--`, and the remote command last.
  expect(args.slice(-3)).toEqual(["--", "devbox", remoteCommand(DEVBOX.banda)])
  expect(remoteCommand(DEVBOX.banda)).toBe(
    `sh -c 'exec env XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" BANDA_OVER_SSH=1 ~/.local/bin/banda-dev start --with-parent'`
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

/** A folder in `home` with a `uname` that says `system`, as that
 * machine's would, whatever this one's says. */
function fakeUname(home: string, system: string) {
  const dir = join(home, system)
  mkdirSync(dir)
  writeFileSync(join(dir, "uname"), `#!/bin/sh\necho ${system}\n`, {
    mode: 0o755,
  })
  return dir
}

/** A build's names that no machine here has. */
const FINDME = { folder: "banda-findme", name: "Banda Findme" }

/** The follower's script with no banda, as the login shell there takes
 * the command ssh gives it: in `home`, with `first` before the system's
 * folders on its PATH, and `env`. */
const findIn =
  (home: string, first: string) =>
  (env: Record<string, string> = {}) =>
    spawnSync("/bin/sh", ["-c", remoteCommand(undefined, FINDME)], {
      env: { HOME: home, PATH: `${first}:/usr/bin:/bin`, ...env },
      encoding: "utf8",
    })

it.skipIf(process.platform === "win32")(
  "with no banda in hosts.toml the follower runs this build's own there: on PATH, else the newest copy in its data folder, else none, and exits 127",
  () => {
    const home = folder()
    const bin = join(home, "bin")
    const copies = join(home, ".local/share/banda-findme/engine")
    const there = findIn(home, `${fakeUname(home, "Linux")}:${bin}`)
    // None at all.
    const none = there()
    expect(none.status).toBe(127)
    expect(none.stdout).toBe("")
    expect(none.stderr).toBe("no Banda Findme here\n")
    // The newest copy, as versions sort, not as text; not a half-written
    // one (program.ts's `.<version>-` folders).
    for (const version of ["0.1.0-dev.42", "0.1.0-dev.418", "0.1.0-dev.9"])
      fakeBanda(join(copies, version, "banda"))
    fakeBanda(join(copies, ".0.1.0-dev.500-x1", "banda"))
    expect(there().stdout).toBe(
      `${copies}/0.1.0-dev.418/banda start --with-parent\n`
    )
    // XDG_DATA_HOME moves the data folder.
    const data = join(home, "data")
    fakeBanda(join(data, "banda-findme/engine/0.1.0-dev.1/banda"))
    expect(there({ XDG_DATA_HOME: data }).stdout).toBe(
      `${data}/banda-findme/engine/0.1.0-dev.1/banda start --with-parent\n`
    )
    // A Mac's data folder is not this one's.
    fakeBanda(
      join(home, "Library/Application Support/banda-findme/engine/0.2.0/banda")
    )
    expect(there().stdout).toBe(
      `${copies}/0.1.0-dev.418/banda start --with-parent\n`
    )
    // On PATH first.
    fakeBanda(join(bin, "banda-findme"))
    expect(there().stdout).toBe(`${bin}/banda-findme start --with-parent\n`)
  }
)

it.skipIf(process.platform === "win32")(
  "on a Mac the follower looks in the data folder a Mac has: on PATH, else the newest copy in Application Support, else the app",
  () => {
    const home = folder()
    const bin = join(home, "bin")
    const copies = join(home, "Library/Application Support/banda-findme/engine")
    const there = findIn(home, `${fakeUname(home, "Darwin")}:${bin}`)
    // None: no copy, and no app, as none is in /Applications here.
    expect(there()).toMatchObject({
      status: 127,
      stdout: "",
      stderr: "no Banda Findme here\n",
    })
    // A Linux's data folder, or XDG's, is not a Mac's.
    fakeBanda(join(home, ".local/share/banda-findme/engine/0.1.0/banda"))
    const data = join(home, "data")
    fakeBanda(join(data, "banda-findme/engine/0.1.0/banda"))
    expect(there({ XDG_DATA_HOME: data }).status).toBe(127)
    // The newest copy in Application Support, its space and all.
    for (const version of ["0.1.0-dev.42", "0.1.0-dev.418", "0.1.0-dev.9"])
      fakeBanda(join(copies, version, "banda"))
    expect(there().stdout).toBe(
      `${copies}/0.1.0-dev.418/banda start --with-parent\n`
    )
    // On PATH first.
    fakeBanda(join(bin, "banda-findme"))
    expect(there().stdout).toBe(`${bin}/banda-findme start --with-parent\n`)
    // The app comes after the copy, last.
    const said = remoteCommand(undefined, FINDME)
    const app = said.indexOf(
      "/Applications/Banda Findme.app/Contents/Resources/banda"
    )
    expect(said.indexOf("Library/Application Support")).toBeLessThan(app)
    expect(
      said.indexOf('BANDA_OVER_SSH=1 "$b" start --with-parent')
    ).toBeGreaterThan(app)
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

it("a change of hosts.toml is read by name: the hosts that come, that go, and that changed their ssh or banda", () => {
  const before = [
    { name: "devbox", ssh: "devbox" },
    { name: "arc", ssh: "arc", banda: "~/bin/banda" },
    { name: "m1pro", ssh: "m1pro" },
  ]
  expect(diffOf(before, before)).toEqual({
    added: [],
    removed: [],
    changed: [],
  })
  expect(
    diffOf(before, [
      // Moved: no change.
      { name: "m1pro", ssh: "m1pro" },
      { name: "devbox", ssh: "roma@devbox" },
      { name: "arc", ssh: "arc" },
      { name: "pi5", ssh: "pi5" },
    ])
  ).toEqual({ added: ["pi5"], removed: [], changed: ["devbox", "arc"] })
  expect(diffOf(before, [before[1]!])).toEqual({
    added: [],
    removed: ["devbox", "m1pro"],
    changed: [],
  })
})

/** A hosts.toml the Person wrote, with comments of their own. */
const WRITTEN = `# The machines this Mac shows.

# arc, at home
[[hosts]]
name = "arc"   # the key
ssh = "roma@arc"

[[hosts]]
name = "devbox"
ssh = "devbox"
banda = "~/.local/bin/banda-dev"

# not a host
[other]
kept = true
`

it("a host added goes at the end of hosts.toml, every comment and other entry kept", () => {
  const added = addedTo(WRITTEN, { name: "pi5", ssh: "pi5" })
  expect(added).toEqual({
    text: `${WRITTEN}\n[[hosts]]\nname = "pi5"\nssh = "pi5"\n`,
  })
  const text = (added as { text: string }).text
  expect(hostsOf(text).hosts.map(({ name }) => name)).toEqual([
    "arc",
    "devbox",
    "pi5",
  ])
  // To a file with none, or that is not there, it is the file.
  expect(addedTo("", { name: "pi5", ssh: "pi5", banda: "/opt/banda" })).toEqual(
    {
      text: `[[hosts]]\nname = "pi5"\nssh = "pi5"\nbanda = "/opt/banda"\n`,
    }
  )
  // Hosts written as a list are not a file Banda changes.
  expect(addedTo(`hosts = []\n`, { name: "pi5", ssh: "pi5" })).toEqual({
    why: expect.stringMatching(/cannot change safely/),
  })
  expect(addedTo(`[[hosts]\n`, { name: "pi5", ssh: "pi5" })).toEqual({
    why: expect.stringMatching(/^hosts.toml: it is not TOML/),
  })
})

it("a host taken out of hosts.toml takes its own comment with it, and leaves every other one", () => {
  expect(removedFrom(WRITTEN, "arc")).toEqual({
    text: `# The machines this Mac shows.

[[hosts]]
name = "devbox"
ssh = "devbox"
banda = "~/.local/bin/banda-dev"

# not a host
[other]
kept = true
`,
  })
  expect(removedFrom(WRITTEN, "devbox")).toEqual({
    text: `# The machines this Mac shows.

# arc, at home
[[hosts]]
name = "arc"   # the key
ssh = "roma@arc"

# not a host
[other]
kept = true
`,
  })
  // The comment that starts the file is the file's.
  const last = `# mine\n[[hosts]]\nname = "pi5"\nssh = "pi5"\n`
  expect(removedFrom(last, "pi5")).toEqual({ text: "# mine\n" })
  expect(removedFrom(WRITTEN, "pi5")).toEqual({
    why: 'There is no host "pi5" in hosts.toml.',
  })
  // A file Banda would read otherwise after the change is left as it is.
  const tricky = `[[hosts]]\nname = "a"\nssh = "a"\nnote = """\n[[hosts]]\n"""\n\n[[hosts]]\nname = "b"\nssh = "b"\n`
  expect(removedFrom(tricky, "a")).toEqual({
    why: expect.stringMatching(/cannot change safely/),
  })
})

it("a host's ssh and banda are changed in place, its comments, other keys and every other host kept", () => {
  // The address in its own line, the comment after it kept; a banda the
  // host had not goes after its last key, before the next host's comment.
  const withNote = WRITTEN.replace(
    'ssh = "roma@arc"',
    'ssh = "roma@arc"   # tailnet\nnote = "mine"'
  )
  expect(
    setIn(withNote, "arc", { ssh: "roma@arc.ts.net", banda: "/opt/banda" })
  ).toEqual({
    text: withNote.replace(
      'ssh = "roma@arc"   # tailnet\nnote = "mine"',
      'ssh = "roma@arc.ts.net"   # tailnet\nnote = "mine"\nbanda = "/opt/banda"'
    ),
  })
  // An empty banda takes its line out; the rest stays as it was.
  expect(setIn(WRITTEN, "devbox", { banda: "" })).toEqual({
    text: WRITTEN.replace('banda = "~/.local/bin/banda-dev"\n', ""),
  })
  // What is as it was is not written again, nor an empty banda it has not.
  expect(setIn(WRITTEN, "arc", { ssh: "roma@arc", banda: "" })).toEqual({
    text: WRITTEN,
  })
  expect(setIn(WRITTEN, "pi5", { ssh: "pi5" })).toEqual({
    why: 'There is no host "pi5" in hosts.toml.',
  })
  // A value Banda cannot find in a line of its own is not changed.
  const split = `[[hosts]]\nname = "a"\nssh = """\na"""\n`
  expect(setIn(split, "a", { ssh: "b" })).toEqual({
    why: expect.stringMatching(/cannot change safely/),
  })
})

it("a change of a host is refused for one not there, an address Banda refuses, or a machine another host reaches", () => {
  expect(setOf(WRITTEN, "devbox", { ssh: "roma@devbox", banda: "" })).toEqual({
    text: WRITTEN.replace(
      'ssh = "devbox"\nbanda = "~/.local/bin/banda-dev"',
      'ssh = "roma@devbox"'
    ),
    value: { name: "devbox", ssh: "roma@devbox" },
  })
  expect(setOf(WRITTEN, "arc", { banda: "/opt/banda" })).toMatchObject({
    value: { name: "arc", ssh: "roma@arc", banda: "/opt/banda" },
  })
  for (const [name, change, why] of [
    ["pi5", { ssh: "pi5" }, 'There is no host "pi5" in hosts.toml.'],
    ["arc", { ssh: "" }, /`ssh` is not/],
    ["arc", { ssh: "-oProxyCommand=x" }, /`ssh` is not/],
    ["arc", { banda: "banda; rm" }, /`banda` is not/],
    ["arc", { ssh: "roma@devbox" }, "devbox is in hosts.toml already"],
  ] as const)
    expect(setOf(WRITTEN, name, change)).toEqual({
      why: expect.stringMatching(why),
    })
  // A machine the file has twice from before stays editable, as long as
  // its address stays on that machine.
  const twice = `${WRITTEN}\n[[hosts]]\nname = "root"\nssh = "root@arc"\n`
  expect(setOf(twice, "arc", { banda: "/opt/banda" })).toMatchObject({
    value: { name: "arc", ssh: "roma@arc", banda: "/opt/banda" },
  })
  expect(setOf(twice, "root", { ssh: "admin@arc" })).toMatchObject({
    value: { name: "root", ssh: "admin@arc" },
  })
})

it("a machine is added once, whatever its address: by its machine, not its words", () => {
  for (const ssh of ["arc", "ARC", "ssh://roma@arc:22", "other@arc"])
    expect(addOf(WRITTEN, { ssh })).toEqual({
      why: "arc is in hosts.toml already",
    })
  expect(addOf(WRITTEN, { ssh: "roma@pi5" })).toMatchObject({
    value: { name: "pi5", ssh: "roma@pi5" },
  })
  // A bare IPv6 address is its machine whole, not up to its first `:`.
  const six = (
    addOf(WRITTEN, { name: "one", ssh: "fd7a:115c:a1e0::1" }) as {
      text: string
    }
  ).text
  expect(addOf(six, { name: "two", ssh: "fd7a:115c:a1e0::2" })).toMatchObject({
    value: { name: "two", ssh: "fd7a:115c:a1e0::2" },
  })
  expect(setOf(six, "one", { ssh: "roma@fd7a:115c:a1e0::9" })).toMatchObject({
    value: { name: "one", ssh: "roma@fd7a:115c:a1e0::9" },
  })
  for (const ssh of ["roma@FD7A:115C:A1E0::1", "ssh://[fd7a:115c:a1e0::1]:22"])
    expect(addOf(six, { ssh })).toEqual({
      why: "one is in hosts.toml already",
    })
})

it("a change by hand as Banda writes hosts.toml is kept, and Banda refuses when it comes again", () => {
  const file = join(folder(), "hosts.toml")
  writeFileSync(file, WRITTEN)
  const hand = (text: string) => `${text}\n# by hand ${text.length}\n`
  // The Person saves the file after Banda read it: the change is made
  // again on what they saved.
  let edits = 0
  const once = rewrite(file, (text) => {
    if (edits++ === 0) writeFileSync(file, hand(text))
    return addOf(text, { ssh: "pi5" })
  })
  expect(once).toEqual({ value: { name: "pi5", ssh: "pi5" } })
  expect(edits).toBe(2)
  const kept = readFileSync(file, "utf8")
  expect(kept).toBe(
    (addedTo(hand(WRITTEN), { name: "pi5", ssh: "pi5" }) as { text: string })
      .text
  )
  // Saved again each time: nothing Banda wrote, and the Person's kept.
  const always = rewrite(file, (text) => {
    writeFileSync(file, hand(text))
    return setOf(text, "pi5", { banda: "/opt/banda" })
  })
  expect(always).toEqual({
    why: "hosts.toml changed while Banda wrote it; try again",
  })
  expect(readFileSync(file, "utf8")).toBe(hand(hand(kept)))
  expect(readFileSync(file, "utf8")).not.toContain("/opt/banda")
  // No file of Banda's left beside it.
  expect(readdirSync(dirname(file))).toEqual(["hosts.toml"])
})

it("a new host's name is made from its address, past the names taken", () => {
  const taken = [{ name: "devbox" }, { name: "box2" }]
  expect(nameFrom("arc", taken)).toBe("arc")
  expect(nameFrom("roma@Arc.tail1234.ts.net", taken)).toBe("arc")
  expect(nameFrom("devbox", taken)).toBe("devbox-2")
  expect(nameFrom("box2.lan", taken)).toBe("box2-2")
  expect(nameFrom("local", taken)).toBe("local-2")
  expect(nameFrom("roma@100.79.149.28", taken)).toBe("100-79-149-28")
  expect(nameFrom("ssh://roma@[fd7a:115c::1]:2222", taken)).toBe("fd7a-115c-1")
  expect(nameFrom("my_box", taken)).toBe("my-box")
  expect(nameFrom("___", taken)).toBe("machine")
})

it("the suggestions are the ssh config's Hosts: no pattern, no Match, none reached already", () => {
  const config = `
# mine
Host *
  ServerAliveInterval 30
Host devbox win11
  HostName 192.168.1.20
Host=pi5
Match host foo exec "true"
  User x
Host !bad *.corp
Host "quoted"
Host "my host" "half
Host arc  # at home
Host devbox
host -oProxyCommand=x
`
  expect(suggestionsOf(config, [{ name: "arc", ssh: "roma@arc" }])).toEqual([
    "devbox",
    "win11",
    "pi5",
    "quoted",
  ])
  expect(suggestionsOf("", [])).toEqual([])
})

it("Test reads what the machine is, its banda's build, and its engine while one runs, and nothing else", () => {
  const own = { build: "def456", version: "0.1.0-dev.1" }
  const version = "banda 0.1.0-dev.2 (build abc123)"
  expect(foundIn(["Linux", version, `{"running":false}`], 0, own)).toEqual({
    state: "found",
    system: "Linux",
    named: null,
    banda: { build: "abc123", version: "0.1.0-dev.2" },
    own,
    engine: null,
  })
  // The system and the machine's own name and icon, as banda status says
  // them over uname, cleaned as the page cleans a Welcome's.
  const said = (system: unknown, named: unknown) =>
    foundIn(
      ["Linux", version, JSON.stringify({ running: false, system, named })],
      0,
      own
    )
  expect(said("Arch Linux", { name: "arc", icon: "server" })).toMatchObject({
    system: "Arch Linux",
    named: { name: "arc", icon: "server" },
  })
  expect(
    said("macOS\u202e 26.1\n", {
      name: "\u200bRoma's\u0007 MacBook\u2028 Pro 14-inch",
      icon: "toaster",
    })
  ).toMatchObject({
    system: "macOS 26.1",
    named: { name: "Roma's MacBook P", icon: "desktop" },
  })
  for (const named of [null, "arc", { name: " \u200b ", icon: "vm" }, {}])
    expect(said(3, named)).toMatchObject({ system: "Linux", named: null })
  expect(said("x".repeat(100), null)).toMatchObject({
    system: "x".repeat(40),
  })
  const running = JSON.stringify({
    running: true,
    protocol: 1,
    build: "abc123",
    version: "0.1.0-dev.2",
    since: 1,
    unit: "banda-dev.service",
  })
  expect(foundIn(["Darwin", version, running], 0, own)).toMatchObject({
    system: "macOS",
    engine: { build: "abc123", version: "0.1.0-dev.2", speaks: true },
  })
  expect(
    foundIn(
      ["Plan 9", version, running.replace(`"protocol":1`, `"protocol":2`)],
      0,
      own
    )
  ).toMatchObject({ system: null, engine: { speaks: false } })
  // What is not banda's, its words or its build, is not shown.
  expect(foundIn(["Linux", "Welcome!"], 0, own)).toEqual({
    state: "away",
    why: "banda there said something unexpected",
  })
  expect(
    foundIn(["Linux", "banda 1.0 (build <b>)", `{"running":false}`], 0, own)
  ).toMatchObject({ banda: { build: null, version: "1.0" } })
  expect(foundIn(["Linux", version, "{}"], 2, own)).toEqual({
    state: "refused",
    why: "banda there could not say whether its engine runs (code 2)",
  })
})

it.skipIf(process.platform === "win32")(
  "Test runs uname, banda's --version and banda status there, through sh; Stop Banda runs banda stop",
  () => {
    const home = folder()
    const banda = join(home, "bin/banda")
    mkdirSync(dirname(banda), { recursive: true })
    writeFileSync(
      banda,
      `#!/bin/sh\ncase "$1" in --version) echo "banda 0.1.0 (build abc)" ;; status) echo '{"running":false}' ;; *) echo "$0 $*" ;; esac\n`,
      { mode: 0o755 }
    )
    const path = `${fakeUname(home, "Linux")}:/usr/bin:/bin`
    const there = (command: string) =>
      spawnSync("/bin/sh", ["-c", command], {
        env: { HOME: home, PATH: path },
        encoding: "utf8",
      })
    expect(there(probeCommand(banda)).stdout).toBe(
      `Linux\nbanda 0.1.0 (build abc)\n{"running":false}\n`
    )
    expect(there(probeCommand("~/bin/banda")).stdout).toBe(
      `Linux\nbanda 0.1.0 (build abc)\n{"running":false}\n`
    )
    expect(there(probeCommand("~/bin/none")).status).toBe(127)
    expect(there(probeCommand(undefined, FINDME))).toMatchObject({
      status: 127,
      stdout: "",
    })
    expect(there(stopCommand(banda, false)).stdout).toBe(`${banda} stop\n`)
    expect(there(stopCommand(banda, true)).stdout).toBe(
      `${banda} stop --force\n`
    )
    // Neither starts an engine.
    for (const command of [
      probeCommand(undefined),
      stopCommand(undefined, true),
    ])
      expect(command).not.toContain("start")
  }
)

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

it("the forward listens on this machine's loopback alone, to that machine's loopback, and ends when it cannot, and soon on a link gone silent", () => {
  const args = forwardArgs(DEVBOX, 40_001, 4321)
  expect(args[0]).toBe("-N")
  expect(args[args.indexOf("-L") + 1]).toBe("127.0.0.1:40001:127.0.0.1:4321")
  expect(args[args.indexOf("ExitOnForwardFailure=yes") - 1]).toBe("-o")
  for (const option of [
    "BatchMode=yes",
    "ForwardAgent=no",
    "ForwardX11=no",
    "ConnectTimeout=10",
    "ServerAliveInterval=5",
    "ServerAliveCountMax=3",
  ])
    expect(args[args.indexOf(option) - 1]).toBe("-o")
  expect(waitsBeforeIn(args)).toBe(15_000)
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
 * follower, of the forward and of a command there, as Test's and Stop
 * Banda's; the last run plays again. */
type Play = {
  config?: string
  followers: Step[][]
  forwards?: Step[][]
  commands?: Step[][]
}

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
const kind = args.includes("-N")
  ? "forward"
  : / (status|stop)\\b|\\| sh -s --/.test(args.at(-1))
    ? "command"
    : "follower"
const runs = play[kind + "s"] ?? [[kind === "command" ? { exit: 0 } : { listen: true }]]
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
    /** The runs of one kind, of every host or of the one at `ssh`. */
    runs: (kind: "-G" | "-N" | "follower" | "command", ssh?: string) =>
      calls().filter(({ args }) => {
        if (ssh !== undefined && !args.includes(ssh)) return false
        const command = / (status|stop)\b|\| sh -s --/.test(args.at(-1)!)
        if (kind === "command") return args[0] !== "-G" && command
        return kind === "follower"
          ? args[0] !== "-G" && !args.includes("-N") && !command
          : args.includes(kind)
      }),
    /** The pids of the runs that go to `ssh`, ssh -G's too. */
    pidsOf: (ssh: string) =>
      calls()
        .filter(({ args }) => args.includes(ssh))
        .map(({ pid }) => pid),
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
  test: 5_000,
}

const DEVBOX_TOML = `[[hosts]]\nname = "devbox"\nssh = "devbox"\nbanda = "~/.local/bin/banda-dev"\n`
/** devbox's entry in DEVBOX_TOML, as its state carries it to the page. */
const DEVBOX_AT = { ssh: "devbox", banda: "~/.local/bin/banda-dev" }

/** The hosts of `toml`, their ssh `fake`, this window's banda of build
 * `def456`. */
function hostsOn(
  fake: ReturnType<typeof fakeSsh>,
  times: Partial<Times> = {},
  toml = DEVBOX_TOML,
  install?: string
) {
  const file = join(fake.dir, "hosts.toml")
  writeFileSync(file, toml)
  return Hosts.layer(file, {
    env: fake.env,
    times: { ...FAST, ...times },
    install,
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
          ...DEVBOX_AT,
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
          ...DEVBOX_AT,
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
          ...DEVBOX_AT,
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
          ...DEVBOX_AT,
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
  "with nobody logged in at a Mac the host is away, never stopped, and is tried again until its engine runs",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          // It runs, then the Person logs out there: its engine stopped.
          [{ out: running("one", 1111) }, { until: "quit" }, { exit: 75 }],
          // Nobody logged in.
          [
            {
              err: "banda: Nobody is logged in at this Mac's screen",
              exit: 75,
            },
          ],
          // Logged in again: it runs.
          [{ out: running("two", 2222) }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect((yield* hosts.address("devbox")).secret).toBe("one")
        const seen = yield* watched
        fake.touch("quit")
        expect(yield* reaches((host) => host.state === "away")).toEqual({
          name: "devbox",
          ...DEVBOX_AT,
          state: "away",
          why: `${channel.name} is not running there, or nobody is logged in there`,
        })
        // No one asks: it comes back as the Person logs in there.
        expect((yield* hosts.address("devbox")).secret).toBe("two")
        expect(fake.runs("follower")).toHaveLength(3)
        expect(seen.map((host) => host.state)).not.toContain("stopped")
        expect(logged).toContain(
          `banda: devbox is away (${channel.name} is not running there, or nobody is logged in there); Banda tries again in 100 ms`
        )
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
          ...DEVBOX_AT,
          state: "refused",
          why: "Banda there is of another build, which does not speak this one's protocol",
        })
        yield* Effect.sleep(300)
        expect(fake.runs("follower")).toHaveLength(1)
        // A read of a file's bytes takes the refusal there is, and tries
        // nothing.
        const read = yield* Effect.flip(hosts.addressWhenBack("devbox"))
        expect(read.message).toMatch(/^devbox: Banda there is of another build/)
        yield* Effect.sleep(100)
        expect(fake.runs("follower")).toHaveLength(1)
        // Asking where it listens tries it again, and fails with the new
        // go's refusal, not the old one's.
        const asked = yield* Effect.flip(hosts.address("devbox"))
        expect(asked.message).toMatch(
          /^devbox: Banda there is of another build/
        )
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
          ssh: "devbox",
          state: "refused",
          why: `no ${channel.name} found there; set banda in hosts.toml`,
        })
        // Past the wait after an ssh that ends: not tried again.
        yield* Effect.sleep(400)
        expect(fake.runs("follower")).toHaveLength(1)
        const asked = yield* Effect.flip(hosts.address("devbox"))
        expect(asked.message).toBe(
          `devbox: no ${channel.name} found there; set banda in hosts.toml`
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
            ...DEVBOX_AT,
            state: "refused",
            why: "no ~/.local/bin/banda-dev there; check banda in hosts.toml",
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
          ...DEVBOX_AT,
          state: "refused",
          why: "the engine there speaks protocol 2, this window 1",
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
          ...DEVBOX_AT,
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
            ...DEVBOX_AT,
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
          "banda there said something unexpected",
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
          "banda there said something unexpected",
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

/** The hosts' names, as they are now. */
const names = Hosts.use((hosts) =>
  Effect.map(hosts.current, (list) => list.map(({ name }) => name))
)

/** Waits for the hosts to be `want`, by name, in their order. */
const named = (want: string[]) =>
  Hosts.use((hosts) =>
    hosts.changes.pipe(
      Stream.filter(
        (list) =>
          JSON.stringify(list.map(({ name }) => name)) === JSON.stringify(want)
      ),
      Stream.runHead
    )
  )

/** Whether process `pid` runs. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const BOX2 = `[[hosts]]\nname = "box-2"\nssh = "box2"\n`

it.live(
  "hosts.toml applies as it changes: a host that comes is reached, one whose ssh or banda changed is reached again, one that goes has its ssh ended",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ out: running("one", 1111) }]] })
      const file = join(fake.dir, "hosts.toml")
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        yield* hosts.address("devbox")
        const first = fake.runs("follower", "devbox")
        expect(first).toHaveLength(1)
        // A host comes, written as an editor writes, in steps.
        writeFileSync(file, `${DEVBOX_TOML}\n`)
        writeFileSync(file, `${DEVBOX_TOML}\n${BOX2}`)
        yield* named(["devbox", "box-2"])
        yield* hosts.address("box-2")
        expect(fake.runs("follower", "devbox")).toHaveLength(1)
        expect(logged).toContain(
          `banda: ${file}: box-2 is added; Banda reaches it`
        )
        // devbox's banda changes: its ssh end, and it is reached anew, with
        // its new banda.
        const before = fake.pidsOf("devbox")
        writeFileSync(
          file,
          `[[hosts]]\nname = "devbox"\nssh = "devbox"\n\n${BOX2}`
        )
        yield* until(() => fake.runs("follower", "devbox").length === 2)
        expect(fake.runs("follower", "devbox")[1]!.args.at(-1)).toBe(
          remoteCommand(undefined)
        )
        yield* until(() => before.every((pid) => !alive(pid)))
        yield* Hosts.use((hosts) => hosts.address("devbox"))
        expect(fake.runs("follower", "box2")).toHaveLength(1)
        // devbox goes: its ssh end; box-2 is as it was.
        const devbox = fake.pidsOf("devbox")
        writeFileSync(file, BOX2)
        yield* named(["box-2"])
        yield* until(() => devbox.every((pid) => !alive(pid)))
        expect((yield* hosts.current)[0]!.state).toBe("live")
        expect(fake.runs("follower", "box2")).toHaveLength(1)
        const gone = yield* Effect.flip(hosts.address("devbox"))
        expect(gone.message).toBe('There is no host "devbox" in hosts.toml.')
        // A file saved half-written leaves the hosts as they were.
        writeFileSync(file, `[[hosts]\nname = `)
        yield* until(() =>
          logged.some((line) => line.includes("the hosts stay as they were"))
        )
        expect(yield* names).toEqual(["box-2"])
        expect(fake.runs("follower", "box2")).toHaveLength(1)
        // And no hosts.toml is no host.
        rmSync(file)
        yield* named([])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a waiter for an address hears that its host went",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ until: "never" }]] })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const asked = yield* Effect.forkScoped(
          Effect.flip(hosts.address("devbox"))
        )
        yield* until(() => fake.runs("follower").length === 1)
        writeFileSync(join(fake.dir, "hosts.toml"), "")
        expect((yield* Fiber.join(asked)).message).toBe(
          'There is no host "devbox" in hosts.toml.'
        )
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "addressNow says where a live host listens, and none at once while it connects, is away or is not there; addressWhenBack waits for it",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [
            { until: "up" },
            { out: running("one", 1111) },
            { until: "drop" },
            { exit: 1 },
          ],
          [{ err: "ssh: connect to host devbox port 22: refused", exit: 255 }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect(yield* hosts.addressNow("devbox")).toBeUndefined()
        const waiting = yield* Effect.forkChild(hosts.addressWhenBack("devbox"))
        fake.touch("up")
        yield* reaches((host) => host.state === "live")
        expect(yield* Fiber.join(waiting)).toEqual(
          yield* hosts.address("devbox")
        )
        expect(
          (yield* Effect.flip(hosts.addressWhenBack("nowhere"))).message
        ).toMatch(/no host "nowhere"/)
        expect(yield* hosts.addressNow("devbox")).toEqual(
          yield* hosts.address("devbox")
        )
        fake.touch("drop")
        yield* reaches((host) => host.state === "away")
        expect(yield* hosts.addressNow("devbox")).toBeUndefined()
        expect(yield* hosts.addressNow("nowhere")).toBeUndefined()
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "a host added over the bridge is written at the end of hosts.toml and reached at once; taken out, its ssh ends and the file is as it was",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({ followers: [[{ out: running("one", 1111) }]] })
      const file = join(fake.dir, "hosts.toml")
      const written = `# mine\n\n${DEVBOX_TOML}`
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        const added = yield* hosts.add({
          ssh: "roma@box2.tail1234.ts.net",
          banda: "",
        })
        expect(added).toEqual({
          name: "box2",
          ssh: "roma@box2.tail1234.ts.net",
        })
        expect(readFileSync(file, "utf8")).toBe(
          `${written}\n[[hosts]]\nname = "box2"\nssh = "roma@box2.tail1234.ts.net"\n`
        )
        // Reached at once, not on the watch's word, each with its entry.
        expect(yield* names).toEqual(["devbox", "box2"])
        expect(
          (yield* hosts.current).map(({ name, ssh, banda }) => ({
            name,
            ssh,
            banda,
          }))
        ).toEqual([
          { name: "devbox", ...DEVBOX_AT },
          { name: "box2", ssh: "roma@box2.tail1234.ts.net", banda: undefined },
        ])
        yield* hosts.address("box2")
        // Refused: a machine there already, at this address or another; a
        // name taken; an option.
        for (const [machine, why] of [
          [{ ssh: "roma@box2.tail1234.ts.net" }, /^box2 is in hosts.toml/],
          [{ ssh: "box2.tail1234.ts.net" }, /^box2 is in hosts.toml/],
          [{ name: "devbox", ssh: "other" }, /"devbox" is taken/],
          [{ name: "this", ssh: "other" }, /is Banda's own/],
          [{ ssh: "-oProxyCommand=x" }, /`ssh` is not/],
          [{ ssh: "x", banda: "banda; rm" }, /`banda` is not/],
        ] as const)
          expect((yield* Effect.flip(hosts.add(machine))).message).toMatch(why)
        const pids = fake.pidsOf("roma@box2.tail1234.ts.net")
        yield* hosts.remove("box2")
        expect(readFileSync(file, "utf8")).toBe(written)
        expect(yield* names).toEqual(["devbox"])
        yield* until(() => pids.every((pid) => !alive(pid)))
        expect((yield* Effect.flip(hosts.remove("box2"))).message).toBe(
          'There is no host "box2" in hosts.toml.'
        )
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, {}, written)))
    }),
  20_000
)

it.live(
  "a host's address changed over the bridge is written in place and reached again at it; an empty banda is none",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [{ out: running("one", 1111) }],
          [{ out: running("two", 2222) }],
        ],
      })
      const file = join(fake.dir, "hosts.toml")
      const written = `# mine\n\n${DEVBOX_TOML.replace('ssh = "devbox"', 'ssh = "devbox"  # home')}`
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect((yield* hosts.address("devbox")).secret).toBe("one")
        const pids = fake.pidsOf("devbox")
        expect(
          yield* hosts.set("devbox", { ssh: "roma@devbox", banda: "" })
        ).toEqual({ name: "devbox", ssh: "roma@devbox" })
        expect(readFileSync(file, "utf8")).toBe(
          `# mine\n\n[[hosts]]\nname = "devbox"\nssh = "roma@devbox"  # home\n`
        )
        // The page sees its new entry, the banda gone with the empty one.
        const changed = (yield* hosts.current)[0]!
        expect(changed).toMatchObject({ name: "devbox", ssh: "roma@devbox" })
        expect(changed).not.toHaveProperty("banda")
        // Reached again at once, at the new address, the old ssh ended.
        expect((yield* hosts.address("devbox")).secret).toBe("two")
        expect(fake.runs("follower", "roma@devbox")).toHaveLength(1)
        expect(fake.runs("follower").at(-1)!.args.at(-1)).toBe(
          remoteCommand(undefined)
        )
        yield* until(() => pids.every((pid) => !alive(pid)))
        expect(
          (yield* Effect.flip(hosts.set("nowhere", { ssh: "x" }))).message
        ).toBe('There is no host "nowhere" in hosts.toml.')
        expect(yield* names).toEqual(["devbox"])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, {}, written)))
    }),
  20_000
)

it.live(
  "Test asks banda status there and starts nothing: what the machine is, its banda's build, and whether its engine runs",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [],
        commands: [
          [
            { out: "Linux" },
            { out: "banda 0.1.0-dev.2 (build abc123)" },
            {
              out: JSON.stringify({
                running: false,
                system: "Arch Linux",
                named: { name: "pi5", icon: "router" },
              }),
            },
            { exit: 0 },
          ],
          [{ err: "ssh: connect to host pi5 port 22: refused", exit: 255 }],
          [{ err: "no Banda Local here", exit: 127 }],
          [
            {
              err: "# To authenticate, visit: https://login.tailscale.com/a/1",
            },
            { until: "never" },
          ],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect(yield* hosts.test("roma@pi5", undefined)).toEqual({
          state: "found",
          system: "Arch Linux",
          named: { name: "pi5", icon: "router" },
          banda: { build: "abc123", version: "0.1.0-dev.2" },
          own: { build: "def456", version: "0.1.0-dev.1" },
          engine: null,
        })
        // ssh -G, then the probe alone: no follower, no forward.
        expect(fake.calls().map(({ args }) => args)).toEqual([
          ["-G", "--", "roma@pi5"],
          [
            ...followerArgs({ name: "pi5", ssh: "roma@pi5" }).slice(0, -1),
            probeCommand(undefined),
          ],
        ])
        expect(yield* hosts.test("pi5", "/opt/banda")).toEqual({
          state: "away",
          why: "ssh could not reach pi5",
        })
        expect(fake.runs("command").at(-1)!.args.at(-1)).toBe(
          probeCommand("/opt/banda")
        )
        expect(yield* hosts.test("pi5", undefined)).toEqual({
          state: "refused",
          why: `no ${channel.name} found there; set banda in hosts.toml`,
        })
        expect(yield* hosts.test("pi5", undefined)).toEqual({
          state: "signin",
          url: "https://login.tailscale.com/a/1",
        })
        expect(
          (yield* Effect.flip(hosts.test("-oProxyCommand=x", undefined)))
            .message
        ).toMatch(/`ssh` is not/)
        expect(yield* names).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, {}, "")))
    }),
  20_000
)

it.live(
  "Stop Banda runs banda stop there: while Agents work it stops nothing unless forced, and once stopped the host shows stopped",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [
          [{ out: running("one", 1111) }, { until: "stopped" }, { exit: 0 }],
        ],
        commands: [
          [
            {
              out: JSON.stringify({
                error: {
                  code: "conflict",
                  message:
                    "An Agent works on this computer. Quitting Banda stops it too. Nothing was stopped: banda stop --force quits anyway.",
                },
              }),
              exit: 1,
            },
          ],
          [{ exit: 0 }],
        ],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        yield* hosts.address("devbox")
        expect(yield* hosts.stop("devbox", false)).toBe("working")
        expect(fake.runs("command")[0]!.args.at(-1)).toBe(
          stopCommand(DEVBOX.banda, false)
        )
        expect(yield* hosts.stop("devbox", true)).toBe("stopped")
        expect(fake.runs("command")[1]!.args.at(-1)).toBe(
          stopCommand(DEVBOX.banda, true)
        )
        // Its follower hears the engine stop as asked.
        fake.touch("stopped")
        yield* reaches((host) => host.state === "stopped")
        expect(
          (yield* Effect.flip(hosts.stop("nowhere", true))).message
        ).toMatch(/no host "nowhere"/)
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live(
  "Stop Banda on a host that is away holds it stopped: no try starts its engine again until the page starts it",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        // As with AllowTcpForwarding no there: the engine runs, the
        // forward fails each time.
        followers: [[{ out: running("one", 1111) }]],
        forwards: [[{ exit: 1 }]],
      })
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        yield* reaches((host) => host.state === "away")
        expect(yield* hosts.stop("devbox", false)).toBe("stopped")
        expect((yield* hosts.current)[0]).toEqual({
          name: "devbox",
          ...DEVBOX_AT,
          state: "stopped",
        })
        // Past several of the waits after an away go: no try.
        const tries = fake.runs("follower").length
        yield* Effect.sleep(700)
        expect(fake.runs("follower")).toHaveLength(tries)
        expect((yield* hosts.current)[0]!.state).toBe("stopped")
        expect(logged).toContain(
          "banda: devbox's engine stopped as asked; Banda starts it again when asked"
        )
        // Stopped again, it stays as it is.
        expect(yield* hosts.stop("devbox", false)).toBe("stopped")
        expect(fake.runs("follower")).toHaveLength(tries)
        // Starting it tries again at once.
        yield* hosts.start("devbox")
        yield* until(() => fake.runs("follower").length > tries)
        yield* reaches((host) => host.state === "away")
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake)))
    }),
  20_000
)

it.live("the suggestions leave out the machines hosts.toml reaches", () =>
  Effect.gen(function* () {
    const fake = fakeSsh({ followers: [[{ until: "never" }]] })
    const config = join(fake.dir, "ssh_config")
    writeFileSync(config, "Host devbox pi5 *\n")
    const layer = Hosts.layer(join(fake.dir, "hosts.toml"), {
      env: fake.env,
      times: FAST,
      sshConfig: config,
    }).pipe(
      Layer.provide(Program.layer({ program: "banda" })),
      Layer.provide(NodeServices.layer)
    )
    writeFileSync(join(fake.dir, "hosts.toml"), DEVBOX_TOML)
    expect(
      yield* Hosts.use((hosts) => hosts.suggestions).pipe(Effect.provide(layer))
    ).toEqual(["pi5"])
  })
)

it("Install's command runs the script through sh, quotes and backslashes kept, whatever the shell", () => {
  const script = `printf '%s|' "$@"; echo "it's \\\\ $(printf '\\101')"`
  const command = installCommand(script, ["--check", "0.1.0-dev.660", "o'k"])
  for (const shell of ["sh", "bash", "zsh", "fish"]) {
    const ran = spawnSync(shell, ["-c", command], { encoding: "utf8" })
    if (ran.error) continue // not on this machine
    expect(ran.stdout).toBe("--check|0.1.0-dev.660|ok|it's \\ A\n")
  }
})

it("what install.sh says is read by its first words; its last failed line is why", () => {
  expect(
    installedIn([
      "machine linux x86_64 Ubuntu 24.04",
      "version 0.1.0-dev.660",
      "installed 0.1.0-dev.660 /home/r/.local/share/banda-dev/engine/0.1.0-dev.660",
    ])
  ).toEqual({
    machine: { os: "linux", arch: "x86_64", system: "Ubuntu 24.04" },
    installed: {
      version: "0.1.0-dev.660",
      path: "/home/r/.local/share/banda-dev/engine/0.1.0-dev.660",
    },
  })
  expect(installedIn(["noise"])).toEqual({})
  expect(failedIn(["Warning: x", "failed no Banda for riscv64"])).toBe(
    "no Banda for riscv64"
  )
  expect(failedIn(["Warning: x"])).toBeUndefined()
})

it.live(
  "with no Banda there, Test says what Install would put there, and Install runs install.sh there, saying each line",
  () =>
    Effect.gen(function* () {
      const fake = fakeSsh({
        followers: [],
        commands: [
          [{ err: "no Banda Local here", exit: 127 }],
          [
            { out: "machine linux x86_64 Ubuntu 24.04" },
            { out: "version 0.1.0-dev.1" },
            {
              out: "would 0.1.0-dev.1 /home/r/.local/share/banda-dev/engine/0.1.0-dev.1",
            },
            { exit: 0 },
          ],
          [
            { out: "machine linux x86_64 Ubuntu 24.04" },
            { out: "version 0.1.0-dev.1" },
            {
              out: "downloading banda-dev-0.1.0-dev.1-engine-linux-x86_64.tar.gz 5",
            },
            { out: "checked banda-dev-0.1.0-dev.1-engine-linux-x86_64.tar.gz" },
            {
              out: "installed 0.1.0-dev.1 /home/r/.local/share/banda-dev/engine/0.1.0-dev.1",
            },
            { exit: 0 },
          ],
          [
            { out: "machine linux riscv64 Debian" },
            { err: "failed no Banda for riscv64" },
            { exit: 1 },
          ],
          [{ until: "never" }],
        ],
      })
      const install = join(fake.dir, "install.sh")
      writeFileSync(install, "echo installs\n")
      yield* Effect.gen(function* () {
        const hosts = yield* Hosts
        expect(yield* hosts.test("devbox", undefined)).toEqual({
          state: "missing",
          system: "Ubuntu 24.04",
          arch: "x86_64",
          version: "0.1.0-dev.1",
        })
        expect(fake.runs("command").at(-1)!.args.at(-1)).toBe(
          installCommand("echo installs\n", ["--check", "0.1.0-dev.1"])
        )
        const told: string[] = []
        expect(
          yield* hosts.install("devbox", (line) => told.push(line))
        ).toEqual({
          version: "0.1.0-dev.1",
          path: "/home/r/.local/share/banda-dev/engine/0.1.0-dev.1",
        })
        expect(told).toHaveLength(5)
        expect(fake.runs("command").at(-1)!.args.at(-1)).toBe(
          installCommand("echo installs\n", ["0.1.0-dev.1"])
        )
        expect(
          (yield* Effect.flip(hosts.install("devbox", () => {}))).message
        ).toBe("no Banda for riscv64")
        // Cancel ends it, and its ssh.
        const running = yield* Effect.forkScoped(
          Effect.flip(hosts.install("devbox", () => {}))
        )
        yield* until(() => fake.runs("command").length === 5)
        expect(
          (yield* Effect.flip(hosts.install("devbox", () => {}))).message
        ).toMatch(/being installed on devbox already/)
        yield* hosts.cancelInstall("devbox")
        expect((yield* Fiber.join(running)).message).toBe(
          "Install was cancelled"
        )
        const pid = fake.runs("command").at(-1)!.pid
        yield* until(() => !alive(pid))
      }).pipe(Effect.scoped, Effect.provide(hostsOn(fake, {}, "", install)))
    }),
  20_000
)
