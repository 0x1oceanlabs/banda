/**
 * The client against the real engine (`target/debug/banda`), with the
 * fake agent as the Harness. They run only once both were built from this
 * checkout's sources, and say which build to run when not (./built.ts).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { type AddressInfo, createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { decodeFact } from "../src/agents"
import { seeded } from "../src/workspaces"
import {
  type Address,
  Engine,
  newId,
  type Event,
  Lost,
  type ProjectId,
  Refused,
  type Status,
  Unreachable,
} from "../src/index"
import { program } from "./built"

beforeAll(() => {
  program("banda")
  program("banda-fake-agent")
})

let dir: string
let engine: ChildProcess | null = null
let client: Engine | null = null
/** A second client a test makes, closed after it however it went. */
let other: Engine | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banda-contract-"))
  mkdirSync(join(dir, "config"))
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake"\ncommand = ${JSON.stringify(program("banda-fake-agent"))}\n`
  )
})

afterEach(async () => {
  client?.close()
  other?.close()
  other = null
  await stop()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

/** Starts the engine as a window does, and waits for its first line. */
function serve(): Promise<void> {
  const child = spawn(program("banda"), ["serve", "--with-parent"], {
    env: {
      ...process.env,
      BANDA_ROOT: join(dir, "root"),
      BANDA_DATA: join(dir, "data"),
      BANDA_STATE: join(dir, "state"),
      BANDA_CONFIG: join(dir, "config"),
      BANDA_LOG: "warn",
    },
    stdio: ["pipe", "pipe", "inherit"],
  })
  engine = child
  return new Promise((ready, failed) => {
    child.once("error", failed)
    createInterface({ input: child.stdout! }).once("line", () => ready())
  })
}

function stop(): Promise<void> {
  const child = engine
  engine = null
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((done) => {
    child.once("exit", () => done())
    child.stdin!.end()
  })
}

/** The engine parts in the list of Apps, in its order, as `banda modules`
 * prints them: the ones with methods. */
function engineParts(): string[] {
  return execFileSync(program("banda"), ["modules"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { id: string; engine: unknown })
    .filter((offer) => offer.engine != null)
    .map((offer) => offer.id)
}

/** Reads where the engine listens, as the window's host does. */
async function address(): Promise<Address> {
  const running = JSON.parse(
    readFileSync(join(dir, "state/engine.json"), "utf8")
  )
  return {
    url: `ws://127.0.0.1:${running.port}/ws`,
    secret: running.secret,
  }
}

function until(engine: Engine, state: Status["state"]): Promise<void> {
  return new Promise((done) => {
    const stop = engine.watch((status) => {
      if (status.state === state) {
        queueMicrotask(() => stop())
        done()
      }
    })
  })
}

test("a window calls, follows and sees refusals by their code", async () => {
  await serve()
  client = new Engine(address)
  await until(client, "open")
  // The engine serves the list of Apps' engine parts, and no other
  // (ADR 0062, decision 11): the Apps', then the platform's.
  const parts = engineParts()
  expect(parts).toContain("agents")
  expect(client.status).toMatchObject({ modules: parts })

  const project = await client.command("projects.create", {
    name: "Work",
  })
  expect(project.name).toBe("Work")
  // Params the engine does not take, as the CLI may send.
  const refused = client.call("agents.thread", {} as never, {
    project: project.id,
  })
  await expect(refused).rejects.toBeInstanceOf(Refused)
  await expect(refused).rejects.toMatchObject({ refusal: { code: "invalid" } })

  const kinds: string[] = []
  const ended = new Promise<void>((done) =>
    client!.follow(
      project.id,
      0,
      { module: "agents" },
      (event: Event) => {
        const fact = decodeFact(event)
        if (fact) kinds.push(fact.kind)
        if (fact?.kind === "turn.ended") done()
      },
      () => {}
    )
  )
  await client.command(
    "agents.send",
    { harness: "fake", text: "hello" },
    project.id
  )
  await ended
  // The Harness says its slash commands as its session opens: in the
  // turn's first offer, or in another as the turn runs, as it is quick.
  const once = kinds.filter(
    (kind, at) => kind !== "thread.offered" || kinds.indexOf(kind) === at
  )
  expect(once).toEqual([
    "thread.started",
    "message.posted",
    "turn.started",
    "thread.offered",
    "thought.grew",
    "reply.grew",
    "turn.ended",
  ])
})

test("a subscription goes on after the engine restarts, without a gap", async () => {
  await serve()
  client = new Engine(address)
  const project = await client.command("projects.create", {
    name: "Work",
  })
  const heard: string[] = []
  client.follow(
    project.id,
    0,
    { module: "agents", kinds: ["thread.started"] },
    (event) => heard.push(event.kind),
    () => {}
  )
  await client.command(
    "agents.send",
    { harness: "fake", text: "one" },
    project.id
  )

  await stop()
  await until(client, "lost")
  await serve()
  await until(client, "open")

  await client.command(
    "agents.send",
    { harness: "fake", text: "two" },
    project.id
  )
  await expect.poll(() => heard).toEqual(["thread.started", "thread.started"])
})

test("a window runs a terminal and hears what it prints, until it closes", async () => {
  await serve()
  client = new Engine(address)
  const project = await client.command("projects.create", {
    name: "Work",
  })
  const terminal = newId()
  await client.call(
    "terminal.open",
    {
      terminal,
      program: "sh",
      args: ["-c", 'read word; echo "got $word"; sleep 100'],
      size: { cols: 80, rows: 24 },
    },
    { project: project.id }
  )
  let screen = ""
  let closed = false
  client.stream(
    project.id,
    "terminal.watch",
    { terminal },
    (piece) => {
      if (piece.kind === "snapshot") screen = piece.history
      if (piece.kind === "output") screen += piece.text
    },
    () => (closed = true)
  )
  await client.call(
    "terminal.write",
    { terminal, data: "hi\r" },
    { project: project.id }
  )
  await expect.poll(() => screen).toContain("got hi")
  await client.call("terminal.close", { terminal }, { project: project.id })
  await expect.poll(() => closed).toBe(true)
})

test("a stream heard once ends when the connection breaks, and is not asked again", async () => {
  await serve()
  client = new Engine(address)
  const project = await client.command("projects.create", {
    name: "Work",
  })
  const terminal = newId()
  await client.call(
    "terminal.open",
    {
      terminal,
      program: "sh",
      args: ["-c", "sleep 100"],
      size: { cols: 80, rows: 24 },
    },
    { project: project.id }
  )
  const ends: (string | undefined)[] = []
  client.stream(
    project.id,
    "terminal.watch",
    { terminal },
    () => {},
    (refusal) => ends.push(refusal?.code),
    { once: true }
  )
  await expect.poll(() => client!.status.state).toBe("open")
  await stop()
  await until(client, "lost")
  await expect.poll(() => ends).toEqual(["may_have_run"])
})

test("woken, as its machine is back, a window tries at once, and waits from the first wait again", async () => {
  await serve()
  // While its machine is away, the window is not told where it listens.
  let away = false
  client = new Engine(() =>
    away ? Promise.reject(new Error("away")) : address()
  )
  await until(client, "open")
  const lost: { retryIn: number; at: number }[] = []
  client.watch((status) => {
    if (status.state === "lost")
      lost.push({ retryIn: status.retryIn, at: Date.now() })
  })
  away = true
  await stop()
  await serve()
  // Each try waits longer than the last.
  const longer = { timeout: 5_000 }
  await expect.poll(() => lost.at(-1)?.retryIn, longer).toBe(1_000)
  client.wake()
  await expect.poll(() => lost.at(-1)?.retryIn).toBe(250)
  await expect.poll(() => lost.at(-1)?.retryIn, longer).toBe(2_000)
  // Back, it connects before its wait is out; open, waking changes
  // nothing.
  away = false
  const { at, retryIn } = lost.at(-1)!
  client.wake()
  await until(client, "open")
  expect(Date.now()).toBeLessThan(at + retryIn)
  const { boot } = client.status as { boot: string }
  client.wake()
  expect(client.status).toMatchObject({ state: "open", boot })
})

/** The machine's own log, which its modules, the workspaces too, write
 * and are followed by. */
function machineOf(engine: Engine): ProjectId {
  const status = engine.status
  if (status.state !== "open" || !status.machine) throw new Error("no machine")
  return status.machine
}

test("a command is answered with its place in the log, as the event it wrote stands there", async () => {
  await serve()
  client = new Engine(address)
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  const heard: number[] = []
  client.follow(
    machineOf(client),
    0,
    { module: "workspaces" },
    (event) => heard.push(event.seq),
    () => {}
  )
  const notes = { project: project.id, kind: "notes.page", args: { page: 1 } }
  const id = newId()
  const opened = await client.commandAt("workspaces.open", notes, undefined, id)
  // The engine says where its event stands; the module's answer says
  // only what it opened.
  expect(opened.at).toEqual(expect.any(Number))
  expect(opened.answer).toEqual({ pane: expect.any(String), new: true })
  await expect.poll(() => heard).toContain(opened.at)
  // Sent again, the same answer at the same place.
  const again = await client.commandAt("workspaces.open", notes, undefined, id)
  expect(again).toEqual(opened)
  // Shown already, it writes nothing: the engine says no place, so a
  // client waits to hear nothing (#880), sent again too.
  const once = newId()
  const shown = await client.commandAt(
    "workspaces.open",
    notes,
    undefined,
    once
  )
  expect(shown.answer).toEqual({ pane: opened.answer.pane, new: false })
  expect(shown.at).toBeNull()
  const shownAgain = client.commandAt("workspaces.open", notes, undefined, once)
  expect(await shownAgain).toEqual(shown)
  // A refusal has no place: it rejects, as `command` does.
  const unfit = client.commandAt("workspaces.close", { pane: newId() })
  await expect(unfit).rejects.toMatchObject({ refusal: { code: "not_found" } })
})

test("commands cut off by a restart go again in the order sent, and their places rise in that order", async () => {
  await serve()
  client = new Engine(address)
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  const ids = [1, 2, 3, 4, 5].map(() => newId())
  const opening = (page: number) =>
    client!.commandAt(
      "workspaces.open",
      { project: project.id, kind: "notes.page", args: { page } },
      undefined,
      ids[page - 1]
    )
  // Sent together, and the engine stops at once: some may be answered
  // before it goes, the rest are sent again once it is back. One it was
  // running as it stopped answers `may_have_run`.
  const sent = [1, 2, 3].map(opening)
  await stop()
  await until(client, "lost")
  // Sent while it is away: they wait, and go after those.
  sent.push(...[4, 5].map(opening))
  await serve()
  const settled = await Promise.allSettled(sent)
  const places: number[] = []
  for (const one of settled) {
    if (one.status === "fulfilled") places.push(one.value.at!)
    else expect(one.reason).toMatchObject({ refusal: { code: "may_have_run" } })
  }
  expect(settled.slice(3).map((one) => one.status)).toEqual([
    "fulfilled",
    "fulfilled",
  ])
  expect(places.every((at) => typeof at === "number")).toBe(true)
  expect(places).toEqual([...places].sort((a, b) => a - b))
  expect(new Set(places).size).toBe(places.length)
  // None was opened twice; each answered was opened.
  const listed = (await client.call("workspaces.list", {})).workspaces
    .flatMap((workspace) => workspace.columns)
    .flatMap((column) => column.panes)
    .map((pane) => pane.id)
  const made = ids.map((id) => seeded(id, "pane"))
  for (const [i, pane] of made.entries()) {
    const times = listed.filter((one) => one === pane).length
    if (settled[i].status === "fulfilled") expect(times).toBe(1)
    else expect(times).toBeLessThanOrEqual(1)
  }
})

test("an address with a latency, as tests give, hears the engine that much later, in order", async () => {
  await serve()
  const far = async () => ({ ...(await address()), latency: 200 })
  client = new Engine(far)
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  const heard: number[] = []
  client.follow(
    machineOf(client),
    0,
    { module: "workspaces" },
    (event) => heard.push(event.seq),
    () => {}
  )
  const sent = performance.now()
  const opened = await client.commandAt("workspaces.open", {
    project: project.id,
    kind: "notes.page",
    args: {},
  })
  expect(performance.now() - sent).toBeGreaterThanOrEqual(200)
  await expect.poll(() => heard).toContain(opened.at)
})

/** A frame the window sent, as far as these tests read it. */
type Sent = { type: string; method?: string; command?: string }

/**
 * The WebSocket the window opens, which notes each frame it sends, on
 * each connection; told to `drop`, it ends its connection itself right
 * after the next command goes, as a link that breaks, so that command's
 * answer is never heard (a socket closing hears nothing more). Told to
 * `cut` a method, it does so after the next call or stream of it.
 */
class Noting extends WebSocket {
  static opened: Noting[] = []
  static drop = false
  static cut: string | undefined
  readonly frames: Sent[] = []
  constructor(url: string | URL) {
    super(url)
    Noting.opened.push(this)
  }
  override send(data: Parameters<WebSocket["send"]>[0]): void {
    super.send(data)
    const frame = JSON.parse(String(data)) as Sent
    this.frames.push(frame)
    if (frame.method !== undefined && frame.method === Noting.cut) {
      Noting.cut = undefined
      this.close()
    }
    if (frame.command === undefined || !Noting.drop) return
    Noting.drop = false
    this.close()
  }
}

/** How often command `id` went, on any connection. */
const sentWith = (id: string) =>
  Noting.opened.flatMap((socket) =>
    socket.frames.filter((frame) => frame.command === id)
  )

/** The window watches its WebSockets. */
function noting() {
  Noting.opened = []
  Noting.drop = false
  Noting.cut = undefined
  vi.stubGlobal("WebSocket", Noting)
}

/** arc out of reach since 5, as the window's hosts say it. */
const arcAway = () => new Unreachable("arc", "arc is away", { as_of: 5 })

/** The names of the Projects the engine lists. */
const names = async (engine: Engine) =>
  (await engine.call("projects.list", {})).map((project) => project.name)

test("with its machine out of reach, a command is refused at once and never sent, a read waits, and nothing refused runs once it is back", async () => {
  noting()
  await serve()
  client = new Engine(address)
  await until(client, "open")
  client.away(arcAway())
  expect(client.status).toEqual({ state: "away" })
  expect(Noting.opened[0]!.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING)
  const id = newId()
  const refused = client.command(
    "projects.create",
    { name: "Refused" },
    undefined,
    id
  )
  await expect(refused).rejects.toBeInstanceOf(Unreachable)
  await expect(refused).rejects.toMatchObject({
    message: "arc is away",
    host: "arc",
    machine: "arc",
    as_of: 5,
    may_have_run: false,
  })
  // A read waits for it, and it tries nothing meanwhile.
  let read: string[] | undefined
  void names(client).then((listed) => (read = listed))
  await new Promise((done) => setTimeout(done, 600))
  expect(read).toBeUndefined()
  expect(Noting.opened).toHaveLength(1)
  // Away still, it says why as it is told from now on.
  client.away(new Unreachable("arc", "Banda is stopped on arc"))
  await expect(
    client.command("projects.create", { name: "No" })
  ).rejects.toThrow("Banda is stopped on arc")
  // Back: the read is answered, and nothing refused went or ran.
  client.wake()
  await until(client, "open")
  await expect.poll(() => read).toBeDefined()
  expect(read).not.toContain("Refused")
  expect(read).not.toContain("No")
  expect(sentWith(id)).toEqual([])
})

test("a command on its way as its machine goes is refused as one that may have run, and is not sent again once it is back", async () => {
  noting()
  await serve()
  // Its answer comes late, as from a machine far away: it is on its way
  // as the machine goes.
  client = new Engine(async () => ({ ...(await address()), latency: 1_000 }))
  await until(client, "open")
  const id = newId()
  const made = client.command(
    "projects.create",
    { name: "On its way" },
    undefined,
    id
  )
  await expect.poll(() => sentWith(id)).toHaveLength(1)
  client.away(arcAway())
  await expect(made).rejects.toMatchObject({
    name: "Unreachable",
    host: "arc",
    may_have_run: true,
  })
  client.wake()
  await until(client, "open")
  // It reached the engine before the machine went, and ran there once.
  expect(await names(client)).toContain("On its way")
  // Its late answer, and the old connection, are heard no more, and it
  // goes no more.
  await new Promise((done) => setTimeout(done, 1_200))
  expect(sentWith(id)).toHaveLength(1)
  expect(client.status.state).toBe("open")
})

test("a command whose connection breaks while its machine is in reach goes again with its ID once the engine is back, and runs once", async () => {
  noting()
  await serve()
  client = new Engine(address)
  await until(client, "open")
  const id = newId()
  Noting.drop = true
  const made = await client.command(
    "projects.create",
    { name: "Again" },
    undefined,
    id
  )
  expect(made.name).toBe("Again")
  // Sent on the first connection, which broke before its answer, and
  // again on the next, with its own ID: the engine ran it once.
  expect(Noting.opened).toHaveLength(2)
  expect(
    Noting.opened.map(
      (socket) => socket.frames.filter((frame) => frame.command === id).length
    )
  ).toEqual([1, 1])
  expect((await names(client)).filter((name) => name === "Again")).toHaveLength(
    1
  )
})

test("a command whose connection breaks before its machine is said to be away fails as one that may have run, and one sent once fails at once in its machine's words; none goes again", async () => {
  noting()
  await serve()
  // The engine of another machine, which names it.
  client = new Engine(address, { unreachable: arcAway })
  await until(client, "open")

  // The link drops right after it went, and only then is arc said to be
  // away: the try after the break, waiting, is refused as the one before
  // may have run.
  const plain = newId()
  Noting.drop = true
  const made = client.command(
    "projects.create",
    { name: "Plain" },
    undefined,
    plain
  )
  await until(client, "lost")
  client.away(arcAway())
  await expect(made).rejects.toMatchObject({
    name: "Unreachable",
    machine: "arc",
    may_have_run: true,
  })
  client.wake()
  await until(client, "open")

  // Sent once, it fails as the link drops, before arc is said to be away,
  // in arc's words; one made before the engine is back is not sent.
  const once = newId()
  Noting.drop = true
  const marked = client.commandAt(
    "projects.create",
    { name: "Once" },
    undefined,
    once,
    { once: true }
  )
  await expect(marked).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    machine: "arc",
    may_have_run: true,
  })
  const unsent = newId()
  await expect(
    client.commandAt("projects.create", { name: "Unsent" }, undefined, unsent, {
      once: true,
    })
  ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })

  // Each that went ran there once at most; none went again.
  await until(client, "open")
  const listed = await names(client)
  for (const went of ["Plain", "Once"])
    expect(listed.filter((name) => name === went).length).toBeLessThanOrEqual(1)
  expect(listed).not.toContain("Unsent")
  await new Promise((done) => setTimeout(done, 500))
  expect(sentWith(plain)).toHaveLength(1)
  expect(sentWith(once)).toHaveLength(1)
  expect(sentWith(unsent)).toEqual([])
})

