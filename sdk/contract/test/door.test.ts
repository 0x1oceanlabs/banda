/**
 * The client at an engine's door (ADR 0124, decision 3), without an
 * engine: a scripted socket stands in for the door, with a host key of
 * its own, so a test can make it lie exactly where it wants to.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  base64url,
  challengeMessage,
  helloMessage,
  signed,
  welcomeMessage,
} from "../src/door"
import { type DoorKey, Engine, PROTOCOL, type Status } from "../src/index"

type Frame = { [key: string]: unknown }

/** A WebSocket the test drives: it records what the client sends. */
class Socket {
  static made: Socket[] = []
  sent: Frame[] = []
  closed = false
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
    this.closed = true
    this.onclose?.()
  }
  say(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

type Pair = { publicKey: string; sign: (message: string) => Promise<string> }

/** An Ed25519 key pair: its public half as base64url, and what signs. */
async function pair(): Promise<Pair> {
  const made = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair
  const raw = await crypto.subtle.exportKey("raw", made.publicKey)
  return {
    publicKey: base64url(new Uint8Array(raw)),
    sign: async (message) =>
      base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            made.privateKey,
            new TextEncoder().encode(message)
          )
        )
      ),
  }
}

const DEVICE = "0196f000-0000-7000-8000-0000000000d1"
const PROTOCOLS = { min: PROTOCOL, max: PROTOCOL }
const NONCE = "the-doors-nonce"

/** The door of a machine whose host key is `host`: its challenge, and
 * its welcome to the `hello` the client said. */
function doorOf(host: Pair) {
  return {
    challenge: async (signer = host): Promise<Frame> => ({
      type: "challenge",
      nonce: NONCE,
      host_key: host.publicKey,
      time: 1_794_000_000_000,
      protocol: PROTOCOLS,
      sig: await signer.sign(
        challengeMessage(NONCE, host.publicKey, 1_794_000_000_000, PROTOCOLS)
      ),
    }),
    welcome: async (hello: Frame, signer = host): Promise<Frame> => ({
      type: "welcome",
      protocol: PROTOCOL,
      engine: "test",
      modules: ["agents"],
      door: {
        host_key: host.publicKey,
        device: DEVICE,
        sig: await signer.sign(welcomeMessage(String(hello.nonce), DEVICE)),
      },
    }),
  }
}

let host: Pair
let device: Pair
let key: DoorKey

beforeEach(async () => {
  Socket.made = []
  vi.stubGlobal("WebSocket", Socket)
  host = await pair()
  device = await pair()
  key = { device: DEVICE, hostKey: host.publicKey, sign: device.sign }
})

afterEach(() => vi.unstubAllGlobals())

/** The client of `key`'s device, and the socket it opened. */
async function knocking() {
  const engine = new Engine(async () => ({ url: "ws://door", door: key }))
  const seen: Status[] = []
  engine.watch((status) => seen.push(status))
  await vi.waitFor(() => expect(Socket.made).toHaveLength(1))
  return { engine, socket: Socket.made[0]!, seen }
}

test("a device answers the door's challenge by its key, says what it follows with its hello, and is open once the host proved its own", async () => {
  const { engine, socket, seen } = await knocking()
  const events: unknown[] = []
  engine.follow(
    "project",
    7,
    {},
    (event) => events.push(event),
    () => {}
  )
  // The door speaks first: nothing goes before its challenge.
  socket.onopen?.()
  expect(socket.sent).toEqual([])

  const door = doorOf(host)
  socket.say(await door.challenge())
  await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
  const [hello, subscribe] = socket.sent as [Frame, Frame]
  expect(hello).toMatchObject({
    type: "hello",
    protocol: PROTOCOLS,
    device: DEVICE,
  })
  // Its key signed the door's nonce, that host key, no page's origin
  // here, and a nonce of its own.
  const said = helloMessage(NONCE, host.publicKey, "", String(hello.nonce))
  expect(await signed(device.publicKey, said, String(hello.sig))).toBe(true)
  // What it follows went with the hello, before any welcome.
  expect(subscribe).toMatchObject({ type: "subscribe", after: 7 })
  expect(engine.status.state).toBe("connecting")

  socket.say(await door.welcome(hello))
  await vi.waitFor(() => expect(engine.status.state).toBe("open"))
  socket.say({
    type: "event",
    subscription: subscribe.id,
    event: { seq: 8, kind: "x" },
  })
  await vi.waitFor(() => expect(events).toHaveLength(1))
  expect(seen.map((status) => status.state)).toEqual(["connecting", "open"])
  engine.close()
})

