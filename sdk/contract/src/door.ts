/**
 * The client's side of an engine's door (ADR 0124, decision 3): what both
 * ends sign, as the kernel's `devices.rs` says it, and how a client takes
 * the door's first frames. Keys, nonces and signatures go as base64url
 * with no padding; what is signed is text, one field a line.
 *
 * 1. The door's `challenge` must say the host key this device paired
 *    with, signed by it.
 * 2. The client answers `hello`: the protocols it speaks, its device, a
 *    nonce of its own, and its device key's signature over the door's
 *    nonce, that host key, the page's origin and its own nonce.
 * 3. The door's `welcome` must prove that host key again, over the
 *    client's nonce: a pipe that only repeats an old challenge cannot.
 *
 * A device the machine has not paired asks to be, in place of `hello`
 * (decision 6; `ask`): the door answers a code, which the Person reads on
 * this device and allows on one that is theirs there already.
 */
import type { DeviceFrame } from "./generated/DeviceFrame"
import type { DeviceKind } from "./generated/devices/DeviceKind"
import type { DoorFrame } from "./generated/DoorFrame"
import type { EngineFrame } from "./generated/EngineFrame"
import { PROTOCOL } from "./generated/PROTOCOL"
import type { Refusal } from "./generated/Refusal"
import type { Protocols } from "./generated/Protocols"

/** A paired device's first frame at the door. Its other, `ask`, is how
 * one this machine has not paired asks to be (ADR 0124, decision 6). */
export type Hello = Extract<DeviceFrame, { type: "hello" }>

/**
 * How a client proves who it is at an engine's door (ADR 0124, decisions
 * 3 and 5): the device it is there, the host key it paired with, which
 * the engine must prove, and what signs for the device. The key itself
 * never comes here: the desktop's main holds it and signs for the page, a
 * browser's is one WebCrypto does not hand out.
 */
export type DoorKey = {
  /** The device this client is, as that machine paired it. */
  device: string
  /** That machine's host key, as base64url. Another is refused. */
  hostKey: string
  /** The device key's signature of `message`, as base64url. */
  sign: (message: string) => Promise<string>
}

/** What a device key signs in an `ask`: the door's nonce, the host key
 * it asks, the origin of the page that asks, none as the empty line,
 * then its own key, its kind and its name. */
export const askMessage = (
  doorNonce: string,
  hostKey: string,
  origin: string,
  key: string,
  kind: string,
  name: string
): string =>
  `banda-door/ask/1\n${doorNonce}\n${hostKey}\n${origin}\n${key}\n${kind}\n${name}`

/** What a host key signs in a `paired`: the door's nonce, the key of the
 * device that asked, and the device it is there. */
export const pairedMessage = (
  doorNonce: string,
  key: string,
  device: string
): string => `banda-door/paired/1\n${doorNonce}\n${key}\n${device}`

/** What a host key signs in a `challenge`. */
export const challengeMessage = (
  nonce: string,
  hostKey: string,
  time: number,
  { min, max }: Protocols
): string =>
  `banda-door/challenge/1\n${nonce}\n${hostKey}\n${time}\n${min}\n${max}`

/** What a device key signs in a `hello`: the door's nonce, the host key
 * it answers, the origin of the page that asks, none as the empty line,
 * and the client's own nonce. */
export const helloMessage = (
  doorNonce: string,
  hostKey: string,
  origin: string,
  nonce: string
): string => `banda-door/hello/1\n${doorNonce}\n${hostKey}\n${origin}\n${nonce}`

/** What a host key signs in a `welcome`: the client's nonce, and the
 * device it welcomes. */
export const welcomeMessage = (nonce: string, device: string): string =>
  `banda-door/welcome/1\n${nonce}\n${device}`

/** What a host key signs in a `goodbye`: the `hello` it answers, as the
 * door heard it (its own nonce, the origin, the device, the client's
 * nonce, the protocols and the `hello`'s signature), then why, the code
 * and the words. A `hello` a pipe changed on its way gets a `goodbye`
 * its client does not take for the machine's word. */
export const goodbyeMessage = (
  doorNonce: string,
  origin: string,
  { device, nonce, protocol, sig }: Hello,
  { code, message }: Refusal
): string =>
  [
    "banda-door/goodbye/1",
    doorNonce,
    origin,
    device,
    nonce,
    protocol.min,
    protocol.max,
    sig,
    code,
    message,
  ].join("\n")

const NOT_THE_MACHINE: Refusal = {
  code: "forbidden",
  message:
    "This is not the machine this device paired with: it did not prove its host key.",
}