test("an engine that names no machine fails a command sent once with Lost as its connection breaks", async () => {
  noting()
  await serve()
  client = new Engine(address)
  await until(client, "open")
  Noting.drop = true
  await expect(
    client.commandAt("projects.create", { name: "Here" }, undefined, newId(), {
      once: true,
    })
  ).rejects.toBeInstanceOf(Lost)
})

/** The frames the window sent that ask for `method`, on any connection. */
const asked = (method: string) =>
  Noting.opened.flatMap((socket) =>
    socket.frames.filter((frame) => frame.method === method)
  )

/** How a stream ended, as `onEnd` hears it. */
type End = { code?: string; error?: Error }

/** Hears `git.act`, an act, in `project`; returns how it ended. */
function committing(engine: Engine, project: ProjectId): End[] {
  const ends: End[] = []
  engine.stream(
    project,
    "git.act",
    { action: "commit", message: "Never" },
    () => {},
    (refusal, error) => ends.push({ code: refusal?.code, error })
  )
  return ends
}

test("with its machine away, a call that acts and a stream that acts are refused at once and never sent; reads, and only reads, wait", async () => {
  noting()
  await serve()
  client = new Engine(address, { unreachable: arcAway })
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  client.away(arcAway())

  // A hunk reverted in arc's Diff, a Commit on arc's card.
  const reverting = client.call(
    "git.revert",
    { files: ["a.txt"] },
    { project: project.id }
  )
  await expect(reverting).rejects.toBeInstanceOf(Unreachable)
  await expect(reverting).rejects.toMatchObject({
    message: "arc is away",
    may_have_run: false,
  })
  const commit = committing(client, project.id)
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]!.code).toBe("conflict")
  expect(commit[0]!.error).toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  // A read sent once, as a gesture's reads before its act, is refused as
  // they are.
  await expect(
    client.call("git.status", {}, { project: project.id, once: true })
  ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })

  // A read call and a read stream wait for it.
  let status: unknown
  void client
    .call("git.status", {}, { project: project.id })
    .then((read) => (status = read))
  const watched: unknown[] = []
  client.stream(
    project.id,
    "git.watch",
    {},
    (piece) => watched.push(piece),
    () => {}
  )
  await new Promise((done) => setTimeout(done, 300))
  expect(status).toBeUndefined()
  expect(watched).toEqual([])

  // Back: the reads are answered, and the acts went nowhere.
  client.wake()
  await until(client, "open")
  await expect.poll(() => status).toMatchObject({ repo: false })
  await expect.poll(() => watched).not.toEqual([])
  await new Promise((done) => setTimeout(done, 300))
  expect(asked("git.revert")).toEqual([])
  expect(asked("git.act")).toEqual([])
  expect(commit).toHaveLength(1)
})

