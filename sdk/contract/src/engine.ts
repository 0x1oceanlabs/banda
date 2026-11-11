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
      /** Banda's version this engine was built as, and its build id (ADR
       * 0115, decision 6). None from an engine older than both. */
      version?: string
      build?: string
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
  /**
   * The time past which it must not run, in ms since the epoch by this
   * machine's clock, as for a message that waited for its machine (ADR
   * 0105). It goes on the frame as `not_after`, in the host's time: plus
   * how far the host's clock is ahead, as its last `pong` said (`offset`),
   * else as the caller knew it (`ahead`), else as it is. The host refuses
   * it `expired` after, unless it ran: then it answers as it did. An older
   * host ignores it, so the caller drops it in time itself.
   */
  notAfter?: number
  /** How far the host's clock is ahead, in ms, as the caller knew it
   * before, for `notAfter` while this engine heard no `pong`: as for a
   * message kept across a restart. Read as the frame goes, so a `pong`
   * heard on the way wins. */
  ahead?: number
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
 * How a client asks the engine of another machine whether it still
 * answers (ADR 0082, decision 11), in ms.
 */
export type Ping = {
  /** How often it pings while open: two pings in a row heard nothing
   * after, and the engine is stale. */
  every: number
  /** How long the engine may say nothing before an act asks it first. */
  quiet: number
  /** How long that asking waits for any answer before the engine is
   * stale. */
  within: number
}

/** As a window asks another machine's engine: a ping every 15 s; an act
 * after 5 s of quiet asks first, and hears an answer in 3 s or fails. */
export const PING: Ping = { every: 15_000, quiet: 5_000, within: 3_000 }

/** Pings in a row that heard nothing after them, and the engine is stale. */
const MISSED = 2

/** `at`, by this machine's clock, by the host's that is `offset` ms ahead;
 * as it is while none was heard. */
