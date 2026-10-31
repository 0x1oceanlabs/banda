/**
 * The client against the real engine (`target/debug/bandaso`), with the
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
import { decodeFact, type Sent } from "../src/agents"
import {
  type Address,
  Engine,
  type Event,
  Refused,
  type SpaceSummary,
  type Status,
} from "../src/index"

const repository = resolve(import.meta.dirname, "../..")
const binary = (name: string) => join(repository, "target/debug", name)

let dir: string
let engine: ChildProcess | null = null
let client: Engine | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bandaso-contract-"))
  mkdirSync(join(dir, "config"))
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake"\ncommand = ${JSON.stringify(binary("bandaso-fake-agent"))}\n`
  )
})

afterEach(async () => {
  client?.close()
  await stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Starts the engine as a window does, and waits for its first line. */
function serve(): Promise<void> {
  const child = spawn(binary("bandaso"), ["serve", "--with-parent"], {
    env: {
      ...process.env,
      BANDASO_ROOT: join(dir, "root"),
      BANDASO_STATE: join(dir, "state"),
      BANDASO_CONFIG: join(dir, "config"),
      BANDASO_LOG: "warn",
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
  expect(client.status).toMatchObject({ modules: ["agents"] })

  const space = await client.command<SpaceSummary>("spaces.create", {
    name: "Work",
  })
  expect(space.name).toBe("Work")
  const refused = client.call("agents.thread", {}, { space: space.id })
  await expect(refused).rejects.toBeInstanceOf(Refused)
  await expect(refused).rejects.toMatchObject({ refusal: { code: "invalid" } })

  const agent = await client.command<{ id: string }>(
    "agents.create",
    { name: "Writer", harness: "fake" },
    space.id
  )
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
  await client.command<Sent>(
    "agents.send",
    { agent: agent.id, text: "hello" },
    space.id
  )
  await ended
  expect(kinds).toEqual([
    "agent.created",
    "thread.started",
    "message.posted",
    "turn.started",
    "thought.grew",
    "reply.grew",
    "turn.ended",
  ])
})

test("a subscription goes on after the engine restarts, without a gap", async () => {
  await serve()
  client = new Engine(address)
  const space = await client.command<SpaceSummary>("spaces.create", {
    name: "Work",
  })
  const heard: string[] = []
  client.follow(
    space.id,
    0,
    {},
    (event) => heard.push(event.kind),
    () => {}
  )
  await client.command(
    "agents.create",
    { name: "One", harness: "fake" },
    space.id
  )

  await stop()
  await until(client, "lost")
  await serve()
  await until(client, "open")

  await client.command(
    "agents.create",
    { name: "Two", harness: "fake" },
    space.id
  )
  await expect.poll(() => heard).toEqual(["agent.created", "agent.created"])
})