test("closed for good, a client refuses a call and a stream that act at once, never sent", async () => {
  noting()
  await serve()
  client = new Engine(address, { unreachable: arcAway })
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  client.close()
  await expect(
    client.call("git.init", {}, { project: project.id })
  ).rejects.toBeInstanceOf(Lost)
  const commit = committing(client, project.id)
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]!.code).toBe("conflict")
  expect(commit[0]!.error).toBeInstanceOf(Lost)
  expect(asked("git.init")).toEqual([])
  expect(asked("git.act")).toEqual([])
})

test("an act asked while its engine is down, its machine in reach, waits and goes once it is back, on this machine's own engine too; one still waiting as its machine goes is refused, never sent", async () => {
  noting()
  await serve()
  client = new Engine(address, { unreachable: arcAway })
  await until(client, "open")
  const work = await client.command("projects.create", { name: "Work" })
  const here = await client.command("projects.create", { name: "Here" })
  const plain = (other = new Engine(address))
  await until(plain, "open")
  await stop()
  await until(client, "lost")
  await until(plain, "lost")

  // A live machine's link coming back, and this machine's engine as it
  // restarts: what is asked meanwhile waits, and goes once it is back.
  const init = client.call("git.init", {}, { project: work.id })
  const status = client.call("git.status", {}, { project: work.id, once: true })
  const commit = committing(client, work.id)
  const initHere = plain.call("git.init", {}, { project: here.id })
  await new Promise((done) => setTimeout(done, 300))
  expect(asked("git.init")).toEqual([])
  await serve()
  await expect(init).resolves.toBeNull()
  await expect(initHere).resolves.toBeNull()
  await expect(status).resolves.toMatchObject({})
  // The engine, not the client, ends the commit: it went once it opened.
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]!.error).toBeUndefined()
  expect(asked("git.init")).toHaveLength(2)
  expect(asked("git.act")).toHaveLength(1)

  // Down again, and arc said to be away before it is back: what waited
  // is refused as not sent, and goes no more.
  await stop()
  await until(client, "lost")
  const waiting = client.call("git.init", {}, { project: work.id })
  const read = client.call("git.status", {}, { project: work.id, once: true })
  const unsent = committing(client, work.id)
  client.away(arcAway())
  for (const refused of [waiting, read])
    await expect(refused).rejects.toMatchObject({
      name: "Unreachable",
      message: "arc is away",
      may_have_run: false,
    })
  await expect.poll(() => unsent).toHaveLength(1)
  expect(unsent[0]).toMatchObject({
    code: "conflict",
    error: { name: "Unreachable", may_have_run: false },
  })
  await serve()
  client.wake()
  await until(client, "open")
  await new Promise((done) => setTimeout(done, 300))
  expect(asked("git.init")).toHaveLength(2)
  expect(asked("git.act")).toHaveLength(1)
  expect(unsent).toHaveLength(1)
})

