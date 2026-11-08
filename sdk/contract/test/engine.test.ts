/**
 * The client against the real engine (`target/debug/banda`), with the
 * fake agent as the Harness. Run `cargo build` first; `scripts/check.sh` does.
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
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { afterEach, beforeEach, expect, test } from "vitest"
import { decodeFact } from "../src/agents"
import { seeded } from "../src/workspaces"
import {
  type Address,
  Engine,
  newId,
  type Event,
  type ProjectId,
  Refused,
  type Status,
} from "../src/index"

const repository = resolve(import.meta.dirname, "../../..")
const binary = (name: string) => join(repository, "target/debug", name)

let dir: string
let engine: ChildProcess | null = null
let client: Engine | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banda-contract-"))
  mkdirSync(join(dir, "config"))
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake"\ncommand = ${JSON.stringify(binary("banda-fake-agent"))}\n`
  )
})

afterEach(async () => {
  client?.close()
  await stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Starts the engine as a window does, and waits for its first line. */
function serve(): Promise<void> {
  const child = spawn(binary("banda"), ["serve", "--with-parent"], {
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
  return execFileSync(binary("banda"), ["modules"], { encoding: "utf8" })
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
  // The module says where its event stands, and so does the engine.
  expect(opened.at).toEqual(expect.any(Number))
  expect(opened.answer.at).toBe(opened.at)
  await expect.poll(() => heard).toContain(opened.at)
  // Sent again, the same answer at the same place.
  const again = await client.commandAt("workspaces.open", notes, undefined, id)
  expect(again).toEqual(opened)
  // Shown already, it writes nothing: the module says none, and so does
  // the engine, so a client waits to hear nothing (#880), sent again too.
  const once = newId()
  const shown = await client.commandAt(
    "workspaces.open",
    notes,
    undefined,
    once
  )
  expect(shown.answer).toMatchObject({ pane: opened.answer.pane, at: null })
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