const NOT_A_DOOR: Refusal = {
  code: "forbidden",
  message: "What answered is not the door of a Banda engine.",
}

/** The bytes of `text`, base64url with or without padding. */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/")
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** `bytes` as base64url with no padding. */
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

/** Whether `sig` is the signature of `message` by the Ed25519 key
 * `publicKey`, each as base64url. */
export async function signed(
  publicKey: string,
  message: string,
  sig: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      bytesOf(publicKey),
      "Ed25519",
      false,
      ["verify"]
    )
    const said = new TextEncoder().encode(message)
    return await crypto.subtle.verify("Ed25519", key, bytesOf(sig), said)
  } catch {
    return false
  }
}

/**
 * What a client does with a frame of the door's, before its session:
 * - `hello`: says it, in answer to the challenge;
 * - `proved`: the frame is the `welcome` that proved the host key, the
 *   session's first;
 * - `refused`: the door is not that machine's, or it said `goodbye`: the
 *   connection ends there, and nothing it says after counts. `signed`
 *   where the host key signed that `goodbye`: the machine's own word, on
 *   which alone a device forgets a key or pairs again;
 * - `lost`: this device could not sign now: the connection ends, to be
 *   tried again;
 * - nothing, for a frame that counts for nothing before the proof.
 */
export type AtDoorSaid =
  | { hello: Hello }
  | { refused: Refusal; signed?: true }
  | "proved"
  | "lost"
  | undefined

/**
 * One connection at a door, until its `welcome` is proved. Nothing that
 * acts goes before that: only the `hello`, and what the client follows and
 * hears, which a pipe that carries the connection sees in any case.
 */
export class AtDoor {
  readonly #key: DoorKey
  /** This connection's `hello`, once it went, with the door's nonce and
   * the origin it was signed for. */
  #said: { doorNonce: string; origin: string; hello: Hello } | undefined
  /** The door's `welcome` proved the host key: what it says from then on
   * is a session's. */
  proved = false
  /** The connection ended here, refused or lost: what comes after counts
   * for nothing. */
  #over = false

  constructor(key: DoorKey) {
    this.#key = key
  }

  /** Takes the door's frame `text`. */
  async take(text: string): Promise<AtDoorSaid> {
    if (this.#over || this.proved) return undefined
    const said = await this.#take(text)
    // A frame that came while another was weighed counts for nothing
    // once that one ended the connection.
    if (this.#over) return undefined
    if (said === "proved") this.proved = true
    else if (said === "lost" || (said && "refused" in said)) this.#over = true
    return said
  }

  async #take(text: string): Promise<AtDoorSaid> {
    let frame: DoorFrame | EngineFrame | null
    try {
      frame = JSON.parse(text)
    } catch {
      return { refused: NOT_A_DOOR }
    }
    if (this.#said === undefined) {
      if (frame?.type !== "challenge") return { refused: NOT_A_DOOR }
      return this.#answer(frame)
    }
    // Why the door lets this device in no more is its own to say, and
    // only its host key's signature makes it the machine's word.
    if (frame?.type === "goodbye") {
      const theirs = await this.farewell(frame)
      return { refused: frame.reason, ...(theirs && { signed: true }) }
    }
    if (frame?.type !== "welcome") return undefined
    const door = frame.door
    const proved =
      door !== undefined &&
      door.host_key === this.#key.hostKey &&
      door.device === this.#key.device &&
      (await signed(
        this.#key.hostKey,
        welcomeMessage(this.#said.hello.nonce, this.#key.device),
        door.sig
      ))
    return proved ? "proved" : { refused: NOT_THE_MACHINE }
  }

  /** Whether the host key this device paired with signed `goodbye` to
   * this connection's `hello`, as this client said it. */
  async farewell(
    goodbye: Extract<EngineFrame, { type: "goodbye" }>
  ): Promise<boolean> {
    const said = this.#said
    return (
      said !== undefined &&
      goodbye.sig !== undefined &&
      (await signed(
        this.#key.hostKey,
        goodbyeMessage(said.doorNonce, said.origin, said.hello, goodbye.reason),
        goodbye.sig
      ))
    )
  }

  async #answer(
    challenge: Extract<DoorFrame, { type: "challenge" }>
  ): Promise<AtDoorSaid> {
    const { nonce, host_key, time, protocol, sig } = challenge
    const theirs =
      host_key === this.#key.hostKey &&
      (await signed(
        host_key,
        challengeMessage(nonce, host_key, time, protocol),
        sig
      ))
    if (!theirs) return { refused: NOT_THE_MACHINE }
    const mine = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const origin = globalThis.location?.origin ?? ""
    let signature: string
    try {
      signature = await this.#key.sign(
        helloMessage(nonce, host_key, origin, mine)
      )
    } catch {
      return "lost"
    }
    const hello: Hello = {
      type: "hello",
      protocol: { min: PROTOCOL, max: PROTOCOL },
      device: this.#key.device,
      nonce: mine,
      sig: signature,
    }
    this.#said = { doorNonce: nonce, origin, hello }
    return { hello }
  }
}