test("an act asked before the first connection is tried waits for that try, and goes as it opens", async () => {
  noting()
  await serve()
  // A Project made first, by a client of its own, for the acts to name.
  const maker = (other = new Engine(address))
  const project = await maker.command("projects.create", { name: "First" })
  client = new Engine(address, { unreachable: arcAway })
  expect(client.status.state).toBe("connecting")
  const made = client.command("projects.create", { name: "Second" })
  const init = client.call("git.init", {}, { project: project.id })
  const ends: End[] = []
  client.stream(
    project.id,
    "git.act",
    { action: "commit", message: "None to commit" },
    () => {},
    (refusal, error) => ends.push({ code: refusal?.code, error })
  )
  expect(client.status.state).toBe("connecting")
  await expect(made).resolves.toMatchObject({ name: "Second" })
  await expect(init).resolves.toBeNull()
  // It went once it opened: the engine, not the client, ends it.
  await expect.poll(() => ends).toHaveLength(1)
  expect(ends[0]!.error).toBeUndefined()
  expect(asked("git.init")).toHaveLength(1)
  expect(asked("git.act")).toHaveLength(1)
})

test("a call and a stream that act, on their way as their machine goes, end as ones that may have run, and are not asked again", async () => {
  noting()
  await serve()
  // Answers come late, as from a machine far away: each is on its way as
  // the machine goes.
  client = new Engine(async () => ({ ...(await address()), latency: 1_000 }), {
    unreachable: arcAway,
  })
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  const init = client.call("git.init", {}, { project: project.id })
  const commit = committing(client, project.id)
  await expect.poll(() => asked("git.init")).toHaveLength(1)
  await expect.poll(() => asked("git.act")).toHaveLength(1)
  client.away(arcAway())
  await expect(init).rejects.toMatchObject({
    name: "Unreachable",
    host: "arc",
    may_have_run: true,
  })
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]!.code).toBe("may_have_run")
  expect(commit[0]!.error).toMatchObject({
    name: "Unreachable",
    may_have_run: true,
  })

  // It reached the engine before the machine went, and ran there once;
  // nothing went again once it was back.
  client.wake()
  await until(client, "open")
  expect(
    await client.call("git.status", {}, { project: project.id })
  ).toMatchObject({ repo: true })
  await new Promise((done) => setTimeout(done, 1_200))
  expect(asked("git.init")).toHaveLength(1)
  expect(asked("git.act")).toHaveLength(1)
  expect(commit).toHaveLength(1)
  // Each round trip takes a second.
}, 15_000)

