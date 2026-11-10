/**
 * The Pane kit (ADR 0106, laws 4, 5 and 6): what a kind of Pane that
 * opens on another machine (`PaneKind.elsewhere`) must do whatever its
 * machine does. The kind is mounted in a stand-in of the Frame, given a
 * recording session to arc, and played five ways: arc live, away before
 * an act, away with an act in flight, back with a new `boot`, as after
 * Banda restarted there, and on an older build of arc that lacks the
 * methods the kind asks for. Away is as the hosts router makes it: the
 * session's `Engine.away`, as once the window knows arc is away, not a
 * link that only dropped. In each, every gesture the Person can make in
 * it is made, and the kit says what the kind did wrong, in words:
 *
 * - **Nothing hangs without words.** What a gesture asks of its session
 *   is one act (law 4): each call, command and stream heard `once` ends,
 *   done, refused or `may_have_run`. One may wait only where the Pane says
 *   so in its own words, naming the machine it waits for, as "send when
 *   back" does. A read made outside a gesture may wait while arc is away:
 *   the Frame's pill says why. A refusal the kind leaves unhandled is
 *   said nowhere, so it counts too.
 * - **One pill, the Frame's.** The platform watches the link (law 5): the
 *   Frame alone says that arc is away. A Pane that draws a pill of its
 *   own, or a line that says only the pill's words, draws a second. Words
 *   that say what became of an act ("Not sent: arc is away") are no pill:
 *   they are what the first rule asks for.
 *
 * The session is the real `Engine`, over a WebSocket the kit plays the
 * engine's side of, so its rules for what fails at once and what waits
 * are the client's own. The kind's engine part answers by `answers`.
 * Mounting needs a DOM: the tests that use the kit run in happy-dom
 * (`// @vitest-environment happy-dom`). For tests alone.
 */
/// <reference types="node" />
import {
  Engine,
  type JsonValue,
  type ProjectId,
  type Refusal,
  Unreachable,
} from "@banda/contract"
import {
  act,
  type ComponentType,
  createElement,
  type ReactNode,
  useSyncExternalStore,
} from "react"
import { createRoot } from "react-dom/client"
import type { PaneKind, PaneProps } from "../pane"

/** The other machine, as the kit names it. */
export const MACHINE = "arc"

/** What the Frame's pill says while arc is away, as the core's
 * `reachWords` says it. */
export const AWAY = `${MACHINE} is away`

/** How the kit plays arc's link around a gesture. */
export type Scenario =
  | "live"
  | "away before an act"
  | "away with an act in flight"
  | "back with a new boot"
  | "arc lacks the method"

export const SCENARIOS: readonly Scenario[] = [
  "live",
  "away before an act",
  "away with an act in flight",
  "back with a new boot",
  "arc lacks the method",
]

/** What a kind's engine part answers a call or a stream, by method and
 * params: a call's answer; a stream's pieces, after which it ends, or
 * none to keep it open. A refusal thrown is the engine's refusal. */
export type Answers = (
  method: string,
  params: JsonValue
) => JsonValue | JsonValue[] | undefined

/** What the Person does in a mounted Pane: one gesture. */
export type Gesture = (pane: Mounted) => void | Promise<void>

/** A Pane the kit mounted, for a gesture to act on. */
export type Mounted = {
  /** What the Pane draws, without the Frame around it. */
  readonly root: HTMLElement
  /** Clicks the Pane's button of that name: its words, or its label. */
  click(name: string): void
}

/** What the kit plays a kind with. */
export type Conformance<A extends { [key: string]: JsonValue }> = {
  kind: PaneKind<A>
  /** Its args: the kind's `start` by default. */
  args?: A
  project?: ProjectId
  /** The modules arc runs: the kind's own by default. */
  modules?: readonly string[]
  answers?: Answers
  /** What the Person can do in it, by name: by default, a click on each
   * button it draws once mounted. */
  gestures?: Readonly<Record<string, Gesture>>
}

/** One thing a kind asked of its session. */
type Asked = {
  method: string
  /** A gesture's part, which must end, rather than a read. */
  act: boolean
  /** How it ended: none while it waits. */
  ended?: string
}

/**
 * The kit's side of the engine: a WebSocket the real `Engine` opens, which
 * answers its hello with a welcome, its calls by `answers`, and holds
 * them while `holding`, so an act is in flight. While `lacking` it is an
 * older build, which refuses every method as the engine refuses one it
 * does not have.
 */