test("a door whose host key is another, or that did not sign its challenge, gets no hello", async () => {
  const other = await pair()
  for (const challenge of [
    // Another machine's door, however well it signs.
    () => doorOf(other).challenge(),
    // This machine's key named, by one who does not hold it.
    () => doorOf(host).challenge(other),
  ]) {
    Socket.made = []
    const { engine, socket } = await knocking()
    socket.say(await challenge())
    await vi.waitFor(() => expect(engine.status.state).toBe("refused"))
    expect(engine.status).toMatchObject({ refusal: { code: "forbidden" } })
    expect(socket.sent).toEqual([])
    expect(socket.closed).toBe(true)
    engine.close()
  }
})

test("a welcome that does not prove the host key over this client's nonce opens nothing, and nothing said before it counts", async () => {
  const { engine, socket } = await knocking()
  const events: unknown[] = []
  engine.follow(
    "project",
    0,
    {},
    (event) => events.push(event),
    () => {}
  )
  const door = doorOf(host)
  socket.say(await door.challenge())
  await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
  const [hello, subscribe] = socket.sent as [Frame, Frame]
  // A pipe that repeats what it heard on another connection: an event,
  // and a welcome signed over another nonce.
  socket.say({
    type: "event",
    subscription: subscribe.id,
    event: { seq: 1, kind: "x" },
  })
  socket.say(await door.welcome({ ...hello, nonce: "another-nonce" }))
  await vi.waitFor(() => expect(engine.status.state).toBe("refused"))
  expect(events).toEqual([])
  expect(socket.closed).toBe(true)
  engine.close()
})

test("a device the machine removed is told so by the door, in the door's words, and nothing said after a goodbye opens a session", async () => {
  const { engine, socket } = await knocking()
  const events: unknown[] = []
  engine.follow(
    "project",
    0,
    {},
    (event) => events.push(event),
    () => {}
  )
  const door = doorOf(host)
  socket.say(await door.challenge())
  await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
  const [, subscribe] = socket.sent as [Frame, Frame]
  const reason = {
    code: "revoked",
    message: "This device was removed from this machine. Pair it again.",
  }
  // A real socket closes a moment after it is asked to: what a pipe
  // says meanwhile, a welcome nobody signed and an event, counts for
  // nothing.
  const close = socket.close.bind(socket)
  socket.close = () => {}
  socket.say({ type: "goodbye", reason })
  socket.say({ type: "welcome", engine: "a pipe", modules: [] })
  socket.say({
    type: "event",
    subscription: subscribe.id,
    event: { seq: 1, kind: "x" },
  })
  await vi.waitFor(() => expect(engine.status.state).toBe("refused"))
  await new Promise((done) => setTimeout(done, 20))
  expect(engine.status).toMatchObject({ refusal: reason })
  expect(events).toEqual([])
  close()
  expect(engine.status.state).toBe("refused")
  engine.close()
})

test("a device that cannot sign now is not refused: the connection is lost, and tried again", async () => {
  key = { ...key, sign: () => Promise.reject(new Error("main is gone")) }
  const { engine, socket } = await knocking()
  socket.say(await doorOf(host).challenge())
  await vi.waitFor(() => expect(engine.status.state).toBe("lost"))
  expect(socket.sent).toEqual([])
  expect(socket.closed).toBe(true)
  engine.close()
})