test("an act on its way as the link to this machine's own engine breaks fails as one that may have run, with Lost, and is not asked again once it is back", async () => {
  noting()
  await serve()
  client = new Engine(address)
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  // The link breaks as each goes, so its answer is never heard.
  Noting.cut = "git.init"
  const init = client.call("git.init", {}, { project: project.id })
  await expect(init).rejects.toMatchObject({ name: "Lost", may_have_run: true })
  await until(client, "open")
  Noting.cut = "git.act"
  const commit = committing(client, project.id)
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]).toMatchObject({
    code: "may_have_run",
    error: { name: "Lost", may_have_run: true },
  })
  // Each reached the engine, and went no more once it was back.
  await until(client, "open")
  expect(
    await client.call("git.status", {}, { project: project.id })
  ).toMatchObject({ repo: true })
  await new Promise((done) => setTimeout(done, 300))
  expect(asked("git.init")).toHaveLength(1)
  expect(asked("git.act")).toHaveLength(1)
  expect(commit).toHaveLength(1)
})

/**
 * The WebSocket the window opens, noting each frame it sends, which hears
 * nothing while `held`, as a link that looks up and carries nothing, or an
 * engine that hangs: what comes meanwhile it hears once let go.
 */
class Holding extends Noting {
  static held = false
  readonly #kept: unknown[] = []
  constructor(url: string | URL) {
    super(url)
    this.addEventListener("message", (event) => {
      if (!Holding.held) return
      event.stopImmediatePropagation()
      this.#kept.push(event.data)
    })
  }