class Side {
  boot = 1
  holding = false
  lacking = false
  socket: Socket | null = null
  readonly modules: readonly string[]
  readonly answers: Answers
  constructor(modules: readonly string[], answers: Answers) {
    this.modules = modules
    this.answers = answers
  }
  /** What the engine says to `frame`, the client's. */
  heard(socket: Socket, frame: { [key: string]: JsonValue }) {
    const id = frame.id as number
    if (frame.type === "hello")
      return socket.say({
        type: "welcome",
        protocol: 1,
        engine: "kit",
        modules: [...this.modules],
        boot: String(this.boot),
      })
    if (frame.type !== "call" && frame.type !== "stream") return
    if (this.holding) return
    if (this.lacking)
      return socket.say({
        type: "result",
        id,
        error: {
          code: "invalid",
          message: `There is no method "${String(frame.method)}".`,
        },
      })
    let answer: JsonValue | JsonValue[] | undefined
    try {
      answer = this.answers(frame.method as string, frame.params ?? null)
    } catch (error) {
      const refusal = error as Refusal
      return socket.say({ type: "result", id, error: refusal })
    }
    if (frame.type === "call")
      return socket.say({ type: "result", id, ok: answer ?? null })
    if (!Array.isArray(answer)) return
    for (const data of answer) socket.say({ type: "piece", stream: id, data })
    socket.say({ type: "ended", stream: id })
  }
}

/** Each side the kit plays, by the address its Engine asks for. */
const sides = new Map<string, Side>()

/** The WebSocket the kit puts in the page's place while it plays. */
class Socket {
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readonly side: Side | undefined
  open = true
  constructor(url: string) {
    this.side = sides.get(url)
    if (this.side) this.side.socket = this
    // The Engine sets its handlers once it has made it.
    queueMicrotask(() => this.onopen?.())
  }
  send(text: string) {
    if (this.open) this.side?.heard(this, JSON.parse(text))
  }
  close() {
    if (!this.open) return
    this.open = false
    this.onclose?.()
  }
  say(frame: object) {
    const text = JSON.stringify(frame)
    queueMicrotask(() => this.open && this.onmessage?.({ data: text }))
  }
}

/**
 * A session to arc that notes what its Pane asks: the real `Engine` over
 * the kit's side, wrapped so that each call, command and stream is noted
 * with how it ends. An act is a command, a stream heard `once`, and a
 * call made while `gesture` holds, as a gesture is one act (law 4); a
 * call made outside one, a stream that watches and a follow are reads.
 */
function recording(side: Side, url: string) {
  sides.set(url, side)
  const engine = new Engine(async () => ({ url, secret: "kit" }), {
    unreachable: () => new Unreachable(MACHINE, AWAY),
  })
  const asked: Asked[] = []
  // `over` once the kit lets the kind go: what the Engine fails as it
  // closes is the kit's doing, not the kind's.
  const state = { gesture: false, over: false }
  const note = (method: string, act: boolean): Asked => {
    const one: Asked = { method, act }
    asked.push(one)
    return one
  }
  // The kind gets a promise of its own, so one it leaves unhandled is
  // unhandled still; the kit reads how the Engine's ended.
  const ending = <T>(one: Asked, promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) =>
      promise.then(
        (value) => {
          one.ended = "done"
          resolve(value)
        },
        (error: Error) => {
          if (state.over) return
          one.ended =
            error instanceof Unreachable
              ? error.may_have_run
                ? "may_have_run"
                : "refused"
              : error.name
          reject(error)
        }
      )
    )
  const session = new Proxy(engine, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown
      if (typeof value !== "function") return value
      const own = value as (...args: unknown[]) => unknown
      switch (key) {
        case "call":
          return (...args: unknown[]) =>
            ending(
              note(args[0] as string, state.gesture),
              own.apply(target, args) as Promise<unknown>
            )
        case "command":
        case "commandAt":
          return (...args: unknown[]) =>
            ending(
              note(args[0] as string, true),
              own.apply(target, args) as Promise<unknown>
            )
        case "run":
          return (...args: unknown[]) =>
            ending(
              note((args[0] as { method: string }).method, true),
              own.apply(target, args) as Promise<unknown>
            )
        case "stream":
          return (...args: unknown[]) => {
            // A stream that does something is heard once, and ends; one
            // that watches never does while it is heard, a gesture's too.
            const options = args[5] as { once?: boolean } | undefined
            const one = note(args[1] as string, options?.once === true)
            if (!one.act) one.ended = "watching"
            const onEnd = args[4] as (refusal?: Refusal) => void
            args[4] = (refusal?: Refusal) => {
              if (state.over) return
              one.ended = refusal?.code ?? "ended"
              onEnd(refusal)
            }
            return own.apply(target, args)
          }
        default:
          return own.bind(target)
      }
    },
  })
  return { engine, session, asked, state }
}

