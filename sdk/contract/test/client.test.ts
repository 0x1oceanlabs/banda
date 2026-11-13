/**
 * The client's promises without an engine: a scripted socket stands in,
 * so a test can break the connection exactly where it wants to.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Engine, Lost, outcome, PROTOCOL, Refused } from "../src/index"

type Frame = { [key: string]: unknown }

/** A WebSocket the test drives: it records what the client sends. */
class Socket {
  static made: Socket[] = []
  sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    Socket.made.push(this)
  }
  send(text: string) {
    this.sent.push(JSON.parse(text))
  }
  close() {
    this.onclose?.()
  }
  /** The engine's side: answer the hello. */
  welcome() {
    this.onopen?.()
    this.say({ type: "welcome", engine: "test", modules: ["agents"] })
  }
  say(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

const address = async () => ({ url: "ws://engine", secret: "s" })

beforeEach(() => {
  Socket.made = []
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = () => vi.advanceTimersByTimeAsync(0)

test("what the client follows and hears goes with its hello, before the engine's welcome, and what joins after goes at once", async () => {
  const engine = new Engine(address)
  engine.follow(
    "project",
    3,
    {},
    () => {},
    () => {}
  )
  await flush()
  const socket = Socket.made[0]
  socket.onopen?.()
  // One round trip less: nothing waits for the welcome.
  expect(socket.sent.map((frame) => frame.type)).toEqual(["hello", "subscribe"])
  expect(socket.sent[1]).toMatchObject({ project: "project", after: 3 })
  const stop = engine.follow(
    "project",
    0,
    {},
    () => {},
    () => {}
  )
  expect(socket.sent.map((frame) => frame.type)).toEqual([
    "hello",
    "subscribe",
    "subscribe",
  ])
  stop()
  expect(socket.sent.at(-1)).toMatchObject({ type: "unsubscribe" })
  socket.say({ type: "welcome", engine: "test", modules: ["agents"] })
  expect(engine.status.state).toBe("open")
  // Nothing is said twice once the welcome comes.
  expect(socket.sent).toHaveLength(4)
  engine.close()
})

test("a command that broke off goes again with the same command ID", async () => {
  const engine = new Engine(address)
  await flush()
  const first = Socket.made[0]
  first.welcome()
  expect(first.sent[0]).toEqual({
    type: "hello",
    protocol: PROTOCOL,
    token: "s",
  })

  const answer = engine.command("agents.send", { text: "hi" }, "project")
  await flush()
  const call = first.sent[1]
  expect(call).toMatchObject({ type: "call", method: "agents.send" })
  first.close()

  await vi.advanceTimersByTimeAsync(250)
  const second = Socket.made[1]
  second.welcome()
  await flush()
  const again = second.sent[1]
  expect(again).toMatchObject({ type: "call", method: "agents.send" })
  expect(again.command).toBe(call.command)
  second.say({ type: "result", id: again.id, ok: { done: true } })
  await expect(answer).resolves.toEqual({ done: true })
  engine.close()
})

test("a command gives up after three tries, and says the engine is away", async () => {
  const engine = new Engine(address)
  const answer = engine.command("agents.send", { text: "hi" }, "project")
  answer.catch(() => {})
  for (let attempt = 0; attempt < 3; attempt++) {
    await vi.advanceTimersByTimeAsync(5_000)
    const socket = Socket.made.at(-1)!
    socket.welcome()
    await flush()
    socket.close()
  }
  await expect(answer).rejects.toBeInstanceOf(Lost)
  engine.close()
})

test("a command sent once fails as the connection breaks and is not sent again, while a plain one is", async () => {
  const engine = new Engine(address)
  await flush()
  const first = Socket.made[0]
  first.welcome()
  const once = engine.commandAt(
    "agents.read",
    { thread: "t1" },
    "project",
    undefined,
    { once: true }
  )
  const plain = engine.commandAt("agents.send", { text: "hi" }, "project")
  // How the break leaves it, without an unheard rejection.
  let ended: unknown = "waiting"
  void once.then(
    () => (ended = "answered"),
    (error: unknown) => (ended = error)
  )
  await flush()
  const [read, send] = first.sent.slice(1)
  expect(read).toMatchObject({ type: "call", method: "agents.read" })
  expect(send).toMatchObject({ type: "call", method: "agents.send" })
  first.close()
  await flush()
  // It fails as the connection breaks, not once the engine is back.
  expect(ended).toBeInstanceOf(Lost)
  // One made while the engine is away fails at once: it goes now or not.
  await expect(
    engine.commandAt("agents.unread", { thread: "t1" }, "project", undefined, {
      once: true,
    })
  ).rejects.toBeInstanceOf(Lost)

  await vi.advanceTimersByTimeAsync(250)
  const second = Socket.made[1]
  second.welcome()
  await flush()
  // The plain one goes again, with its own command ID; neither sent
  // once does.
  const again = second.sent.slice(1)
  expect(again).toEqual([
    expect.objectContaining({ method: "agents.send", command: send.command }),
  ])
  second.say({ type: "result", id: again[0].id, ok: { thread: "t2" }, at: 3 })
  await expect(plain).resolves.toEqual({ answer: { thread: "t2" }, at: 3 })
  engine.close()
})

test("a read says when it was so: by the engine's as_of, or as it came from an engine that says none", async () => {
  const engine = new Engine(address)
  await flush()
  const socket = Socket.made[0]
  socket.welcome()
  const said = engine.read("projects.list", {})
  const older = engine.read("projects.list", {})
  await flush()
  const [first, second] = socket.sent.slice(1)
  socket.say({ type: "result", id: first.id, ok: [], as_of: { at: 1_000 } })
  socket.say({ type: "result", id: second.id, ok: [] })
  await expect(said).resolves.toEqual({ value: [], as_of: 1_000 })
  await expect(older).resolves.toEqual({ value: [], as_of: Date.now() })
  // A call that acts is no read: its outcome is what it says.
  // @ts-expect-error terminal.open acts
  void (() => engine.read("terminal.open", {} as never))
  engine.close()
})

test("an act comes to done, refused, or may have run, and never throws one of them", async () => {
  const engine = new Engine(address)
  await flush()
  const socket = Socket.made[0]
  socket.welcome()
  const send = (text: string) =>
    outcome(engine.command("agents.send", { text }, "project"))
  const [done, refused, went] = [send("a"), send("b"), send("c")]
  const once = outcome(
    engine.commandAt("agents.read", { thread: "t1" }, "project", undefined, {
      once: true,
    })
  )
  await flush()
  const [a, b, c] = socket.sent.slice(1)
  socket.say({ type: "result", id: a.id, ok: { thread: "t" } })
  const no = { code: "conflict", message: "Not now." }
  socket.say({ type: "result", id: b.id, error: no })
  const cut = { code: "may_have_run", message: "Cut short." }
  socket.say({ type: "result", id: c.id, error: cut })
  await expect(done).resolves.toEqual({
    outcome: "done",
    value: { thread: "t" },
  })
  const refusal = await refused
  expect(refusal).toMatchObject({ outcome: "refused", error: { refusal: no } })
  expect(refusal.outcome !== "done" && refusal.error).toBeInstanceOf(Refused)
  await expect(went).resolves.toMatchObject({ outcome: "may_have_run" })
  // One on its way as the connection broke may have run too.
  socket.close()
  const lost = await once
  expect(lost.outcome).toBe("may_have_run")
  expect(lost.outcome !== "done" && lost.error).toBeInstanceOf(Lost)
  // An error no engine gave is no outcome: it is thrown.
  await expect(outcome(Promise.reject(new TypeError("a bug")))).rejects.toThrow(
    "a bug"
  )
  engine.close()
})

test("a subscription follows on after a reconnect from the last event it heard", async () => {
  const engine = new Engine(address)
  await flush()
  Socket.made[0].welcome()
  const heard: number[] = []
  engine.follow(
    "project",
    4,
    {},
    (event) => heard.push(event.seq),
    () => {}
  )
  const subscribe = Socket.made[0].sent[1]
  expect(subscribe).toMatchObject({ type: "subscribe", after: 4 })
  for (const seq of [5, 6, 6]) {
    Socket.made[0].say({
      type: "event",
      subscription: subscribe.id,
      event: { seq },
    })
  }
  Socket.made[0].close()

  await vi.advanceTimersByTimeAsync(250)
  Socket.made[1].welcome()
  expect(Socket.made[1].sent[1]).toMatchObject({
    type: "subscribe",
    id: subscribe.id,
    after: 6,
  })
  Socket.made[1].say({
    type: "event",
    subscription: subscribe.id,
    event: { seq: 7 },
  })
  expect(heard).toEqual([5, 6, 7])
  engine.close()
})

test("the status says whether the engine's fence holds, as its welcome does", async () => {
  const engine = new Engine(address)
  await flush()
  const socket = Socket.made[0]
  socket.onopen?.()
  const fence = { fence: "holds", layers: ["namespaces", "landlock"] }
  socket.say({ type: "welcome", engine: "test", modules: [], boot: "b", fence })
  expect(engine.status).toMatchObject({ state: "open", fence })
  engine.close()

  const older = new Engine(address)
  await flush()
  Socket.made[1].welcome()
  expect(older.status.state).toBe("open")
  expect(older.status).not.toHaveProperty("fence")
  older.close()
})

test("the status names the machine, as its welcome does", async () => {
  const engine = new Engine(address)
  await flush()
  const socket = Socket.made[0]
  socket.onopen?.()
  const named = { name: "arc", icon: "server" }
  socket.say({ type: "welcome", engine: "test", modules: [], boot: "b", named })
  expect(engine.status).toMatchObject({ state: "open", named })
  engine.close()

  const older = new Engine(address)
  await flush()
  Socket.made[1].welcome()
  expect(older.status).not.toHaveProperty("named")
  older.close()
})