  /** Each socket hears what came while it was held, in order. */
  static let(): void {
    Holding.held = false
    for (const socket of Noting.opened as Holding[])
      for (const data of socket.#kept.splice(0))
        socket.onmessage?.(new MessageEvent("message", { data }))
  }
}

/** The window watches its WebSockets, and may hold what they hear. */
function holding() {
  noting()
  Holding.held = false
  vi.stubGlobal("WebSocket", Holding)
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

test("an engine that hears nothing after two pings is stale: a command fails at once, one on its way as one that may have run, and a read waits; heard again, it answers, and says how far its clock is", async () => {
  holding()
  await serve()
  const said: boolean[] = []
  client = new Engine(address, {
    unreachable: arcAway,
    ping: { every: 100, quiet: 1_000, within: 300 },
    onStale: (stale) => said.push(stale),
  })
  await until(client, "open")
  expect(client.stale).toBe(false)
  // It pings while open, and hears each pong.
  await expect.poll(() => client!.offset).toBeDefined()
  expect(Math.abs(client.offset!)).toBeLessThan(1_000)
  expect(Date.now() - client.heard!).toBeLessThan(1_000)

  // It hears nothing from now on: a command on its way, and a read.
  Holding.held = true
  const went = newId()
  const made = client.command(
    "projects.create",
    { name: "On its way" },
    undefined,
    went
  )
  let read: string[] | undefined
  void names(client).then((listed) => (read = listed))
  await expect(made).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: true,
  })
  expect(client.stale).toBe(true)
  expect(said).toEqual([true])
  // Its connection is still open, and a command now fails at once, unsent.
  expect(client.status.state).toBe("open")
  const unsent = newId()
  await expect(
    client.command("projects.create", { name: "Unsent" }, undefined, unsent)
  ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })
  expect(sentWith(unsent)).toEqual([])
  expect(read).toBeUndefined()

  // Heard again: it answers, the read is answered on the same connection,
  // and nothing refused went.
  Holding.let()
  expect(client.stale).toBe(false)
  expect(said).toEqual([true, false])
  await expect.poll(() => read).toBeDefined()
  // What was on its way reached the engine, and ran there once.
  const listed = await names(client)
  expect(listed.filter((name) => name === "On its way")).toHaveLength(1)
  expect(listed).not.toContain("Unsent")
  expect(sentWith(went)).toHaveLength(1)
  expect(Noting.opened).toHaveLength(1)
})