/** The Frame's stand-in: its pill above the Pane while arc is away. */
function Frame({
  link,
  children,
}: {
  link: Link
  children: ReactNode
}): ReactNode {
  const away = useSyncExternalStore(link.follow, link.away)
  return createElement(
    "section",
    { "data-kit-frame": "" },
    away && createElement("div", { "data-pill": "", role: "status" }, AWAY),
    createElement("div", { "data-kit-pane": "" }, children)
  )
}

/** Whether arc is away, as the Frame reads it. */
class Link {
  #away = false
  readonly #heard = new Set<() => void>()
  readonly follow = (heard: () => void) => {
    this.#heard.add(heard)
    return () => void this.#heard.delete(heard)
  }
  readonly away = () => this.#away
  set(away: boolean) {
    this.#away = away
    for (const heard of this.#heard) heard()
  }
}

/** Lets what was started run out: the Engine's microtasks, its timers of
 * no delay, and what React draws of them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn++)
      await new Promise((done) => setTimeout(done, 0))
  })
}

/** The name a button goes by: its label, else its words. */
const nameOf = (button: Element) =>
  (button.getAttribute("aria-label") ?? button.textContent ?? "").trim()

/** What an error says. */
const said = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/** Each address the kit gives an Engine: one a session. */
let sessions = 0

/** A kind mounted with a recording session, and how to play its link:
 * to a build of arc that `lacks` the kind's methods, or to one that has
 * them. */
async function mount<A extends { [key: string]: JsonValue }>(
  spec: Conformance<A>,
  lacks: boolean
) {
  const { kind } = spec
  const side = new Side(spec.modules ?? [kind.kind.split(".")[0]], (...ask) =>
    (spec.answers ?? (() => null))(...ask)
  )
  side.lacking = lacks
  const url = `ws://${MACHINE}/kit/${++sessions}`
  const { engine, session, asked, state } = recording(side, url)
  const link = new Link()
  const element = document.createElement("div")
  document.body.append(element)
  const root = createRoot(element)
  const Pane = kind.Pane as ComponentType<PaneProps<A>>
  const props: PaneProps<A> = {
    engine: session,
    project: spec.project ?? ("kit-project" as ProjectId),
    args: spec.args ?? kind.start ?? ({} as A),
    focused: true,
    open: () => undefined,
    update: () => undefined,
    close: () => undefined,
    label: () => undefined,
    run: () => undefined,
  }
  await act(async () =>
    root.render(
      createElement(Frame, { link, children: createElement(Pane, props) })
    )
  )
  await settle()
  const pane = element.querySelector<HTMLElement>("[data-kit-pane]")!
  const mounted: Mounted = {
    root: pane,
    click(name) {
      const button = [...pane.querySelectorAll("button")].find(
        (one) => nameOf(one) === name
      )
      if (!button) throw new Error(`there is no ${name} to click`)
      button.click()
    },
  }
  return {
    mounted,
    asked,
    side,
    state,
    /** arc goes out of reach, as ssh says. */
    away() {
      engine.away(new Unreachable(MACHINE, AWAY))
      link.set(true)
    },
    /** arc is back, its engine started again. */
    back() {
      side.boot++
      link.set(false)
      engine.wake()
    },
    /** The pills the Pane draws of its own, the Frame's aside. */
    pills: () => pillsIn(pane),
    async unmount() {
      state.over = true
      await act(async () => root.unmount())
      engine.close()
      element.remove()
      sides.delete(url)
    },
  }
}

/** Runs `play` with the rejections nobody handles noted in `left`, and
 * no one else's: a refusal the kind drops is the kit's finding, not the
 * test runner's error. */
async function noting(
  left: string[],
  play: () => Promise<void>
): Promise<void> {
  const others = process.listeners("unhandledRejection")
  process.removeAllListeners("unhandledRejection")
  const heard = (reason: unknown) => left.push(said(reason))
  process.on("unhandledRejection", heard)
  try {
    await play()
    // Node tells of a rejection nobody handled once the turn it came in
    // is over.
    for (let turn = 0; turn < 2; turn++)
      await new Promise((done) => setTimeout(done, 0))
  } finally {
    process.off("unhandledRejection", heard)
    for (const other of others) process.on("unhandledRejection", other)
  }
}

/** The pill's words, as the Frame says them, with since when or not:
 * "arc is away", "arc is away · 2 min". */
const pillWords = new RegExp(`^${AWAY}( · .+)?$`)

/** How many pills `root` draws: a `[data-pill]`, or a line that says only
 * the pill's words, each counted once, not again by what holds it. */
function pillsIn(root: HTMLElement): number {
  const pills = [...root.querySelectorAll<HTMLElement>("*")].filter(
    (one) =>
      one.matches("[data-pill]") ||
      pillWords.test((one.textContent ?? "").trim())
  )
  return pills.filter(
    (one) => !pills.some((other) => other !== one && one.contains(other))
  ).length
}

/** Whether the Pane names arc in its own words, as one that says why it
 * waits does: "Sends when arc is back". */
const naming = new RegExp(`\\b${MACHINE}\\b`)

/**
 * What `spec.kind` does wrong when arc is live, away before an act, away
 * with an act in flight, and back with a new `boot`: each in words, which
 * name the kind, the scenario and the gesture. None when it conforms.
 * Each scenario mounts the kind afresh. It installs the kit's WebSocket in
 * the page's place while it plays, and puts the page's back.
 */
export async function conformance<A extends { [key: string]: JsonValue }>(
  spec: Conformance<A>
): Promise<string[]> {
  const kind = spec.kind.kind
  const found = new Set<string>()
  const page = globalThis.WebSocket
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flags.IS_REACT_ACT_ENVIRONMENT = true
  /** Mounts the kind and plays `scenario` around `gesture`, noting what
   * it does wrong; what it leaves unhandled as it mounts is the mount's. */
  const play = async (
    scenario: Scenario,
    name: string,
    gesture: Gesture
  ): Promise<Mounted | undefined> => {
    const at = `${kind}, ${scenario}, ${name}`
    // An older build refuses what the kind asks as it mounts too, so
    // what it leaves unhandled then is that scenario's.
    const lacks = scenario === "arc lacks the method"
    const mounts = lacks
      ? `${kind}, ${scenario}, as it mounts`
      : `${kind}, as it mounts`
    const left: string[] = []
    let mounting = 0
    let kept: Mounted | undefined
    await noting(left, async () => {
      let one: Awaited<ReturnType<typeof mount>> | undefined
      try {
        one = await mount(spec, lacks)
        mounting = left.length
        if (scenario === "away before an act") one.away()
        if (scenario === "back with a new boot") {
          one.away()
          await settle()
          one.back()
        }
        await settle()
        if (scenario === "away with an act in flight") one.side.holding = true
        const before = one.asked.length
        one.state.gesture = true
        const mounted = one.mounted
        await act(async () => gesture(mounted))
        await settle()
        if (scenario === "away with an act in flight") {
          one.away()
          await settle()
        }
        one.state.gesture = false
        // What the Pane says itself, the Frame's pill aside.
        const own = mounted.root.textContent ?? ""
        for (const asked of one.asked.slice(before))
          if (asked.act && asked.ended === undefined && !naming.test(own))
            found.add(
              `${at}: ${asked.method} still waits, and nothing says why`
            )
        if (one.pills() > 0)
          found.add(
            `${at}: says ${MACHINE} is away itself; the one pill is the Frame's`
          )
        kept = mounted
      } catch (error) {
        mounting = one ? mounting : left.length
        found.add(`${at}: ${said(error)}`)
      } finally {
        await one?.unmount()
      }
    })
    left.forEach((message, index) =>
      found.add(
        `${index < mounting ? mounts : at}: leaves "${message}" unhandled`
      )
    )
    return kept
  }
  try {
    // What it can do, as it draws once arc answers: each button, else
    // nothing, so its pill is played all the same.
    let gestures = spec.gestures
    if (!gestures) {
      const buttons: string[] = []
      await play("live", "as it mounts", (pane) => {
        for (const button of pane.root.querySelectorAll("button"))
          if (!button.disabled) buttons.push(nameOf(button))
      })
      gestures = Object.fromEntries(
        buttons.map((name): [string, Gesture] => [
          name,
          (pane) => pane.click(name),
        ])
      )
    }
    const played =
      Object.keys(gestures).length > 0 ? gestures : { nothing: () => undefined }
    for (const scenario of SCENARIOS)
      for (const [name, gesture] of Object.entries(played))
        await play(scenario, name, gesture)
  } finally {
    globalThis.WebSocket = page
  }
  return [...found]
}
