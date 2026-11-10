/**
 * What waits for another machine (ADR 0105): a message to a started
 * Thread the Person sent with "Send when back", while that machine was
 * away, stopped or on another build. Nothing else waits (Q1). It goes
 * once the Window reaches the machine again (`KeptHosts`), in the order
 * queued, by the ID it was given as it was queued, so the host runs it
 * once however often it goes (ADR 0082, decision 4). Past its time it is
 * not sent, and comes back to its App, which puts its words back into the
 * draft (Q5). What waits is this device's, kept through a port: in memory
 * here, on the device in H5e-2 (Q6). Plain, as `KeptHosts` is; what
 * reads it from React is `react/waiting.ts`.
 */
import {
  type CommandCall,
  type CommandOptions,
  type Engine,
  Lost,
  type ProjectId,
  Refused,
  type Status,
  Unreachable,
} from "@banda/contract"
import type { Shown } from "./hosts"
import type { PaneState } from "./pane"
import { type Readable, Store } from "./store"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long a message waits unless the Person says longer: 10 minutes
 * (ADR 0082, decision 16). */
export const KEEP = 10 * MINUTE

/** What "Keep for" offers, the default first: 7 days at most, as long as
 * a receipt is sure to be found (Q4). */
export const KEEPS: readonly { for: number; words: string }[] = [
  { for: KEEP, words: "10 min" },
  { for: HOUR, words: "1 hour" },
  { for: DAY, words: "1 day" },
  { for: 7 * DAY, words: "7 days" },
]

/**
 * Whether a message to a started Thread on host `shown` waits for it, as
 * "Send when back" (Q2), by its engine's connection (`status`): while the
 * host is away, as one that answers nothing shows too, or stopped, or
 * refused, as one of another build is; or live while its engine refused
 * this window. Not while it connects or asks for a sign-in: Send says why
 * it is off.
 */
export function waitsFor(
  shown: Shown | undefined,
  status: Status["state"]
): boolean {
  switch (shown?.state.state) {
    case "away":
    case "stopped":
    case "refused":
      return true
    case "live":
      return status === "refused"
    default:
      return false
  }
}

/** A message that waits for its machine. */
export type Wait = {
  /** What goes, with the ID it was given as it was queued: each send of
   * it is this one command. */
  call: CommandCall
  /** The machine it waits for, by its key in `hosts.toml`. */
  host: string
  project: ProjectId
  /** What it goes to, as its App lists it: a Thread. */
  item: string
  /** Its words: its row shows them, and they go back into the draft. */
  text: string
  /** What it carries besides its words, as its App keeps it to show and
   * put back with them: a message's images. The queue only keeps it. */
  carried?: readonly unknown[]
  /** The Pane it was written in, for a toast's Open. */
  pane: PaneState
  /** When Send was pressed, in ms since the epoch, by this device's
   * clock; its time counts from then. */
  at: number
  /** The time past which it is not sent, by this device's clock: its
   * host's `not_after`. */
  until: number
  /** It is on its way now. */
  going?: true
  /** It was on its way as its machine went: it may have gone through. It
   * goes again as it is, so it has no Edit and no Keep for. */
  went?: true
}

/** A message that waits, as an App queues it: its time is 10 minutes
 * unless it says how long. */
export type NewWait = Omit<Wait, "until" | "going" | "went"> & {
  keep?: number
}

/** Why a message came back unsent. */
export type Why =
  /** Its time passed while its machine was away, by this device's clock
   * or as its host refused it. */
  | { kind: "expired" }
  /** It may have gone through: its time passed after it went as its
   * machine went, or its host says its run there was cut short. */
  | { kind: "went" }
  /** Its host refused it for another reason, in its words. */
  | { kind: "refused"; message: string }

/** A message that came back to its App: its words go back into the draft. */
export type Back = {
  wait: Wait
  why: Why
  /** Its machine's name, as the Window shows it. */
  machine: string
}

/** Who takes a message that came back; whether it took it. */
export type BackListener = (back: Back) => boolean

/** Where what waits is kept: what was kept last, and how to keep it. */
export type WaitingStorage = {
  read: () => readonly Wait[]
  write: (waits: readonly Wait[]) => void
}

/** What waits, kept in memory: gone as the window goes. */
export function inMemory(): WaitingStorage {
  let kept: readonly Wait[] = []
  return {
    read: () => kept,
    write: (waits) => void (kept = waits),
  }
}

/** What an App does with what waits: reads it, queues a message, changes
 * or takes back one, and hears one that comes back. The Window sends it. */