test("a command after a quiet while asks the engine first: answered, it goes; with nothing heard in time it fails unsent, and the engine is stale until heard", async () => {
  holding()
  await serve()
  client = new Engine(address, {
    unreachable: arcAway,
    ping: { every: 60_000, quiet: 100, within: 300 },
  })
  await until(client, "open")
  const [socket] = Noting.opened
  await wait(150)
  const asked = await client.command("projects.create", { name: "Asked" })
  expect(asked.name).toBe("Asked")
  expect(socket!.frames.slice(-2).map((frame) => frame.type)).toEqual([
    "ping",
    "call",
  ])
  // Heard a moment ago: the next goes at once.
  await client.command("projects.create", { name: "At once" })
  expect(socket!.frames.at(-2)?.type).toBe("call")

  await wait(150)
  Holding.held = true
  const id = newId()
  const from = performance.now()
  await expect(
    client.command("projects.create", { name: "Not sent" }, undefined, id)
  ).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  const took = performance.now() - from
  expect(took).toBeGreaterThanOrEqual(290)
  expect(took).toBeLessThan(2_000)
  expect(client.stale).toBe(true)
  expect(sentWith(id)).toEqual([])
  // Its answer to the ping, heard late, says it answers.
  Holding.let()
  expect(client.stale).toBe(false)
  expect((await names(client)).includes("Not sent")).toBe(false)
})

test("a stale engine fails a call and a stream that act on their way as ones that may have run, and a read sent once with them as one that did not; refuses each made then at once, unsent, and a read sent once with them; a read waits, and is answered once the engine answers", async () => {
  holding()
  await serve()
  client = new Engine(address, {
    unreachable: arcAway,
    ping: { every: 100, quiet: 1_000, within: 300 },
  })
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })

  // It hears nothing from now on: a call and a stream that act go, and a
  // Commit's read, sent once with its act.
  Holding.held = true
  const init = client.call("git.init", {}, { project: project.id })
  const gesture = expect(
    client.call("git.status", {}, { project: project.id, once: true })
  ).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  const commit = committing(client, project.id)
  await expect.poll(() => asked("git.act")).toHaveLength(1)
  await expect.poll(() => asked("git.status")).toHaveLength(1)
  await expect(init).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: true,
  })
  await gesture
  expect(client.stale).toBe(true)
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]).toMatchObject({
    code: "may_have_run",
    error: { name: "Unreachable", may_have_run: true },
  })

  // Its connection still open, each act now is refused at once, unsent,
  // and a read sent once as part of one; a read goes, and waits.
  expect(client.status.state).toBe("open")
  await expect(
    client.call("git.revert", { files: ["a.txt"] }, { project: project.id })
  ).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  await expect(
    client.call("git.status", {}, { project: project.id, once: true })
  ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })
  const unsent = committing(client, project.id)
  await expect.poll(() => unsent).toHaveLength(1)
  expect(unsent[0]).toMatchObject({
    code: "conflict",
    error: { name: "Unreachable", message: "arc is away", may_have_run: false },
  })
  let status: unknown
  void client
    .call("git.status", {}, { project: project.id })
    .then((read) => (status = read))
  await expect.poll(() => asked("git.status")).toHaveLength(2)
  await wait(300)
  expect(status).toBeUndefined()

  // Heard again: the read is answered on the same connection; what was on
  // its way ran there once, and nothing refused went.
  Holding.let()
  expect(client.stale).toBe(false)
  await expect.poll(() => status).toBeDefined()
  expect(
    await client.call("git.status", {}, { project: project.id })
  ).toMatchObject({ repo: true })
  await wait(300)
  expect(asked("git.init")).toHaveLength(1)
  expect(asked("git.act")).toHaveLength(1)
  expect(asked("git.revert")).toEqual([])
  expect([commit.length, unsent.length]).toEqual([1, 1])
  expect(Noting.opened).toHaveLength(1)
})

test("a call or a stream that acts after a quiet while asks the engine first, and with nothing heard in time fails unsent; a read asks nothing, and waits with no limit", async () => {
  holding()
  await serve()
  client = new Engine(address, {
    unreachable: arcAway,
    ping: { every: 60_000, quiet: 100, within: 300 },
  })
  await until(client, "open")
  const project = await client.command("projects.create", { name: "Work" })
  const pings = () =>
    Noting.opened[0]!.frames.filter((frame) => frame.type === "ping").length

  await wait(150)
  Holding.held = true
  let before = pings()
  let status: unknown
  void client
    .call("git.status", {}, { project: project.id })
    .then((read) => (status = read))
  await expect.poll(() => asked("git.status")).toHaveLength(1)
  await wait(400)
  expect(pings()).toBe(before)
  expect(client.stale).toBe(false)
  expect(status).toBeUndefined()

  const from = performance.now()
  await expect(
    client.call("git.init", {}, { project: project.id })
  ).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  const took = performance.now() - from
  expect(took).toBeGreaterThanOrEqual(290)
  expect(took).toBeLessThan(2_000)
  expect(pings()).toBe(before + 1)
  expect(client.stale).toBe(true)
  expect(asked("git.init")).toEqual([])

  // Heard again, the read is answered; after another quiet while, a
  // stream that acts asks first too.
  Holding.let()
  expect(client.stale).toBe(false)
  await expect.poll(() => status).toBeDefined()
  await wait(150)
  Holding.held = true
  before = pings()
  const commit = committing(client, project.id)
  await wait(150)
  expect(commit).toEqual([])
  expect(pings()).toBe(before + 1)
  await expect.poll(() => commit).toHaveLength(1)
  expect(commit[0]).toMatchObject({
    code: "conflict",
    error: { name: "Unreachable", may_have_run: false },
  })
  expect(client.stale).toBe(true)
  expect(asked("git.act")).toEqual([])
  Holding.let()
  expect(client.stale).toBe(false)
})

