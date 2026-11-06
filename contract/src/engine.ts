import type { ClientFrame } from "./generated/ClientFrame"
import type { CommandId } from "./generated/CommandId"
import type { EngineFrame } from "./generated/EngineFrame"
import type { Event } from "./generated/Event"
import type { EventFilter } from "./generated/EventFilter"
import type { Refusal } from "./generated/Refusal"
import type { ProjectId } from "./generated/ProjectId"
import type { JsonValue } from "./generated/serde_json/JsonValue"
import { newId } from "./ids"
import type { Answer, CommandCall, MethodOf, Params } from "./methods"

/** The protocol version this client speaks; the engine's `hello` checks it. */
export const PROTOCOL = 1

/** Where the engine listens, and the secret that names its owner. */
export type Address = { url: string; secret: string }

export type Status =
  | { state: "connecting" }
  | {
      state: "open"
      engine: string
      modules: string[]
      /** The ID this machine's modules are followed by, as a Project's
       * (ADR 0025, decision 1); none when no module is the machine's. */
      machine?: ProjectId
      /** This boot of the engine: another once it restarted, which ended
       * every session of the last. */
      boot: string
    }
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

/** What a call, or a stream heard `once`, says when the connection broke
 * before the engine answered. */
const LOST = "The engine went away before it answered."

/** The connection broke before the engine answered. */
export class Lost extends Error {
  constructor() {
    super(LOST)
    this.name = "Lost"
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type Following = {
  project: ProjectId
  last: number
  filter: EventFilter
  onEvent: (event: Event) => void
  onEnd: (refusal?: Refusal) => void
}

type Hearing = {
  project: ProjectId | undefined
  method: string
  params: JsonValue
  onPiece: (piece: unknown) => void
  onEnd: (refusal?: Refusal) => void
  /** Never said again after a reconnect (`stream`'s `once`). */
  once: boolean
  /** The engine was asked for it on this connection. */
  sent: boolean
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
 * - A stream is heard again after a reconnect, from its start; one heard
 *   `once` ends instead.
 */
export class Engine {
  readonly #address: () => Promise<Address>
  #socket: WebSocket | null = null
  #status: Status = { state: "connecting" }
  readonly #watchers = new Set<(status: Status) => void>()
  #nextId = 1
  readonly #pending = new Map<number, Pending>()
  readonly #following = new Map<number, Following>()
  readonly #hearing = new Map<number, Hearing>()
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

  /** Calls a method that is not a command; see {@link command} for one. */
  call<M extends MethodOf<"call">>(
    method: M,
    params: Params<M>,
    options: { project?: ProjectId } = {}
  ): Promise<Answer<M>> {
    return this.#call(method, params, options)
  }

  async #call<T>(
    method: string,
    params: unknown,
    options: { project?: ProjectId; command?: CommandId }
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
      project: options.project,
      command: options.command,
      params: params as JsonValue,
    })
    return answer as Promise<T>
  }

  /**
   * Runs a command once. It carries one ID, and goes again with that ID
   * when the connection breaks, so the engine runs it at most once. An ID
   * chosen earlier, as a Pane's args keep one, keeps it once across
   * windows and reloads.
   */
  async command<M extends MethodOf<"command">>(
    method: M,
    params: Params<M>,
    project?: ProjectId,
    command: CommandId = newId()
  ): Promise<Answer<M>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#call<Answer<M>>(method, params, { project, command })
      } catch (error) {
        if (!(error instanceof Lost) || attempt === ATTEMPTS) throw error
      }
    }
  }

  /** Runs a command made elsewhere, as a Pane's args carry one. */
  run(call: CommandCall, project?: ProjectId): Promise<unknown> {
    // TypeScript cannot tell that a union's method and params belong together.
    return this.command(
      call.method,
      call.params as never,
      project,
      call.command
    )
  }

  /**
   * Follows a Project's events after `after`. `onEnd` hears when the engine
   * ends the subscription: with a refusal, or without one when the Pane
   * should read its view again. Returns how to stop.
   */
  follow(
    project: ProjectId,
    after: number,
    filter: EventFilter,
    onEvent: (event: Event) => void,
    onEnd: (refusal?: Refusal) => void
  ): () => void {
    const id = this.#nextId++
    const following = { project, last: after, filter, onEvent, onEnd }
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

  /**
   * Hears a module's stream, such as a terminal's output: what it says now
   * and keeps nowhere. After a reconnect the engine says it again from its
   * start. `onEnd` hears when the module ends it, or refuses it. Returns how
   * to stop. A stream of this machine's, `window.requests`, has no Project.
   *
   * A stream that does something, as a commit, is heard `once`: asked
   * again it would do it again. When the connection breaks after it was
   * asked, it ends with `may_have_run` instead, and the caller checks.
   */
  stream<M extends MethodOf<"stream">>(
    project: ProjectId | undefined,
    method: M,
    params: Params<M>,
    onPiece: (piece: Answer<M>) => void,
    onEnd: (refusal?: Refusal) => void,
    { once = false }: { once?: boolean } = {}
  ): () => void {
    const id = this.#nextId++
    const hearing: Hearing = {
      project,
      method,
      params: params as JsonValue,
      onPiece: onPiece as (piece: unknown) => void,
      onEnd,
      once,
      sent: false,
    }
    this.#hearing.set(id, hearing)
    if (this.#status.state === "open") this.#hear(id, hearing)
    return () => {
      if (this.#hearing.delete(id) && this.#status.state === "open") {
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
      project: following.project,
      after: following.last,
      filter: following.filter,
    })
  }

  #hear(id: number, hearing: Hearing): void {
    hearing.sent = true
    this.#send({
      type: "stream",
      id,
      project: hearing.project,
      method: hearing.method,
      params: hearing.params,
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
          ...(frame.machine && { machine: frame.machine }),
          boot: frame.boot,
        })
        for (const [id, following] of this.#following) {
          this.#subscribe(id, following)
        }
        for (const [id, hearing] of this.#hearing) this.#hear(id, hearing)
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
        const hearing = this.#hearing.get(frame.id)
        if (hearing && frame.error) {
          this.#hearing.delete(frame.id)
          hearing.onEnd(frame.error)
        }
        break
      }
      case "piece":
        this.#hearing.get(frame.stream)?.onPiece(frame.data)
        break
      case "ended": {
        const hearing = this.#hearing.get(frame.stream)
        if (hearing) {
          this.#hearing.delete(frame.stream)
          hearing.onEnd()
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
    // What is heard once and was asked may have run: it ends, not again.
    for (const [id, hearing] of this.#hearing) {
      if (!hearing.once || !hearing.sent) continue
      this.#hearing.delete(id)
      hearing.onEnd({ code: "may_have_run", message: LOST })
    }
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
