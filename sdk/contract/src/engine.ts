import type { ClientFrame } from "./generated/ClientFrame"
import type { CommandId } from "./generated/CommandId"
import { DOES, type Does } from "./generated/does"
import type { EngineFrame } from "./generated/EngineFrame"
import type { Event } from "./generated/Event"
import type { EventFilter } from "./generated/EventFilter"
import type { Fence } from "./generated/Fence"
import type { Named } from "./generated/Named"
import type { Refusal } from "./generated/Refusal"
import type { ProjectId } from "./generated/ProjectId"
import type { JsonValue } from "./generated/serde_json/JsonValue"
import { newId } from "./ids"
import type { Answer, CommandCall, MethodOf, Params } from "./methods"

/** The protocol version this client speaks; the engine's `hello` checks it. */
export const PROTOCOL = 1

/** Where the engine listens, and the secret that names its owner. */
export type Address = {
  url: string
  secret: string
  /**
   * For tests only: how many ms later than it comes the client hears
   * what the engine says, its answers, events and stream pieces, in
   * order, as from a host far away. The desktop gives one only in a
   * development build, as `BANDA_TEST_LATENCY` says (ADR 0088, decision
   * 11).
   */
  latency?: number
}

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
      /** Whether the fence around its Harnesses' programs holds (ADR 0083,
       * decision 1): what a new Thread's mode follows. None from an engine
       * that has none. */
      fence?: Fence
      /** What this machine is called and drawn by, as every window shows
       * it (ADR 0095); the stream `MACHINE_NAMED` says it again as it
       * changes. None from an engine that names it nothing. The page
       * cleans it before it draws it (ADR 0095, decision 2). */
      named?: Named
    }
  /** The connection broke; the client tries again after `retryIn` ms. */
  | { state: "lost"; retryIn: number }
  /** The machine the engine is on is out of reach (`Engine.away`): an
   * act fails at once, and the client tries nothing until it is woken
   * (`Engine.wake`). */
  | { state: "away" }
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

/** What a call, a command sent `once` or a stream heard `once` says when
 * the connection broke before the engine answered. */
const LOST = "The engine went away before it answered."

/** The connection broke before the engine answered, or the client was
 * closed. */
export class Lost extends Error {
  /** Whether it may have run all the same: an act on its way as the
   * connection broke. Else it was not sent, or it only read. */
  readonly may_have_run: boolean
  constructor({ may_have_run = false }: { may_have_run?: boolean } = {}) {
    super(LOST)
    this.name = "Lost"
    this.may_have_run = may_have_run
  }
}

/**
 * Whether `method` acts, as the contract says of each of its methods (ADR
 * 0106, law 4): an act goes at most once, and fails at once while its
 * machine is away; a read may wait for the connection and go again. A
 * stream the contract does not list, the kernel's own `machine.named` and
 * `machine.power`, reads: it is the machine's, heard again on each
 * connection.
 */
function acts(method: string): boolean {
  return (DOES as Readonly<Record<string, Does>>)[method] === "act"
}

/**
 * An act refused at once, or given up on its way, as the machine its
 * engine is on is out of reach (ADR 0082, decision 16; ADR 0106, law 4):
 * nothing waits for that machine to send it later. Its message says why,
 * as the machine's pill does: "arc is away".
 */
export class Unreachable extends Error {
  /** The machine, as the client knows it: its key in `hosts.toml`, a
   * Pane's `args.host`. */
  readonly host: string
  /** Its name, as the client shows it. */
  readonly machine: string
  /** Since when it is out of reach, in ms since the epoch, where known. */
  readonly as_of?: number
  /** Whether it may have run there all the same: it was on its way as
   * the machine went. Else it was not sent. */
  readonly may_have_run: boolean
  constructor(
    host: string,
    words: string,
    {
      machine = host,
      as_of,
      may_have_run = false,
    }: { machine?: string; as_of?: number; may_have_run?: boolean } = {}
  ) {
    super(words)
    this.name = "Unreachable"
    this.host = host
    this.machine = machine
    if (as_of !== undefined) this.as_of = as_of
    this.may_have_run = may_have_run
  }