/** A server that takes a connection and says nothing on it, as an engine
 * that hangs behind its forward does: the WebSocket is never opened. */
async function hung(): Promise<{
  at: () => Promise<Address>
  end: () => void
}> {
  const taken: Socket[] = []
  const server = createServer((socket) => void taken.push(socket))
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as AddressInfo
  return {
    at: async () => ({ url: `ws://127.0.0.1:${port}/ws`, secret: "unread" }),
    end: () => {
      for (const socket of taken) socket.destroy()
      server.close()
    },
  }
}

test("an engine that never opens its connection is stale as long after: a command waiting fails unsent, at once once stale, and in its time from a quiet start", async () => {
  const silent = await hung()
  try {
    const said: boolean[] = []
    client = new Engine(silent.at, {
      unreachable: arcAway,
      ping: { every: 100, quiet: 1_000, within: 60_000 },
      onStale: (stale) => said.push(stale),
    })
    // Waiting for the connection, a command fails as the engine is stale.
    const waiting = client.command("projects.create", { name: "Waiting" })
    await expect(waiting).rejects.toMatchObject({
      name: "Unreachable",
      message: "arc is away",
      may_have_run: false,
    })
    expect(client.stale).toBe(true)
    expect(client.status.state).toBe("connecting")
    expect(said).toEqual([true])
    await expect(
      client.command("projects.create", { name: "Later" })
    ).rejects.toMatchObject({ may_have_run: false })
    client.close()

    // A command to an engine never heard waits `within` at most.
    client = new Engine(silent.at, {
      unreachable: arcAway,
      ping: { every: 60_000, quiet: 1_000, within: 300 },
    })
    const from = performance.now()
    await expect(
      client.command("projects.create", { name: "Asked" })
    ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })
    const took = performance.now() - from
    expect(took).toBeGreaterThanOrEqual(290)
    expect(took).toBeLessThan(2_000)
    expect(client.stale).toBe(true)
  } finally {
    silent.end()
  }
})

test("waiting for a connection its engine never opens, a call and a stream that act fail unsent as the engine is stale, each asked after at once, and a read waits on", async () => {
  const silent = await hung()
  try {
    client = new Engine(silent.at, {
      unreachable: arcAway,
      ping: { every: 100, quiet: 1_000, within: 60_000 },
    })
    const project = newId()
    const init = client.call("git.init", {}, { project })
    const commit = committing(client, project)
    let read = false
    const done = () => void (read = true)
    void client.call("git.status", {}, { project }).then(done, done)
    await expect(init).rejects.toMatchObject({
      name: "Unreachable",
      message: "arc is away",
      may_have_run: false,
    })
    expect(client.stale).toBe(true)
    await expect.poll(() => commit).toHaveLength(1)
    expect(commit[0]).toMatchObject({
      code: "conflict",
      error: { name: "Unreachable", may_have_run: false },
    })

    // Stale, each act asked now is refused at once, the connection still
    // not open, and a read sent once as part of one.
    await expect(
      client.call("git.init", {}, { project })
    ).rejects.toMatchObject({
      name: "Unreachable",
      message: "arc is away",
      may_have_run: false,
    })
    await expect(
      client.call("git.status", {}, { project, once: true })
    ).rejects.toMatchObject({ name: "Unreachable", may_have_run: false })
    const later = committing(client, project)
    await expect.poll(() => later).toHaveLength(1)
    expect(later[0]).toMatchObject({
      code: "conflict",
      error: {
        name: "Unreachable",
        message: "arc is away",
        may_have_run: false,
      },
    })
    await wait(300)
    expect(read).toBe(false)
    expect(client.status.state).toBe("connecting")
  } finally {
    silent.end()
  }
})

/** The WebSocket of a window to an engine from before the ping: it
 * pings by a frame that engine does not know, as such an engine sees a
 * ping. */
class Older extends Noting {
  override send(data: Parameters<WebSocket["send"]>[0]): void {
    const frame = JSON.parse(String(data)) as { type: string }
    super.send(
      frame.type === "ping"
        ? JSON.stringify({ ...frame, type: "ping_from_later" })
        : data
    )
  }
}

test("an engine from before the ping answers one as a frame that does not fit, and it counts as an answer: never stale", async () => {
  noting()
  vi.stubGlobal("WebSocket", Older)
  await serve()
  client = new Engine(address, {
    unreachable: arcAway,
    ping: { every: 100, quiet: 100, within: 300 },
  })
  await until(client, "open")
  await wait(450)
  expect(client.stale).toBe(false)
  // A command after a quiet while asks first, and its answer lets it go.
  await wait(150)
  const made = await client.command("projects.create", { name: "Old" })
  expect(made.name).toBe("Old")
  // Such an engine says no time.
  expect(client.offset).toBeUndefined()
  expect(
    Noting.opened[0]!.frames.filter((frame) => frame.type === "ping_from_later")
      .length
  ).toBeGreaterThan(1)
})

test("this machine's own engine is never pinged, nor stale", async () => {
  noting()
  await serve()
  client = new Engine(address)
  await until(client, "open")
  await wait(200)
  await client.command("projects.create", { name: "Here" })
  expect(client.stale).toBe(false)
  expect(Noting.opened[0]!.frames.map((frame) => frame.type)).not.toContain(
    "ping"
  )
})