export type Queue = Pick<
  Waiting,
  | "get"
  | "subscribe"
  | "add"
  | "cancel"
  | "edit"
  | "hold"
  | "keepFor"
  | "onBack"
>

/** What sends a message: its machine's engine, and whether it refused
 * this window. */
export type Sender = Pick<Engine, "commandAt" | "status">

/** The messages that wait for their machines, in the order queued. */
export class Waiting implements Readable<readonly Wait[]> {
  readonly #storage: WaitingStorage
  readonly #waits: Store<readonly Wait[]>
  readonly #now: () => number
  readonly #named: (host: string) => string
  /** Who takes what comes back: the Window's first, a Pane's after. */
  readonly #first = new Set<BackListener>()
  readonly #after = new Set<BackListener>()
  /** What came back while none took it, for the first that does. */
  #untaken: Back[] = []
  /** The messages held while their rows are edited, by how many hold
   * each: they neither go nor come back. */
  readonly #held = new Map<string, number>()
  #timer: ReturnType<typeof setTimeout> | undefined

  /** `named` says a machine's name; `now` is this device's clock. */
  constructor(
    storage: WaitingStorage = inMemory(),
    {
      named = (host: string) => host,
      now = Date.now,
    }: { named?: (host: string) => string; now?: () => number } = {}
  ) {
    this.#storage = storage
    this.#named = named
    this.#now = now
    // What was kept as on its way may have gone through.
    this.#waits = new Store(
      storage.read().map((wait) => (wait.going ? wentOf(still(wait)) : wait))
    )
    this.#arm()
  }

  readonly get = (): readonly Wait[] => this.#waits.get()
  readonly subscribe = (listener: () => void) => this.#waits.subscribe(listener)

  /** Queues `wait`, after what waits already; its time counts from its
   * `at`, 7 days at most. */
  add({ keep = KEEP, ...wait }: NewWait): void {
    const until = wait.at + Math.min(keep, longest())
    this.#set([...this.get(), { ...wait, until }])
  }

  /** Takes back the message sent as `command`, unless it is on its way:
   * the one taken, for its words to go back into the draft. */
  cancel(command: string): Wait | undefined {
    const wait = this.#find(command)
    if (!wait || wait.going) return undefined
    this.#set(this.get().filter((one) => one !== wait))
    return wait
  }

  /** Changes the words of the message sent as `command`, and what goes,
   * by the same ID, its time kept; not one on its way or that went.
   * Whether it changed. */
  edit(command: string, text: string, call: CommandCall): boolean {
    if (call.command !== command) return false
    return this.#change(command, (wait) => ({ ...wait, text, call }))
  }

  /** Holds the message sent as `command` while its row is edited: it
   * neither goes nor comes back until the returned function lets it go,
   * so the words typed are the ones that go. */
  hold(command: string): () => void {
    this.#held.set(command, (this.#held.get(command) ?? 0) + 1)
    let held = true
    return () => {
      if (!held) return
      held = false
      const left = this.#held.get(command)! - 1
      if (left > 0) return void this.#held.set(command, left)
      this.#held.delete(command)
      // What waited for the edit goes now, or comes back.
      this.#set([...this.get()])
    }
  }

  /** Keeps the message sent as `command` for `keep` ms from when Send was
   * pressed; not one on its way or that went. */
  keepFor(command: string, keep: number): void {
    this.#change(command, (wait) => ({
      ...wait,
      until: wait.at + Math.min(keep, longest()),
    }))
  }

  /**
   * Sends what waits for `host` on `engine`, as the Window reaches it:
   * each in the order queued, once, each by its own ID and by its time.
   * One past its time is not sent: it comes back. Answered, it is gone,
   * saying nothing. Refused, it comes back: `expired` past its time by its
   * host's clock, as one that may have gone through where its run there
   * was cut short (`may_have_run`), or in its host's words. Refused unsent
   * as its machine went again, it waits as it was; on its way as it went,
   * or as the window was refused after, it waits as one that may have
   * gone through, to go again as it is. One held for its edit waits.
   */
  send(host: string, engine: Sender): void {
    this.#expire()
    const going = this.get().filter(
      (wait) => wait.host === host && !wait.going && !this.#holds(wait)
    )
    if (going.length === 0) return
    this.#set(
      this.get().map((wait) =>
        going.includes(wait) ? { ...wait, going: true } : wait
      )
    )
    for (const wait of going) void this.#go(wait, engine)
  }

  /**
   * Hears each message that comes back until the returned function is
   * called: it puts its words back into the draft, and says so. The
   * first to take it has it. The Window's come first; with `after`, one
   * that takes what the Window does not, as a Pane its own Thread's where
   * no Window hears. One taken by none waits for the next.
   */
  onBack(
    listener: BackListener,
    { after = false }: { after?: boolean } = {}
  ): () => void {
    const listeners = after ? this.#after : this.#first
    listeners.add(listener)
    this.#untaken = this.#untaken.filter((back) => !listener(back))
    return () => void listeners.delete(listener)
  }

  /** Stops its clock, as the window goes. */
  close(): void {
    clearTimeout(this.#timer)
  }

  async #go(wait: Wait, engine: Sender): Promise<void> {
    const { call, project, until } = wait
    const options: CommandOptions = { notAfter: until }
    try {
      await engine.commandAt(
        call.method,
        call.params as never,
        project,
        call.command,
        options
      )
      this.#set(this.get().filter((one) => one.call.command !== call.command))
    } catch (error) {
      // Its host's refusal; not the window's, as it went again after a
      // break.
      if (error instanceof Refused && engine.status.state !== "refused") {
        this.#back(call.command, whyOf(error))
        return
      }
      const waits =
        error instanceof Refused ||
        error instanceof Unreachable ||
        error instanceof Lost
      if (!waits) {
        console.warn("banda: a message that waited did not go:", error)
        this.#back(call.command, {
          kind: "refused",
          message: "Something went wrong.",
        })
        return
      }
      // Refused unsent, it waits as it was. Lost on its way, or the window
      // refused after it went, it may have gone through, and waits for a
      // window its host speaks to.
      const unsent = error instanceof Unreachable && !error.may_have_run
      this.#set(
        this.get().map((one) => {
          if (one.call.command !== call.command) return one
          return unsent ? still(one) : wentOf(still(one))
        })
      )
    }
  }

  #find(command: string): Wait | undefined {
    return this.get().find((wait) => wait.call.command === command)
  }

  /** Changes one that waits, neither on its way nor gone once; whether
   * it did. */
  #change(command: string, to: (wait: Wait) => Wait): boolean {
    const wait = this.#find(command)
    if (!wait || wait.going || wait.went) return false
    this.#set(this.get().map((one) => (one === wait ? to(wait) : one)))
    return true
  }

  #holds(wait: Wait): boolean {
    return this.#held.has(wait.call.command)
  }

  #set(waits: readonly Wait[]): void {
    // Kept first: one who hears it may change it again.
    this.#storage.write(waits)
    this.#waits.set(waits)
    this.#arm()
  }

  /** Takes the message sent as `command` out, and gives it back. */
  #back(command: string, why: Why): void {
    const wait = this.#find(command)
    if (!wait) return
    this.#set(this.get().filter((one) => one !== wait))
    const back = { wait, why, machine: this.#named(wait.host) }
    for (const listener of [...this.#first, ...this.#after])
      if (listener(back)) return
    this.#untaken.push(back)
  }

  /** Gives back each that waits past its time, not on its way: one on
   * its way waits for its host's answer. */
  #expire(): void {
    const now = this.#now()
    for (const wait of this.get())
      if (!wait.going && !this.#holds(wait) && now >= wait.until)
        this.#back(wait.call.command, {
          kind: wait.went ? "went" : "expired",
        })
  }

  /** Sets the clock for the first that waits to be past its time. */
  #arm(): void {
    clearTimeout(this.#timer)
    const next = Math.min(
      ...this.get()
        .filter((wait) => !wait.going && !this.#holds(wait))
        .map((wait) => wait.until)
    )
    if (next === Infinity) return
    this.#timer = setTimeout(
      () => {
        this.#expire()
        this.#arm()
      },
      Math.max(0, next - this.#now())
    )
  }
}

/** Why its host refused a message: past its time by its host's clock;
 * cut short there, so it may have gone through, as its host keeps for
 * good; or in its host's words. */
function whyOf({ refusal: { code, message } }: Refused): Why {
  if (code === "expired") return { kind: "expired" }
  if (code === "may_have_run") return { kind: "went" }
  return { kind: "refused", message }
}

/** The longest a message waits: as long as "Keep for" offers. */
const longest = () => KEEPS.at(-1)!.for

/** `wait`, not on its way. */
function still(wait: Wait): Wait {
  const { going, ...rest } = wait
  return going ? rest : wait
}

/** `wait`, as one that may have gone through. */
const wentOf = (wait: Wait): Wait => ({ ...wait, went: true })