  /** The same, for an act that was on its way. */
  sent(): Unreachable {
    const { host, message, machine, as_of } = this
    return new Unreachable(host, message, {
      machine,
      as_of,
      may_have_run: true,
    })
  }
}

/** The engine's answer to one call, whole: its `ok`, and a command's `at`. */
type Result = Extract<EngineFrame, { type: "result" }>

type Pending = {
  resolve: (result: Result) => void
  reject: (error: Error) => void
  /** A command's, which may have run once it went. */
  command: boolean
  /** A call that acts, which may have run once it went. */
  act: boolean
  /** A call that fails as the connection breaks in its machine's words:
   * one that acts, or a read sent `once` as part of an act. */
  once: boolean
}

/** How an ask waits for the engine to be open (`#opened`): a read waits,
 * while its machine is away too; an act, or a read asked as part of one,
 * waits while its machine is in reach and fails at once while it is away;
 * a command sent `once` goes now or fails. */
type Going = "read" | "act" | "now"

/**
 * A command's answer, and its place in the log of its scope (ADR 0082,
 * decision 4): the seq of the last fact it wrote, the same as the
 * `Event.seq` a client follows there. A view current at `at` shows what
 * the command did. `null` when it wrote no fact, as when it changed
 * nothing: there is nothing to wait to hear, and a read sent after the
 * answer shows what it did (#880). The fact at `at` is the command's
 * module's own, and a follow whose filter leaves out its kind or its
 * subject does not hear it.
 */
export type Answered<M extends MethodOf<"command">> = {
  answer: Answer<M>
  at: number | null
}

/**
 * How a command goes, beside what it says (`Engine.commandAt`). Each is
 * left out by default, and a caller names only what it needs.
 */
export type CommandOptions = {
  /**
   * Sent now, once at most: while the engine is not open it fails at
   * once, and when the connection breaks after it went, it fails then
   * and is not sent again once the engine is back. It fails with `Lost`,
   * or with `Unreachable` for an engine on another machine: while that
   * machine is away, or where the engine names it (`unreachable`), with
   * `may_have_run` once it went. For what must not land later than its caller said it failed,
   * as a Person's mark (ADR 0096, decision 8). One that reached the
   * engine before the break may still run, even after commands sent once
   * the engine is back, so it keeps no place in their order (ADR 0082,
   * decision 4): its fact then says so.
   */
  once?: boolean
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
  onEnd: (refusal?: Refusal, error?: Error) => void
  /** Never said again after a reconnect: a stream that acts, or one heard
   * `once`. */
  once: boolean
  /** The engine was asked for it on this connection. */
  sent: boolean
}

/** A command breaks off at most this often before its caller hears why;
 * one sent `once`, at the first break. */
const ATTEMPTS = 3
const FIRST_WAIT = 250
const LONGEST_WAIT = 5000

