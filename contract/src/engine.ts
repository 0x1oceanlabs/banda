import type { ClientFrame } from "./generated/ClientFrame"
import type { CommandId } from "./generated/CommandId"
import type { EngineFrame } from "./generated/EngineFrame"
import type { Event } from "./generated/Event"
import type { EventFilter } from "./generated/EventFilter"
import type { Refusal } from "./generated/Refusal"
import type { SpaceId } from "./generated/SpaceId"
import type { JsonValue } from "./generated/serde_json/JsonValue"
import { newId } from "./ids"

/** The protocol version this client speaks; the engine's `hello` checks it. */
export const PROTOCOL = 1

/** Where the engine listens, and the secret that names its owner. */
export type Address = { url: string; secret: string }

export type Status =
  | { state: "connecting" }
  | { state: "open"; engine: string; modules: string[] }
  /** The connection broke; the client tries again after `retryIn` ms. */
  | { state: "lost"; retryIn: number }
  /** The engine said goodbye, for example to an older window. */
  | { state: "refused"; refusal: Refusal }

/** The engine refused the call. Decide by `refusal.code`; show `message`. */
export class Refused extends Error {
  readonly refusal: Refusal
  constructor(refusal: Refusal) {
    super(refusal.message)
    this.name = "Refused"
    this.refusal = refusal
  }
}

