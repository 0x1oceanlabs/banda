/**
 * What waits for another machine (ADR 0105): a message to a started
 * Thread the Person sent with "Send when back", while that machine was
 * away, stopped or on another build. Nothing else waits (Q1). It goes
 * once the Window reaches the machine again (`KeptHosts`), in the order
 * queued, by the ID it was given as it was queued, so the host runs it
 * once however often it goes (ADR 0082, decision 4). Past its time it is
 * not sent, and comes back to its App, which puts its words back into the
 * draft (Q5).
 *
 * What waits is this device's (Q6): kept in its storage through a port
 * (`onDevice`), per machine, for its time, so it is there after a restart,
 * and one queue for every window on the device, as the drafts are
 * (#1299). One window sends it and gives it back: the main window. A
 * Pane's own window queues, changes and takes back through the storage,
 * holds a message while its row is edited there, and takes what came
 * back of a Thread only it shows. Each hears what the others change.
 * Plain, as `KeptHosts` is; what reads it from React is
 * `react/waiting.ts`.
 */
import {
  type CommandCall,
  type CommandOptions,
  type Engine,
  Lost,
  newId,
  type ProjectId,
  type ProjectSummary,
  Refused,
  type Status,
  Unreachable,
} from "@banda/contract"
import type { Shown } from "./hosts"
import { paneHost, type PaneState } from "./pane"
import { type Readable, sameEach, Store } from "./store"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long a message waits unless the Person says longer: 10 minutes
 * (ADR 0082, decision 16). */
export const KEEP = 10 * MINUTE

/** What "Keep for" offers, the default first: 7 days at most, as long as
 * a receipt is sure to be found, and as long as the device keeps one (Q4,
 * Q6). */
export const KEEPS: readonly { for: number; words: string }[] = [
  { for: KEEP, words: "10 min" },
  { for: HOUR, words: "1 hour" },
  { for: DAY, words: "1 day" },
  { for: 7 * DAY, words: "7 days" },
]

/** How long an edit in another window holds its message unless that
 * window says so again, every 20 s (`HOLD_AGAIN`): longer than a hidden
 * window's clock may sleep, as it wakes once a minute; one that broke
 * lets go within it. */
const HOLD = 5 * MINUTE
const HOLD_AGAIN = 20_000

/** How long the window that shows a Thread has to take what came back
 * of it, before the main window takes it itself. */
const CLAIM = 5_000

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
  /** The Pane it was written in, for a toast's Open; its args keep the
   * Item's title. */
  pane: PaneState
  /** What its Pane shows before its machine answers, as after a restart
   * (Q6), as it was when queued: its Project, whom it is written to, and
   * what its composer offers by name, as its App names them (a Harness's
   * name, #956, and its skills). */
  shows?: { project?: ProjectSummary; to?: string; skills?: readonly string[] }
  /** When Send was pressed, in ms since the epoch, by this device's
   * clock; its time counts from then. */
  at: number
  /** The time past which it is not sent, by this device's clock: the
   * window drops it then by itself, with no word from its host. */
  until: number
  /** The same time by its host's clock, as this device knew it when it
   * was queued: `until` plus how far ahead its host's clock was, as its
   * last `pong` said, or `until` alone while none was heard. Its frame
   * carries it as `not_after` where its host's engine has heard no `pong`
   * since, as after a restart. */
  notAfter: number
  /** Where it is in the order queued on this device. */
  seq: number
  /** It is on its way now. */
  going?: true
  /** It was on its way as its machine went: it may have gone through. It
   * goes again as it is, so it has no Edit and no Keep for. */
  went?: true
}

/** A message that waits, as an App queues it for its Pane: the queue
 * works out its machine (ADR 0106, law 6), and its time is 10 minutes
 * unless it says how long. */
export type NewWait = Omit<
  Wait,
  "host" | "until" | "notAfter" | "seq" | "going" | "went"
> & { keep?: number }

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