/**
 * A window's connection to the engine: JSON frames over one WebSocket.
 *
 * - It connects at once, and again whenever the connection breaks, asking
 *   `address` each time: a restarted engine listens elsewhere. Each try
 *   waits longer than the last, up to 5 s; `wake` tries at once.
 * - A read made while the connection is down waits for it, while its
 *   machine is away too.
 * - An act is a command, or a call or a stream the contract says acts
 *   (`acts`; ADR 0106, law 4). While its machine is out of reach (`away`,
 *   ADR 0082, decision 16) it fails at once, in that machine's words
 *   (`Unreachable`), and is never sent later by itself. While its machine
 *   is in reach and the connection is only down, as a window starts or a
 *   live machine's link comes back, it waits for the connection and goes
 *   then, as a read does: it would go then had it been asked a moment
 *   later. This machine's own engine is never away from it, so an act
 *   asked as that engine restarts waits for it.
 * - An act on its way as the connection breaks fails then, as one that
 *   may have run, and is never asked again; a stream that acts ends with
 *   `may_have_run`. A command alone goes again with its ID, which keeps it
 *   from running twice, once the engine is back, while its machine is in
 *   reach; one sent `once` does not.
 * - A command sent `once` fails at once while the connection is down,
 *   and as it breaks; on another machine, in that machine's words.
 * - A subscription goes on after a reconnect from the last event it
 *   delivered, so a Pane sees no gap and no repeat.
 * - A stream that reads is heard again after a reconnect, from its start;
 *   one that acts, or is heard `once`, ends instead.
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
  /** The next try, while the connection is lost. */
  #next: ReturnType<typeof setTimeout> | undefined
  #closed = false
  /** Why the machine is out of reach, while the status is `away`. */
  #why: Unreachable | undefined
  /** Each connect's number: one that `away` or a later one overtook
   * connects nothing. */
  #go = 0
  readonly #unreachable: (() => Unreachable) | undefined

  /**
   * `address` says where the engine listens now. It may throw
   * `Unreachable` while the engine's machine is out of reach: the engine
   * is then `away` until woken. `unreachable` names the machine of an
   * engine on another one: an act, or a read sent `once`, that the
   * connection lost fails with it, not `Lost`, as that machine may be gone
   * before the client is told so.
   */
  constructor(
    address: () => Promise<Address>,
    { unreachable }: { unreachable?: () => Unreachable } = {}
  ) {
    this.#address = address
    this.#unreachable = unreachable
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

  /**
   * Calls a method that is not a command; see {@link command} for one. A
   * call that acts fails at once while its machine is away, and as one
   * that may have run where the connection breaks on its way (`Engine`).
   * One that reads waits for the connection, unless it is sent `once`, as
   * part of an act, as a gesture's reads before its act are (ADR 0106, law
   * 4): then it fails as that act would, at once while its machine is away
   * and as the connection breaks, as not done, so the gesture is refused
   * whole and never completes later by itself.
   */
  call<M extends MethodOf<"call">>(
    method: M,
    params: Params<M>,
    options: { project?: ProjectId; once?: boolean } = {}
  ): Promise<Answer<M>> {
    return this.#call(method, params, options)
  }

  async #call<T>(
    method: string,
    params: unknown,
    options: { project?: ProjectId; once?: boolean }
  ): Promise<T> {
    const result = await this.#ask(method, params, options)
    return (result.ok ?? null) as T
  }

  /** Calls `method`, and gives the engine's answer whole. A command's
   * `sent` hears that it went. */
  async #ask(
    method: string,
    params: unknown,
    options: {
      project?: ProjectId
      command?: CommandId
      once?: boolean
      sent?: () => void
    }
  ): Promise<Result> {
    const command = options.command !== undefined
    const once = options.once ?? false
    const act = !command && acts(method)
    await this.#opened(
      command ? (once ? "now" : "act") : act || once ? "act" : "read"
    )
    const id = this.#nextId++
    const answer = new Promise<Result>((resolve, reject) =>
      this.#pending.set(id, {
        resolve,
        reject,
        command,
        act,
        once: act || once,
      })
    )
    this.#send({
      type: "call",
      id,
      method,
      project: options.project,
      command: options.command,
      params: params as JsonValue,
    })
    options.sent?.()
    return answer
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
    const { answer } = await this.commandAt(method, params, project, command)
    return answer
  }

  /**
   * Runs a command as {@link command} does, and gives its answer with its
   * place in the log, `at`: a client that has heard its scope's log up to
   * `at` has heard what the command did, and a command answered with none
   * wrote nothing there to hear (ADR 0082, decision 4). A session's
   * commands to one scope commit in the order sent, and one sent again
   * after the connection broke goes in that order too, before any sent
   * since, so the `at`s of those that have one rise in the order sent.
   * One sent `once` is not sent again, so it keeps no place in that
   * order: one that reached the engine before the break may run after
   * those sent since.
   *
   * It goes again only while its machine is in reach: once that machine
   * is out of reach (`away`) it fails with `Unreachable` and goes no
   * more, with `may_have_run` once it went.
   */
  async commandAt<M extends MethodOf<"command">>(
    method: M,
    params: Params<M>,
    project?: ProjectId,
    command: CommandId = newId(),
    { once = false }: CommandOptions = {}
  ): Promise<Answered<M>> {
    let went = false
    const sent = () => void (went = true)
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.#ask(method, params, {
          project,
          command,
          once,
          sent,
        })
        return {
          answer: (result.ok ?? null) as Answer<M>,
          at: result.at ?? null,
        }
      } catch (error) {
        // Refused as the try after a break waited: the one before went.
        if (error instanceof Unreachable && went && !error.may_have_run)
          throw error.sent()
        if (!(error instanceof Lost)) throw error
        if (once) throw this.#gone(went)
        if (attempt === ATTEMPTS) throw error
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
   * A stream that does something, as a commit, is heard `once`, whether it
   * is asked so or the contract says it acts: asked again it would do it
   * again. Asked while its machine is out of reach, it is not sent and ends
   * at once, refused, as it does when that machine goes before it was
   * sent; when the connection breaks after it was asked, it ends with
   * `may_have_run`, and the caller checks. Either way `onEnd` hears the
   * client's error too, in its machine's words (`Unreachable`), or `Lost`,
   * for the caller to say what was not done.
   */
  stream<M extends MethodOf<"stream">>(
    project: ProjectId | undefined,
    method: M,
    params: Params<M>,
    onPiece: (piece: Answer<M>) => void,
    onEnd: (refusal?: Refusal, error?: Error) => void,
    { once = false }: { once?: boolean } = {}
  ): () => void {
    const id = this.#nextId++
    const hearing: Hearing = {
      project,
      method,
      params: params as JsonValue,
      onPiece: onPiece as (piece: unknown) => void,
      onEnd,
      once: once || acts(method),
      sent: false,
    }
    const { state } = this.#status
    if (
      hearing.once &&
      (state === "away" || state === "refused" || this.#closed)
    ) {
      // Nothing keeps it to go later by itself; it ends once its caller
      // holds how to stop, unless that stopped it first.
      let heard = true
      const error = this.#unopened()
      queueMicrotask(() => heard && this.#ended(hearing, error))
      return () => void (heard = false)
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

  /**
   * Tries again at once, as when the machine it is on is back: a lost
   * connection does not wait out its try, nor does one away, and the
   * next waits from the first wait again. Open, connecting or refused,
   * only the wait changes.
   */
  wake(): void {
    this.#wait = FIRST_WAIT
    const { state } = this.#status
    if (this.#closed || (state !== "lost" && state !== "away")) return
    clearTimeout(this.#next)
    void this.#connect()
  }

  /**
   * The machine the engine is on is out of reach now, `why`, as the
   * client that reaches it says (ADR 0082, decision 16). Each act on its
   * way fails with `why`, as one that may have run there, and goes no
   * more; each waiting to go, and each made from now on, fails with it at
   * once, as not sent, until the engine is woken (`wake`) as the machine
   * is back (ADR 0106, law 4). A read waits for that. The connection
   * ends, and none is tried meanwhile. Away already, it only says `why`
   * from now on.
   */
  away(why: Unreachable): void {
    // One that said goodbye tries no more: it stays refused.
    if (this.#closed || this.#status.state === "refused") return
    this.#why = why
    if (this.#status.state === "away") return
    this.#go++
    clearTimeout(this.#next)
    const socket = this.#socket
    this.#socket = null
    socket?.close()
    this.#lose(why)
    this.#set({ state: "away" })
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

  /** Waits for the engine to be open, as an ask is `going`: an act fails
   * at once while its machine is out of reach, and a command sent `once`
   * while the engine is not open. */
  #opened(going: Going): Promise<void> {
    return new Promise((resolve, reject) => {
      const stop = this.watch((status) => {
        const done = (error?: Error) => {
          queueMicrotask(() => stop())
          if (error) reject(error)
          else resolve()
        }
        if (status.state === "open") done()
        else if (status.state === "refused" || this.#closed)
          done(this.#unopened())
        else if (going === "act" && status.state === "away")
          done(this.#unopened())
        else if (going === "now") done(this.#unopened())
      })
    })
  }

  /** Why what is asked now cannot go, as the engine is not open: it said
   * goodbye; it is closed; or its machine is away, or the connection is
   * down for a command sent `once`, in its machine's words (`#gone`). */
  #unopened(): Error {
    const { status } = this
    if (status.state === "refused") return new Refused(status.refusal)
    if (this.#closed) return new Lost()
    return this.#gone(false)
  }

  /**
   * Why an act, or what is asked `once`, fails as its machine is away or
   * its connection ends: in the words of the machine the engine is on, as
   * it went away (`why`), as it is away, or as the client that reaches it
   * says now; `Lost` for an engine that names no machine, or is closed. As
   * one that may have run, where it `went`.
   */
  #gone(went: boolean, why?: Unreachable): Error {
    const away = this.#status.state === "away" ? this.#why : undefined
    const words =
      why ?? away ?? (this.#closed ? undefined : this.#unreachable?.())
    if (!words) return new Lost({ may_have_run: went })
    return went ? words.sent() : words
  }

  /** Ends `hearing`, heard `once`, as the client: one that `went` may
   * have run, and ends with `may_have_run`; one never sent is refused. */
  #ended(hearing: Hearing, error: Error, went = false): void {
    const refusal: Refusal =
      error instanceof Refused
        ? error.refusal
        : went
          ? { code: "may_have_run", message: LOST }
          : { code: "conflict", message: error.message }
    hearing.onEnd(refusal, error)
  }

  async #connect(): Promise<void> {
    if (this.#closed) return
    const go = ++this.#go
    this.#set({ state: "connecting" })
    let address: Address
    try {
      address = await this.#address()
    } catch (error) {
      if (go !== this.#go) return
      if (error instanceof Unreachable) this.away(error)
      else this.#retry()
      return
    }
    // Overtaken while it asked: by `away`, or by a later connect.
    if (go !== this.#go || this.#closed) return
    const socket = new WebSocket(address.url)
    this.#socket = socket
    // What the engine says comes `latency` ms late, its close too, each
    // in the order it came: timers of one delay run in the order set. A
    // connection let go of meanwhile is heard no more.
    const latency = address.latency ?? 0
    const later = (heard: () => void) => {
      const now = () => void (this.#socket === socket && heard())
      if (latency > 0) setTimeout(now, latency)
      else now()
    }
    socket.onopen = () =>
      this.#send({ type: "hello", protocol: PROTOCOL, token: address.secret })
    socket.onmessage = (message) =>
      later(() => this.#receive(String(message.data)))
    socket.onclose = () => later(() => this.#drop())
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
          ...(frame.fence && { fence: frame.fence }),
          ...(frame.named && { named: frame.named }),
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
          else pending.resolve(frame)
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

  /**
   * What was on its way as the connection ended, `why` where its machine
   * went out of reach. Each call fails: one that acts, as one that may have
   * run, and a read sent `once`, in its machine's words; a command, for
   * `commandAt` to send again or not. What is heard once and was asked
   * ends, as one that may have run, not to be asked again. One not asked
   * yet waits for the next connection while its machine is in reach, as
   * an act asked then would, and is refused once it is out of reach.
   */
  #lose(why?: Unreachable): void {
    for (const pending of this.#pending.values())
      pending.reject(
        pending.command
          ? (why?.sent() ?? new Lost())
          : pending.once
            ? this.#gone(pending.act, why)
            : new Lost()
      )
    this.#pending.clear()
    for (const [id, hearing] of this.#hearing) {
      if (!hearing.once || (!hearing.sent && !why)) continue
      this.#hearing.delete(id)
      this.#ended(hearing, this.#gone(hearing.sent, why), hearing.sent)
    }
  }

  #drop(): void {
    this.#socket = null
    this.#lose()
    if (!this.#closed && this.#status.state !== "refused") this.#retry()
  }

  #retry(): void {
    if (this.#closed) return
    const wait = this.#wait
    this.#wait = Math.min(wait * 2, LONGEST_WAIT)
    this.#set({ state: "lost", retryIn: wait })
    this.#next = setTimeout(() => void this.#connect(), wait)
  }
}