/** The connection broke before the engine answered. */
export class Lost extends Error {
  constructor() {
    super("The engine went away before it answered.")
    this.name = "Lost"
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type Following = {
  space: SpaceId
  last: number
  filter: EventFilter
  onEvent: (event: Event) => void
  onEnd: (refusal?: Refusal) => void
}

/** A command breaks off at most this often before its caller hears why. */
const ATTEMPTS = 3
const FIRST_WAIT = 250
const LONGEST_WAIT = 5000

/**
 * A window's connection to the engine: JSON frames over one WebSocket.
 *
 * - It connects at once, and again whenever the connection breaks, asking
 *   `address` each time: a restarted engine listens elsewhere.
 * - A call made while the engine is away waits for it.
 * - A subscription goes on after a reconnect from the last event it
 *   delivered, so a Pane sees no gap and no repeat.
 */
export class Engine {
  readonly #address: () => Promise<Address>
  #socket: WebSocket | null = null
  #status: Status = { state: "connecting" }
  readonly #watchers = new Set<(status: Status) => void>()
  #nextId = 1
  readonly #pending = new Map<number, Pending>()
  readonly #following = new Map<number, Following>()
  #wait = FIRST_WAIT
  #closed = false

  constructor(address: () => Promise<Address>) {
    this.#address = address
    void this.#connect()
  }

  get status(): Status {
    return this.#status
  }

  /** Hears every change of status, starting with the current one. */
  watch(watcher: (status: Status) => void): () => void {
    this.#watchers.add(watcher)
    watcher(this.#status)
    return () => this.#watchers.delete(watcher)
  }

  /** Calls one method. A command needs `command`; see {@link command}. */
  async call<T>(
    method: string,
    params: JsonValue = {},
    options: { space?: SpaceId; command?: CommandId } = {}
  ): Promise<T> {
    await this.#opened()
    const id = this.#nextId++
    const answer = new Promise<unknown>((resolve, reject) =>
      this.#pending.set(id, { resolve, reject })
    )
    this.#send({
      type: "call",
      id,
      method,
      space: options.space,
      command: options.command,
      params,
    })
    return answer as Promise<T>
  }

  /**
   * Runs a command once. It carries one ID, and goes again with that ID
   * when the connection breaks, so the engine runs it at most once.
   */
  async command<T>(
    method: string,
    params: JsonValue,
    space?: SpaceId
  ): Promise<T> {
    const command = newId()
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.call<T>(method, params, { space, command })
      } catch (error) {
        if (!(error instanceof Lost) || attempt === ATTEMPTS) throw error
      }
    }
  }

  /**
   * Follows a Space's events after `after`. `onEnd` hears when the engine
   * ends the subscription: with a refusal, or without one when the Pane
   * should read its view again. Returns how to stop.
   */
  follow(
    space: SpaceId,
    after: number,
    filter: EventFilter,
    onEvent: (event: Event) => void,
    onEnd: (refusal?: Refusal) => void
  ): () => void {
    const id = this.#nextId++
    const following = { space, last: after, filter, onEvent, onEnd }
    this.#following.set(id, following)
    if (this.#status.state === "open") this.#subscribe(id, following)
    return () => {
      if (this.#following.delete(id) && this.#status.state === "open") {
        this.#send({
          type: "unsubscribe",
          id: this.#nextId++,
          subscription: id,
        })
      }
    }
  }

  /** Closes the connection for good. */
  close(): void {
    this.#closed = true
    this.#socket?.close()
    this.#fail(new Lost())
  }

  #set(status: Status): void {
    this.#status = status
    for (const watcher of this.#watchers) watcher(status)
  }

  #opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      const stop = this.watch((status) => {
        if (status.state === "open") {
          queueMicrotask(() => stop())
          resolve()
        } else if (status.state === "refused") {
          queueMicrotask(() => stop())
          reject(new Refused(status.refusal))
        } else if (this.#closed) {
          queueMicrotask(() => stop())
          reject(new Lost())
        }
      })
    })
  }

  async #connect(): Promise<void> {
    if (this.#closed) return
    this.#set({ state: "connecting" })
    let address: Address
    try {
      address = await this.#address()
    } catch {
      this.#retry()
      return
    }
    const socket = new WebSocket(address.url)
    this.#socket = socket
    socket.onopen = () =>
      this.#send({ type: "hello", protocol: PROTOCOL, token: address.secret })
    socket.onmessage = (message) => this.#receive(String(message.data))
    socket.onclose = () => {
      if (this.#socket === socket) this.#drop()
    }
  }

  #send(frame: ClientFrame): void {
    this.#socket?.send(JSON.stringify(frame))
  }

  #subscribe(id: number, following: Following): void {
    this.#send({
      type: "subscribe",
      id,
      space: following.space,
      after: following.last,
      filter: following.filter,
    })
  }

  #receive(text: string): void {
    let frame: EngineFrame
    try {
      frame = JSON.parse(text)
    } catch {
      return
    }
    switch (frame.type) {
      case "welcome":
        this.#wait = FIRST_WAIT
        this.#set({
          state: "open",
          engine: frame.engine,
          modules: frame.modules,
        })
        for (const [id, following] of this.#following) {
          this.#subscribe(id, following)
        }
        break
      case "goodbye":
        this.#set({ state: "refused", refusal: frame.reason })
        this.#socket?.close()
        break
      case "result": {
        const pending = this.#pending.get(frame.id)
        if (pending) {
          this.#pending.delete(frame.id)
          if (frame.error) pending.reject(new Refused(frame.error))
          else pending.resolve(frame.ok ?? null)
          break
        }
        const following = this.#following.get(frame.id)
        if (following && frame.error) {
          this.#following.delete(frame.id)
          following.onEnd(frame.error)
        }
        break
      }
      case "event": {
        const following = this.#following.get(frame.subscription)
        if (following && frame.event.seq > following.last) {
          following.last = frame.event.seq
          following.onEvent(frame.event)
        }
        break
      }
      case "resync": {
        const following = this.#following.get(frame.subscription)
        if (following) {
          this.#following.delete(frame.subscription)
          following.onEnd()
        }
        break
      }
      default:
      // A newer engine's frame: this window does not know it.
    }
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  #drop(): void {
    this.#socket = null
    this.#fail(new Lost())
    if (!this.#closed && this.#status.state !== "refused") this.#retry()
  }

  #retry(): void {
    if (this.#closed) return
    const wait = this.#wait
    this.#wait = Math.min(wait * 2, LONGEST_WAIT)
    this.#set({ state: "lost", retryIn: wait })
    setTimeout(() => void this.#connect(), wait)
  }
}
