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
 * answer is never heard (a socket closing hears nothing more).
 */
class Noting extends WebSocket {
  static opened: Noting[] = []
  static drop = false
  readonly frames: Sent[] = []
  constructor(url: string | URL) {
    super(url)
    Noting.opened.push(this)
  }
  override send(data: Parameters<WebSocket["send"]>[0]): void {
    super.send(data)
    const frame = JSON.parse(String(data)) as Sent
    this.frames.push(frame)
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