/** A message that came back to its App: its words go back into the draft,
 * and the Person is told. */
export type Back = {
  wait: Wait
  why: Why
  /** Its machine's name, as the Window shows it. */
  machine: string
}

/** Who takes a message that came back; whether it took it. */
export type BackListener = (back: Back) => boolean

/**
 * Where what waits is kept: texts by key, as a device's storage keeps
 * them, shared by every window on the device. Each message is kept under
 * a key of its own, and what each window does under its own, so no
 * window's write takes back another's.
 */
export type WaitingStorage = {
  /** Each text kept now, by its key. */
  read: () => ReadonlyMap<string, string>
  /** Keeps `text` under `key`; null forgets it. */
  write: (key: string, text: string | null) => void
  /** Hears another window change what is kept; returns how to stop. */
  follow: (heard: () => void) => () => void
}

/** What waits, kept in memory: gone as the window goes, and this
 * window's alone. */
export function inMemory(): WaitingStorage {
  const kept = new Map<string, string>()
  return {
    read: () => new Map(kept),
    write: (key, text) => {
      if (text === null) kept.delete(key)
      else kept.set(key, text)
    },
    follow: () => () => undefined,
  }
}

/** A device's storage, as the window's `localStorage` is. */
export type DeviceStorage = {
  readonly length: number
  key: (index: number) => string | null
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** What tells a window that another changed the storage: the window, by
 * its `storage` events. */
export type StorageEvents = {
  addEventListener: (
    type: "storage",
    listener: (event: { key: string | null }) => void
  ) => void
  removeEventListener: (
    type: "storage",
    listener: (event: { key: string | null }) => void
  ) => void
}

/** Where the device's storage keeps what waits. */
const PREFIX = "banda.waiting."

/**
 * What waits, kept in the device's storage under `banda.waiting.`, as the
 * drafts are: `storage` is the window's `localStorage`, read as it is
 * asked for, and `events` the window, whose `storage` events say what
 * another window on the device changed. What the storage does not take,
 * as one full or shut, this window keeps in memory while it lasts.
 */
export function onDevice(
  storage: () => DeviceStorage,
  events?: StorageEvents
): WaitingStorage {
  // What the storage did not take: a text, or null for one it did not
  // forget.
  const here = new Map<string, string | null>()
  return {
    read: () => {
      const all = new Map<string, string>()
      try {
        const kept = storage()
        for (let i = 0; i < kept.length; i++) {
          const key = kept.key(i)
          if (!key?.startsWith(PREFIX)) continue
          const text = kept.getItem(key)
          if (text !== null) all.set(key.slice(PREFIX.length), text)
        }
      } catch {
        // `here` holds what this window kept.
      }
      for (const [key, text] of here)
        if (text === null) all.delete(key)
        else all.set(key, text)
      return all
    },
    write: (key, text) => {
      try {
        const kept = storage()
        if (text === null) kept.removeItem(PREFIX + key)
        else kept.setItem(PREFIX + key, text)
        here.delete(key)
      } catch {
        here.set(key, text)
      }
    },
    follow: (heard) => {
      if (!events) return () => undefined
      const changed = ({ key }: { key: string | null }) => {
        // None, as the storage was cleared.
        if (key === null || key.startsWith(PREFIX)) heard()
      }
      events.addEventListener("storage", changed)
      return () => events.removeEventListener("storage", changed)
    },
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

/** Where the storage keeps a message, what a window does, and what came
 * back handed to the window that shows its Thread, or kept for the main
 * window where none took it yet. */
const MESSAGE = "message."
const WINDOW = "window."
const TOLD = "told."

/** Whom what came back is kept for where none took it yet: the main
 * window, this one or the next, as one of its listeners takes it. */
const MAIN = "main"

/** What a window other than the main one does, as it keeps it: the
 * messages it holds while their rows are edited there, each until when,
 * and the Items its Panes show; as of `at`. */
type Doing = { at: number; held: Record<string, number>; shows: string[] }

/** What came back, handed to window `to`, which shows its Thread and
 * its draft, to take; or to `MAIN`. */
type Told = { to: string; back: Back }

/** The messages that wait for their machines, in the order queued. */
export class Waiting implements Readable<readonly Wait[]> {
  readonly #storage: WaitingStorage
  readonly #waits = new Store<readonly Wait[]>([])
  readonly #now: () => number
  readonly #placed: (
    project: ProjectId,
    pane: Pick<PaneState, "args">
  ) => string | undefined
  readonly #named: (host: string) => string
  readonly #summary: (
    host: string,
    project: ProjectId
  ) => ProjectSummary | undefined
  readonly #ahead: (host: string) => number | undefined
  /** Whether this window sends and gives back: the main window's. */
  readonly drains: boolean
  /** This window, as the storage knows it. */
  readonly #id = newId()
  /** Who takes what comes back: the Window's first; then a Pane's, by
   * the Item it shows. */
  readonly #first = new Set<BackListener>()
  readonly #panes = new Map<BackListener, string>()
  /** The messages held while their rows are edited here, by how many
   * hold each: they neither go nor come back. */
  readonly #held = new Map<string, number>()
  /** What the other windows hold, each until when. */
  #others: ReadonlyMap<string, number> = new Map()
  /** The Items each other window's Panes show, by that window. */
  #elsewhere: ReadonlyMap<string, readonly string[]> = new Map()
  /** Each message as last read, by its key, with the text it was read
   * from: one whose text stays is the same object. */
  #read = new Map<string, { text: string; wait: Wait }>()
  /** What came back handed to another window, by its key, and when this
   * one takes it after all. */
  readonly #handed = new Map<string, ReturnType<typeof setTimeout>>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #saying: ReturnType<typeof setTimeout> | undefined
  #unfollow: (() => void) | undefined
  /** Whether it tidied what the last main window left: once, as a start
   * again finds this window's own on its way. */
  #tidied = false

  /**
   * `placed` says the machine that has a Pane of a Project, by its key in
   * `hosts.toml`, none for this machine or one the Window does not know:
   * with no Window's hosts, the one its args name. `named` says a
   * machine's name, and `summary` a Project as that machine lists it;
   * `now` is this device's clock; `ahead` says how far a host's clock is
   * ahead of it, as its engine last heard; only the main window `drains`
   * what waits: sends it, and gives back what does not go. It reads what
   * is kept now, and follows it once started (`start`).
   */
  constructor(
    storage: WaitingStorage = inMemory(),
    {
      placed = (_, pane) => paneHost(pane),
      named = (host: string) => host,
      summary = () => undefined,
      now = Date.now,
      ahead = () => undefined,
      drains = true,
    }: {
      placed?: (
        project: ProjectId,
        pane: Pick<PaneState, "args">
      ) => string | undefined
      named?: (host: string) => string
      summary?: (host: string, project: ProjectId) => ProjectSummary | undefined
      now?: () => number
      ahead?: (host: string) => number | undefined
      drains?: boolean
    } = {}
  ) {
    this.#storage = storage
    this.#placed = placed
    this.#named = named
    this.#summary = summary
    this.#now = now
    this.#ahead = ahead
    this.drains = drains
    this.#refresh({ arm: false })
  }

  readonly get = (): readonly Wait[] => this.#waits.get()
  readonly subscribe = (listener: () => void) => this.#waits.subscribe(listener)

  /**
   * Follows what is kept, as the other windows change it, and keeps its
   * clock, until the returned function is called. The main window first
   * tidies what the last one left, once (`#tidy`); one past its time
   * comes back now.
   */
  start(): () => void {
    this.close()
    if (this.drains && !this.#tidied) this.#tidy()
    this.#tidied = true
    if (this.drains) this.#awaitHanded()
    this.#unfollow = this.#storage.follow(() => this.#refresh())
    this.#publish()
    this.#refresh()
    return () => this.close()
  }

  /**
   * Queues `wait` for the machine that has the Pane it is written in,
   * `by`, after what waits already, and says whether it did: not where
   * that is this machine, whose engine is there, or no machine the Window
   * knows. Its time counts from its `at`, 7 days at most. What its Pane
   * shows before that machine answers, where it says any, keeps its
   * Project as that machine lists it, or as a message to it kept it
   * before (Q6).
   */
  add(
    { keep = KEEP, ...wait }: NewWait,
    by: Pick<PaneState, "args"> = wait.pane
  ): boolean {
    const host = this.#placed(wait.project, by)
    if (host === undefined) return false
    const until = wait.at + Math.min(keep, longest())
    const seq = Math.max(0, ...this.#latestAll().map((one) => one.seq)) + 1
    const ahead = this.#ahead(host) ?? 0
    const project =
      this.#summary(host, wait.project) ??
      this.get().find(
        (one) => one.project === wait.project && one.shows?.project
      )?.shows?.project
    this.#put({
      ...wait,
      host,
      ...(wait.shows && {
        shows: { ...(project && { project }), ...wait.shows },
      }),
      until,
      notAfter: until + ahead,
      seq,
    })
    this.#refresh()
    return true
  }

  /** Takes back the message sent as `command`, unless it is on its way:
   * the one taken, for its words to go back into the draft. */
  cancel(command: string): Wait | undefined {
    const wait = this.#latest(command)
    if (!wait || wait.going) return undefined
    this.#storage.write(MESSAGE + command, null)
    this.#refresh()
    return wait
  }

  /** Changes the words of the message sent as `command`, and what goes,
   * by the same ID, its time kept; not one on its way or that went.
   * Whether it changed. */
  edit(command: string, text: string, call: CommandCall): boolean {
    if (call.command !== command) return false
    return this.#change(command, (wait) => ({ ...wait, text, call }))
  }

  /** Holds the message sent as `command` while its row is edited, in this
   * window or another: it neither goes nor comes back until the returned
   * function lets it go, so the words typed are the ones that go. */
  hold(command: string): () => void {
    this.#held.set(command, (this.#held.get(command) ?? 0) + 1)
    this.#publish()
    let held = true
    return () => {
      if (!held) return
      held = false
      const left = this.#held.get(command)! - 1
      if (left > 0) return void this.#held.set(command, left)
      this.#held.delete(command)
      this.#publish()
      // What waited for the edit goes now, or comes back.
      this.#nudge()
    }
  }

  /** Keeps the message sent as `command` for `keep` ms from when Send was
   * pressed; not one on its way or that went. */
  keepFor(command: string, keep: number): void {
    this.#change(command, (wait) => {
      const until = wait.at + Math.min(keep, longest())
      return { ...wait, until, notAfter: wait.notAfter + until - wait.until }
    })
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
   * gone through, to go again as it is. One held for its edit, in this
   * window or another, waits. Only the main window sends.
   */
  send(host: string, engine: Sender): void {
    if (!this.drains) return
    this.#expire()
    for (const one of this.get()) {
      if (one.host !== host || one.going || this.#holds(one)) continue
      // As it is kept now: another window may have changed or taken it.
      const wait = this.#latest(one.call.command)
      if (!wait || wait.going || wait.until <= this.#now()) continue
      const going: Wait = { ...wait, going: true }
      this.#put(going)
      void this.#go(going, engine)
    }
    this.#refresh()
  }

  /**
   * Hears each message that comes back until the returned function is
   * called: it puts its words back into the draft, and says so. The
   * first to take it has it. The Window's come first; with `item`, a
   * Pane's that shows that Item, which takes what the Window does not, as
   * in a window of its own where no Window hears. One taken by none is
   * kept for the next, after a restart too. What came back of a Thread
   * that only another window shows, that window takes, as its composer
   * has the draft.
   */
  onBack(listener: BackListener, { item }: { item?: string } = {}) {
    if (item === undefined) this.#first.add(listener)
    else {
      this.#panes.set(listener, item)
      this.#publish()
    }
    // What came back before it heard.
    this.#refresh()
    return () => {
      this.#first.delete(listener)
      if (this.#panes.delete(listener)) this.#publish()
    }
  }

  /** Stops following what is kept and its clocks, as the window goes, and
   * says it holds and shows nothing. */
  close(): void {
    this.#unfollow?.()
    this.#unfollow = undefined
    clearTimeout(this.#timer)
    clearTimeout(this.#saying)
    for (const timer of this.#handed.values()) clearTimeout(timer)
    this.#handed.clear()
    if (!this.drains) this.#storage.write(WINDOW + this.#id, null)
  }

  async #go(wait: Wait, engine: Sender): Promise<void> {
    const { call, project, until, notAfter } = wait
    // In its host's clock: as its engine heard it last as the frame goes,
    // else as this device knew it when it was queued, as after a restart.
    const options: CommandOptions = { notAfter: until, ahead: notAfter - until }
    try {
      await engine.commandAt(
        call.method,
        call.params as never,
        project,
        call.command,
        options
      )
      this.#storage.write(MESSAGE + call.command, null)
      this.#refresh()
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
      const now = this.#latest(call.command)
      if (now) this.#put(unsent ? still(now) : wentOf(still(now)))
      this.#refresh()
    }
  }

  /** The message sent as `command` as it is kept now. */
  #latest(command: string): Wait | undefined {
    const text = this.#storage.read().get(MESSAGE + command)
    return text === undefined ? undefined : waitOf(text)
  }

  /** Every message as it is kept now. */
  #latestAll(): Wait[] {
    return [...this.#storage.read()]
      .filter(([key]) => key.startsWith(MESSAGE))
      .flatMap(([, text]) => waitOf(text) ?? [])
  }

  #put(wait: Wait): void {
    this.#storage.write(MESSAGE + wait.call.command, JSON.stringify(wait))
  }

  /** Changes one that waits, as it is kept now, neither on its way nor
   * gone once; whether it did. */
  #change(command: string, to: (wait: Wait) => Wait): boolean {
    const wait = this.#latest(command)
    if (!wait || wait.going || wait.went) return false
    this.#put(to(wait))
    this.#refresh()
    return true
  }

  #holds(wait: Wait): boolean {
    const command = wait.call.command
    return (
      this.#held.has(command) || (this.#others.get(command) ?? 0) > this.#now()
    )
  }

  /**
   * Reads what is kept again, as this window or another changed it: the
   * messages, told only as they or what holds them changed; what the
   * other windows hold and show; and what came back handed to this
   * window, which it takes. The main window's clock is set again for the
   * first that is past its time.
   */
  #refresh({ arm = true }: { arm?: boolean } = {}): void {
    const waits: Wait[] = []
    const read = new Map<string, { text: string; wait: Wait }>()
    const others = new Map<string, number>()
    const elsewhere = new Map<string, readonly string[]>()
    const told: [string, Told][] = []
    for (const [key, text] of this.#storage.read()) {
      if (key.startsWith(MESSAGE)) {
        const was = this.#read.get(key)
        const wait = was?.text === text ? was.wait : waitOf(text)
        if (!wait) continue
        read.set(key, { text, wait })
        waits.push(wait)
      } else if (key.startsWith(WINDOW)) {
        const doing = doingOf(text)
        if (!doing || key === WINDOW + this.#id) continue
        for (const [command, until] of Object.entries(doing.held))
          others.set(command, Math.max(until, others.get(command) ?? 0))
        elsewhere.set(key.slice(WINDOW.length), doing.shows)
      } else if (key.startsWith(TOLD)) {
        const one = toldOf(text)
        if (one && this.#mine(one)) told.push([key, one])
      }
    }
    waits.sort(
      (a, b) => a.seq - b.seq || (a.call.command < b.call.command ? -1 : 1)
    )
    this.#read = read
    const held = !sameHolds(this.#others, others)
    this.#others = others
    this.#elsewhere = elsewhere
    for (const [key, one] of told) this.#give(key, one.back, one.to)
    if (held || !sameEach(this.get(), waits)) this.#waits.set(waits)
    if (arm) this.#arm()
  }

  /** Whether what came back, handed to `to`, is this window's to give. */
  #mine({ to }: Told): boolean {
    return to === this.#id || (this.drains && to === MAIN)
  }

  /** Gives `back`, kept under `key` as handed to `to`, if at all, to the
   * first listener here that takes it, and forgets it then. One none
   * takes is kept there for the main window until one of its listeners
   * does: it leaves the storage only once taken. */
  #give(key: string, back: Back, to?: string): void {
    if (this.#offer(back)) this.#storage.write(key, null)
    else if (to !== MAIN)
      this.#storage.write(key, JSON.stringify({ to: MAIN, back }))
  }

  /** Tells the first listener that takes `back`; whether one did. */
  #offer(back: Back): boolean {
    for (const listener of this.#first) if (listener(back)) return true
    for (const [listener, item] of this.#panes)
      if (item === back.wait.item && listener(back)) return true
    return false
  }

  /** Takes the message sent as `command` out, and gives it back: to the
   * window that shows its Thread, where only another one does. */
  #back(command: string, why: Why): void {
    const wait = this.#latest(command)
    if (!wait) return
    const back: Back = { wait, why, machine: this.#named(wait.host) }
    const there = this.#showing(wait.item)
    const key = TOLD + command
    if (there === undefined) this.#give(key, back)
    else {
      this.#storage.write(key, JSON.stringify({ to: there, back }))
      this.#awaitTaken(key)
    }
    this.#storage.write(MESSAGE + command, null)
    this.#refresh()
  }

  /** Gives what came back, handed to another window under `key`, here,
   * once, where that window has not taken it in a while: it went, or
   * broke. */
  #awaitTaken(key: string): void {
    if (this.#handed.has(key)) return
    this.#handed.set(
      key,
      setTimeout(() => {
        this.#handed.delete(key)
        const text = this.#storage.read().get(key)
        const told = text === undefined ? undefined : toldOf(text)
        if (told && !this.#mine(told)) this.#give(key, told.back, told.to)
      }, CLAIM)
    )
  }

  /** The other window that shows `item`, where none of this window's
   * Panes does. */
  #showing(item: string): string | undefined {
    if ([...this.#panes.values()].includes(item)) return undefined
    for (const [window, shows] of this.#elsewhere)
      if (shows.includes(item)) return window
    return undefined
  }

  /** Gives back each that waits past its time, not on its way, as it is
   * kept now: one on its way waits for its host's answer. */
  #expire(): void {
    if (!this.drains) return
    const now = this.#now()
    for (const one of this.get()) {
      if (one.going || this.#holds(one)) continue
      const wait = this.#latest(one.call.command)
      if (wait && !wait.going && now >= wait.until)
        this.#back(wait.call.command, { kind: wait.went ? "went" : "expired" })
    }
  }

  /** Tells who follows what waits that one may go now, or come back, as
   * a hold was let go. */
  #nudge(): void {
    this.#waits.set([...this.get()])
    this.#arm()
  }

  /** Sets the main window's clock for the first that waits to be past its
   * time, or for when another window's hold on one lapses. */
  #arm(): void {
    clearTimeout(this.#timer)
    if (!this.drains) return
    const now = this.#now()
    const next = Math.min(
      ...this.get()
        .filter((wait) => !wait.going && !this.#held.has(wait.call.command))
        .map((wait) => {
          const held = this.#others.get(wait.call.command) ?? 0
          return held > now ? held : wait.until
        })
    )
    if (next === Infinity) return
    this.#timer = setTimeout(
      () => {
        this.#expire()
        this.#nudge()
      },
      Math.max(0, next - now)
    )
  }

  /** Says, for the main window, what this one holds, each until a while
   * from now, and which Items its Panes show; again before a hold lapses,
   * while it holds any. The main window says nothing. */
  #publish(): void {
    if (this.drains) return
    clearTimeout(this.#saying)
    const key = WINDOW + this.#id
    const shows = [...new Set(this.#panes.values())]
    if (this.#held.size === 0 && shows.length === 0)
      return this.#storage.write(key, null)
    const now = this.#now()
    const doing: Doing = {
      at: now,
      held: Object.fromEntries(
        [...this.#held.keys()].map((command) => [command, now + HOLD])
      ),
      shows,
    }
    this.#storage.write(key, JSON.stringify(doing))
    if (this.#held.size > 0)
      this.#saying = setTimeout(() => this.#publish(), HOLD_AGAIN)
  }

  /** As the main window starts: what was on its way as the last one went
   * may have gone through; what is no message, and what a window said it
   * did, or what came back, longer ago than a message waits, are let go. */
  #tidy(): void {
    const now = this.#now()
    for (const [key, text] of this.#storage.read()) {
      if (key.startsWith(MESSAGE)) {
        const wait = waitOf(text)
        if (!wait) this.#storage.write(key, null)
        else if (wait.going) this.#put(wentOf(still(wait)))
      } else if (key.startsWith(TOLD)) {
        const told = toldOf(text)
        if (!told || now - told.back.wait.until > longest())
          this.#storage.write(key, null)
      } else if (key.startsWith(WINDOW)) {
        const doing = doingOf(text)
        if (!doing || now - doing.at > longest()) this.#storage.write(key, null)
      }
    }
  }

  /** As the main window starts: what came back handed to another window,
   * not taken yet, it takes itself unless that window does in a while. */
  #awaitHanded(): void {
    for (const [key, text] of this.#storage.read()) {
      const told = key.startsWith(TOLD) ? toldOf(text) : undefined
      if (told && !this.#mine(told)) this.#awaitTaken(key)
    }
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

/** Whether two windows' holds say the same. */
function sameHolds(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>
): boolean {
  return a.size === b.size && [...a].every(([key, at]) => b.get(key) === at)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Whether `value` is a message as this build keeps it: one broken, or
 * of another build, is not. */
function isWait(value: unknown): value is Wait {
  if (!isObject(value)) return false
  const { call, pane, at, until, notAfter, seq } = value
  return (
    isObject(call) &&
    typeof call.method === "string" &&
    typeof call.command === "string" &&
    isObject(pane) &&
    typeof pane.kind === "string" &&
    ["host", "project", "item", "text"].every(
      (key) => typeof value[key] === "string"
    ) &&
    [at, until, notAfter, seq].every(Number.isFinite) &&
    (until as number) - (at as number) <= longest()
  )
}

/** The message kept as `text`, if it is one. */
function waitOf(text: string): Wait | undefined {
  const value = parsed(text)
  return isWait(value) ? value : undefined
}

/** What a window said it does, kept as `text`, if it is that. */
function doingOf(text: string): Doing | undefined {
  const value = parsed(text)
  if (!isObject(value) || !Number.isFinite(value.at)) return undefined
  const { held, shows } = value
  if (!isObject(held) || !Object.values(held).every(Number.isFinite))
    return undefined
  if (!Array.isArray(shows) || !shows.every((one) => typeof one === "string"))
    return undefined
  return value as Doing
}

/** What came back handed to a window, kept as `text`, if it is that. */
function toldOf(text: string): Told | undefined {
  const value = parsed(text)
  if (!isObject(value) || typeof value.to !== "string") return undefined
  const { back } = value
  if (!isObject(back) || !isWait(back.wait) || !isObject(back.why))
    return undefined
  return typeof back.machine === "string" ? (value as Told) : undefined
}
