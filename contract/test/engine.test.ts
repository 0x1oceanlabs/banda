/**
 * The client against the real engine (`target/debug/banda`), with the
 * fake agent as the Harness. Run `cargo build` first; `scripts/check.sh` does.
 */
import { type ChildProcess, spawn } from "node:child_process"
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
import {
  type Address,
  Engine,
  newId,
  type Event,
  Refused,
  type Status,
} from "../src/index"

const repository = resolve(import.meta.dirname, "../..")
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
  expect(client.status).toMatchObject({ modules: ["agents", "terminal"] })

  const space = await client.command("spaces.create", {
    name: "Work",
  })
  expect(space.name).toBe("Work")
  // Params the engine does not take, as the CLI may send.
  const refused = client.call("agents.thread", {} as never, {
    space: space.id,
  })
  await expect(refused).rejects.toBeInstanceOf(Refused)
  await expect(refused).rejects.toMatchObject({ refusal: { code: "invalid" } })

  const kinds: string[] = []
  const ended = new Promise<void>((done) =>
    client!.follow(
      space.id,
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
    space.id
  )
  await ended
  expect(kinds).toEqual([
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
  const space = await client.command("spaces.create", {
    name: "Work",
  })
  const heard: string[] = []
  client.follow(
    space.id,
    0,
    { module: "agents", kinds: ["thread.started"] },
    (event) => heard.push(event.kind),
    () => {}
  )
  await client.command(
    "agents.send",
    { harness: "fake", text: "one" },
    space.id
  )

  await stop()
  await until(client, "lost")
  await serve()
  await until(client, "open")

  await client.command(
    "agents.send",
    { harness: "fake", text: "two" },
    space.id
  )
  await expect.poll(() => heard).toEqual(["thread.started", "thread.started"])
})

test("a window runs a terminal and hears what it prints, until it closes", async () => {
  await serve()
  client = new Engine(address)
  const space = await client.command("spaces.create", {
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
    { space: space.id }
  )
  let screen = ""
  let closed = false
  client.stream(
    space.id,
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
    { space: space.id }
  )
  await expect.poll(() => screen).toContain("got hi")
  await client.call("terminal.close", { terminal }, { space: space.id })
  await expect.poll(() => closed).toBe(true)
})