const hostTime = (at: number | undefined, offset: number | undefined) =>
  at === undefined ? undefined : Math.round(at + (offset ?? 0))

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
 * - The engine of another machine is pinged (`ping`): one that answers
 *   nothing, its connection open or not, is stale until it is heard again,
 *   and an act to it fails as one to a machine away does.
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
  readonly #ping: Ping | undefined
  readonly #onStale: ((stale: boolean) => void) | undefined
  /** When it last heard the engine say anything, by this machine's clock. */
  #heard: number | undefined
  /** Whether it heard anything since its last ping. */
  #answered = true
  /** Pings in a row that heard nothing after them. */
  #missed = 0
  #pinging: ReturnType<typeof setInterval> | undefined
  /** Each ping on its way, by its ID: when it went. */
  readonly #pings = new Map<number, number>()
  #stale = false
  /** Each act waiting for the connection to open, failed as the engine
   * is stale. */
  readonly #hushed = new Set<(why: Error) => void>()
  /** An act's asking whether the engine answers, while it waits: heard,
   * or not as the connection ended first. */
  #probe:
    | {
        heard: Promise<boolean>
        answered: (heard: boolean) => void
        failed: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  #offset: number | undefined

  /**
   * `address` says where the engine listens now. It may throw
   * `Unreachable` while the engine's machine is out of reach: the engine
   * is then `away` until woken. `unreachable` names the machine of an
   * engine on another one: an act, or a read sent `once`, that the
   * connection lost fails with it, not `Lost`, as that machine may be gone
   * before the client is told so, and so does one while it is stale. With
   * `ping`, the engine is asked whether it still answers (ADR 0082,
   * decision 11), and `onStale` hears as it is stale and as it answers
   * again.
   */
  constructor(
    address: () => Promise<Address>,
    {
      unreachable,
      ping,
      onStale,
    }: {
      unreachable?: () => Unreachable
      ping?: Ping
      onStale?: (stale: boolean) => void
    } = {}
  ) {
    this.#address = address
    this.#unreachable = unreachable
    this.#ping = ping
    this.#onStale = onStale
    void this.#connect()
  }

  get status(): Status {
    return this.#status
  }

  /**
   * Whether the engine answers nothing (ADR 0082, decision 11): two pings
   * in a row heard nothing after them, or an act asked first and heard
   * nothing in time. Its connection may still be open: an act fails at
   * once, one on its way fails as one that may have run, and a read waits.
   * It is no more as soon as the engine says anything, or is away.
   */
  get stale(): boolean {
    return this.#stale
  }

  /** When the client last heard the engine say anything, in ms since the
   * epoch by this machine's clock; none before it first did. */
  get heard(): number | undefined {
    return this.#heard
  }

  /** How far the engine's clock is ahead of this machine's, in ms, as its
   * last `pong` said, with half the way there and back taken off; none
   * before one. */
  get offset(): number | undefined {
    return this.#offset
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
      notAfter?: number
      ahead?: number
      sent?: () => void
    }
  ): Promise<Result> {
    const command = options.command !== undefined
    const once = options.once ?? false
    const act = !command && acts(method)
    await this.#ready(
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
      not_after: hostTime(options.notAfter, this.#offset ?? options.ahead),
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
    { once = false, notAfter, ahead }: CommandOptions = {}
  ): Promise<Answered<M>> {
    let went = false
    const sent = () => void (went = true)
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.#ask(method, params, {
          project,
          command,
          once,
          notAfter,
          ahead,
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
   * again. It goes as an act call does: asked while its machine is out of
   * reach, or its engine is stale, it is not sent and ends at once,
   * refused, as it does when that machine goes before it was sent; when
   * the connection breaks after it was asked, or the engine goes stale, it
   * ends with `may_have_run`, and the caller checks. Either way `onEnd`
   * hears the client's error too, in its machine's words (`Unreachable`),
   * or `Lost`, for the caller to say what was not done.
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
    let stopped = false
    if (!hearing.once) {
      this.#hearing.set(id, hearing)
      if (this.#status.state === "open") this.#hear(id, hearing)
    } else {
      // It goes as an act call does, and nothing keeps it to go later by
      // itself: refused, it ends unsent, unless its caller stopped it first.
      void this.#ready("act").then(
        () => {
          if (stopped) return
          this.#hearing.set(id, hearing)
          this.#hear(id, hearing)
        },
        (error: Error) => {
          if (!stopped) this.#ended(hearing, error)
        }
      )
    }
    return () => {
      stopped = true
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
    // Away, it is no more stale: the client that reaches it says why.
    this.#stale = false
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
    this.#quiet(new Lost())
    this.#fail(new Lost())
  }

  #set(status: Status): void {
    this.#status = status
    for (const watcher of this.#watchers) watcher(status)
  }

  /**
   * Waits for the engine to be open, as an ask is `going`: an act fails
   * at once while its machine is out of reach, and a command sent `once`
   * while the engine is not open. An act to a pinged engine fails,
   * unsent, as it is stale; and one that finds it connecting after a
   * quiet while waits `ping.within` at most, as one asking first does,
   * before it is stale.
   */
  #opened(going: Going): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#hushed.delete(done)
        queueMicrotask(() => stop())
        if (error) reject(error)
        else resolve()
      }
      const ping = going === "read" ? undefined : this.#ping
      if (ping) {
        this.#hushed.add(done)
        if (this.#status.state === "connecting" && this.#quietFor(ping))
          timer = setTimeout(() => this.#hush(), ping.within)
      }
      const stop = this.watch((status) => {
        if (status.state === "open") done()
        else if (status.state === "refused" || this.#closed)
          done(this.#unopened())
        else if (going === "act" && status.state === "away")
          done(this.#unopened())
        else if (going === "now") done(this.#unopened())
      })
    })
  }

  /**
   * Waits until an ask may go, as it is `going` (`#opened`). An act to a
   * pinged engine fails at once, unsent, while it is stale, and asks it
   * first after a quiet while (`#answering`); where the connection ends
   * before it answers, the act waits again as its machine's status says.
   * A read only waits for the connection. Closed, nothing else goes.
   */
  async #ready(going: Going): Promise<void> {
    if (going === "read") return this.#opened(going)
    if (this.#closed) throw new Lost()
    if (this.#stale) throw this.#gone(false)
    do {
      await this.#opened(going)
    } while (!(await this.#answering()))
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

  /** Whether the engine said nothing for `ping.quiet` ms, or never did. */
  #quietFor(ping: Ping): boolean {
    return this.#heard === undefined || Date.now() - this.#heard >= ping.quiet
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
    this.#pingEach()
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
    this.#heardNow()
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
          ...(frame.version && { version: frame.version }),
          ...(frame.build && { build: frame.build }),
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
      case "pong": {
        const went = this.#pings.get(frame.id)
        this.#pings.delete(frame.id)
        if (went !== undefined)
          this.#offset = frame.time - (went + Date.now()) / 2
        break
      }
      case "result": {
        // An engine from before the ping answers one as a frame that does
        // not fit: it answers all the same.
        if (this.#pings.delete(frame.id)) break
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

  /** Pings the engine every `ping.every` ms from now, while the
   * connection is open: two pings in a row that hear nothing after them,
   * and it is stale. Counted from the connection's start, so one whose
   * engine never says welcome is stale in as long. */
  #pingEach(): void {
    const ping = this.#ping
    if (!ping) return
    clearInterval(this.#pinging)
    this.#answered = true
    this.#missed = 0
    this.#pinging = setInterval(() => {
      this.#missed = this.#answered ? 0 : this.#missed + 1
      if (this.#missed >= MISSED) this.#hush()
      this.#answered = false
      if (this.#status.state === "open") this.#sendPing()
    }, ping.every)
  }

  #sendPing(): void {
    const id = this.#nextId++
    this.#pings.set(id, Date.now())
    this.#send({ type: "ping", id })
  }

  /**
   * Waits until the engine of another machine answers, before an act goes
   * to it (ADR 0082, decision 11): at once when it was heard within
   * `ping.quiet`; else it is pinged, and with nothing heard in
   * `ping.within` it is stale, and the act fails unsent. False where the
   * connection ended before it answered.
   */
  #answering(): Promise<boolean> {
    const ping = this.#ping
    if (!ping) return Promise.resolve(true)
    if (this.#stale) return Promise.reject(this.#gone(false))
    if (!this.#quietFor(ping)) return Promise.resolve(true)
    if (!this.#probe) {
      let answered: (heard: boolean) => void = () => {}
      let failed: (error: Error) => void = () => {}
      const heard = new Promise<boolean>((resolve, reject) => {
        answered = resolve
        failed = reject
      })
      const timer = setTimeout(() => this.#hush(), ping.within)
      this.#probe = { heard, answered, failed, timer }
      this.#sendPing()
    }
    return this.#probe.heard
  }

  /** The engine said something: it answers, and is stale no more. */
  #heardNow(): void {
    this.#heard = Date.now()
    this.#answered = true
    this.#missed = 0
    const probe = this.#probe
    this.#probe = undefined
    if (probe) {
      clearTimeout(probe.timer)
      probe.answered(true)
    }
    if (!this.#stale) return
    this.#stale = false
    this.#onStale?.(false)
  }

  /**
   * The engine answers nothing: it is stale, and its machine shows away
   * first, so what fails says so in that machine's words. Each act on its
   * way, and each read sent `once` as part of one, fails as the connection
   * ending fails it (`#broken`), and is not sent again; a stream that acts
   * ends with `may_have_run`. An act waiting for the connection, or asking
   * first, fails unsent; a read waits for the engine to answer, on the
   * connection still open.
   */
  #hush(): void {
    if (this.#stale || this.#closed) return
    this.#stale = true
    this.#onStale?.(true)
    const why = this.#unreachable?.()
    const unsent = this.#gone(false, why)
    const probe = this.#probe
    this.#probe = undefined
    if (probe) {
      clearTimeout(probe.timer)
      probe.failed(unsent)
    }
    for (const waiting of [...this.#hushed]) waiting(unsent)
    for (const [id, pending] of this.#pending) {
      if (!pending.command && !pending.once) continue
      this.#pending.delete(id)
      pending.reject(this.#broken(pending, why))
    }
    for (const [id, hearing] of this.#hearing) {
      if (!hearing.once) continue
      this.#hearing.delete(id)
      this.#ended(hearing, this.#gone(hearing.sent, why), hearing.sent)
    }
  }

  /** The connection ended: no more pings. An act that asked whether the
   * engine answers waits again as its machine's status says (`#ready`),
   * or fails with `why`, unsent, as the client closes. */
  #quiet(why?: Error): void {
    clearInterval(this.#pinging)
    this.#pinging = undefined
    this.#pings.clear()
    const probe = this.#probe
    this.#probe = undefined
    if (!probe) return
    clearTimeout(probe.timer)
    if (why) probe.failed(why)
    else probe.answered(false)
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  /**
   * What was on its way as the connection ended, `why` where its machine
   * went out of reach. Each call fails (`#broken`). What is heard once and
   * was asked ends, as one that may have run, not to be asked again. An
   * act not asked yet waits for the next connection while its machine is
   * in reach, and is refused once it is out of reach (`#ready`).
   */
  #lose(why?: Unreachable): void {
    this.#quiet()
    for (const pending of this.#pending.values())
      pending.reject(this.#broken(pending, why))
    this.#pending.clear()
    for (const [id, hearing] of this.#hearing) {
      if (!hearing.once) continue
      this.#hearing.delete(id)
      this.#ended(hearing, this.#gone(hearing.sent, why), hearing.sent)
    }
  }

  /** Why a call on its way fails as the connection ends, or as the engine
   * is stale: one that acts, as one that may have run, and a read sent
   * `once`, in its machine's words (`why` where it went out of reach); a
   * command, for `commandAt` to send again or not. */
  #broken(pending: Pending, why?: Unreachable): Error {
    if (pending.command) return why?.sent() ?? new Lost()
    return pending.once ? this.#gone(pending.act, why) : new Lost()
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