/** A device a machine has not paired, as it asks to be (`ask`). */
export type Asker = {
  /** Its public key: Ed25519, as base64url. */
  key: string
  /** That key's signature of `message`, as base64url. The key itself
   * stays where it is kept. */
  sign: (message: string) => Promise<string>
  /** What the Person reads it by on the machine: "Safari on Roma's Mac". */
  name: string
  kind: DeviceKind
}

/**
 * How a device's asking at a door stands:
 * - `asked`: the door keeps it, under `code`, until `until` by the
 *   machine's clock: the Person compares the code on both screens;
 * - `paired`: the Person allowed it: the `device` it is there, by the
 *   host key that door proved, which it keeps to come in by (`DoorKey`);
 * - `refused`: the door said why not: the Person refused it, its time ran
 *   out, too many ask, or that machine's Banda pairs none at its door;
 * - `lost`: the connection ended with no word: it may ask again.
 */
export type Asking =
  | { state: "asked"; code: string; until: number; hostKey: string }
  | { state: "paired"; device: string; hostKey: string }
  | { state: "refused"; refusal: Refusal }
  | { state: "lost" }

/**
 * Asks the door at `url` to pair this device (ADR 0124, decision 6), and
 * tells `heard` how it stands, last `paired`, `refused` or `lost`. The
 * host key is the one the door's challenge says and proves: a device
 * trusts it on first use, as its route to the door is what it trusts.
 * Returns how to stop asking, which the door hears.
 */
export function ask(
  url: string,
  asker: Asker,
  heard: (asking: Asking) => void
): () => void {
  const socket = new WebSocket(url)
  /** What the challenge said, once it proved its own key. */
  let door: { nonce: string; hostKey: string } | undefined
  let over = false
  const end = (asking: Asking) => {
    if (over) return
    over = true
    heard(asking)
    socket.close()
  }
  const take = async (text: string): Promise<void> => {
    let frame: DoorFrame | EngineFrame
    try {
      frame = JSON.parse(text)
    } catch {
      return end({ state: "refused", refusal: NOT_THE_MACHINE })
    }
    switch (frame.type) {
      case "challenge": {
        const { nonce, host_key, time, protocol, sig } = frame
        const said = challengeMessage(nonce, host_key, time, protocol)
        if (door || !(await signed(host_key, said, sig)))
          return end({ state: "refused", refusal: NOT_THE_MACHINE })
        door = { nonce, hostKey: host_key }
        const origin = globalThis.location?.origin ?? ""
        const { key, kind, name } = asker
        let signature: string
        try {
          signature = await asker.sign(
            askMessage(nonce, host_key, origin, key, kind, name)
          )
        } catch {
          return end({ state: "lost" })
        }
        if (over) return
        const asks: DeviceFrame = {
          type: "ask",
          key,
          name,
          kind,
          sig: signature,
        }
        socket.send(JSON.stringify(asks))
        return
      }
      case "asked":
        if (door && !over)
          heard({
            state: "asked",
            code: frame.code,
            until: frame.until,
            hostKey: door.hostKey,
          })
        return
      case "paired": {
        const proved =
          door !== undefined &&
          (await signed(
            door.hostKey,
            pairedMessage(door.nonce, asker.key, frame.device),
            frame.sig
          ))
        return end(
          proved && door
            ? { state: "paired", device: frame.device, hostKey: door.hostKey }
            : { state: "refused", refusal: NOT_THE_MACHINE }
        )
      }
      case "goodbye":
        return end({ state: "refused", refusal: frame.reason })
      default:
      // Nothing else counts before it is paired.
    }
  }
  // One frame at a time, as weighing one takes a moment.
  let turn = Promise.resolve()
  socket.onmessage = (message) => {
    const text = String(message.data)
    turn = turn.then(() => take(text)).catch(() => end({ state: "lost" }))
  }
  socket.onclose = () => {
    turn = turn.then(() => end({ state: "lost" }))
  }
  return () => {
    over = true
    socket.close()
  }
}
