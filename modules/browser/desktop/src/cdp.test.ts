import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import type { WebContents } from "electron"
import { Dialogs } from "./dialogs"
import { Cdp } from "./cdp"
import { Engine, Window } from "@banda/desktop-kit"
import { Tabs } from "./tabs"

type Listener = (...args: unknown[]) => void
/** What the desktop tells the browser's Panes. */
type BrowserNews = Parameters<Tabs["Service"]["tell"]>[0]

/**
 * A tab whose debugger answers as Chromium's does, in short: its target
 * ID, a session of its own for each `Target.attachToTarget`, and
 * `Runtime.evaluate` with the session it came in.
 */
function fakeTab(id: number) {
  const listeners = new Map<string, Set<Listener>>()
  /** Whether it may slow down while hidden, as it was last set. */
  const throttled: boolean[] = []
  /** How it was reloaded, each time. */
  const reloaded: string[] = []
  const sessions = new Set<string>()
  let attached = false
  let made = 0
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.forEach((listener) => listener({}, ...args))
  const debuggee = {
    attach: () => {
      if (attached) throw new Error("Debugger is already attached")
      attached = true
    },
    detach: () => {
      attached = false
    },
    isAttached: () => attached,
    on: (event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return debuggee
    },
    removeListener: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
      return debuggee
    },
    sendCommand: async (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string
    ) => {
      if (!attached) throw new Error("Debugger is not attached")
      if (method === "Target.getTargetInfo")
        return { targetInfo: { targetId: `T${id}` } }
      if (method === "Target.attachToTarget") {
        const session = `S${id}.${++made}`
        sessions.add(session)
        return { sessionId: session }
      }
      if (method === "Target.detachFromTarget") {
        sessions.delete(String(params.sessionId))
        return {}
      }
      if (method === "Runtime.evaluate" && sessionId && sessions.has(sessionId))
        return { result: { value: `${params.expression} in ${sessionId}` } }
      throw new Error(`'${method}' wasn't found`)
    },
  }
  const page = {
    id,
    getURL: () => `https://example.com/${id}`,
    getTitle: () => `Tab ${id}`,
    isDestroyed: () => false,
    setBackgroundThrottling: (allowed: boolean) => throttled.push(allowed),
    reload: () => reloaded.push("reload"),
    reloadIgnoringCache: () => reloaded.push("ignoring cache"),
    debugger: debuggee,
  }
  return {
    page: page as unknown as WebContents,
    sessions,
    emit,
    debuggee,
    throttled,
    reloaded,
  }
}

/** The endpoint over `pages`, its file in a folder of its own; what it
 * tells the Panes goes to `told`. */
function endpointOver(pages: WebContents[], told: BrowserNews[] = []) {
  const file = join(mkdtempSync(join(tmpdir(), "banda-cdp-")), "browser.json")
  const tabs = Layer.succeed(Tabs)({
    all: () => pages,
    changes: Stream.never,
    attached: () => {},
    create: () => Effect.never,
    created: () => Effect.void,
    tell: (news) => void told.push(news),
  })
  const engine = Layer.succeed(Engine)({
    address: Effect.never,
    client: Effect.never,
    door: Effect.never,
    browser: Effect.succeed(file),
  })
  const layer = Cdp.layer(() => "Banda's browser").pipe(
    Layer.provide(
      Layer.mergeAll(
        Dialogs.layer.pipe(Layer.provideMerge(tabs)),
        engine,
        Window.layer(() => null)
      )
    )
  )
  return { file, layer }
}

/** A CDP client on `url`: what it sends, and what it hears. */
async function connect(url: string) {
  const socket = new WebSocket(url)
  const heard: Record<string, unknown>[] = []
  const waiting = new Set<() => void>()
  socket.addEventListener("message", (event) => {
    heard.push(JSON.parse(String(event.data)))
    for (const wake of waiting) wake()
  })
  await new Promise((open) => socket.addEventListener("open", open))
  let id = 0
  /** The first message `match` takes, waiting for it. */
  const hear = (match: (message: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((done) => {
      const look = () => {
        const found = heard.find(match)
        if (!found) return
        waiting.delete(look)
        done(found)
      }
      waiting.add(look)
      look()
    })
  return {
    socket,
    hear,
    send: (method: string, params = {}, sessionId?: string) => {
      const sent = ++id
      socket.send(JSON.stringify({ id: sent, method, params, sessionId }))
      return hear((message) => message.id === sent)
    },
  }
}

/** Waits until `done` is so. */
const until = (done: () => boolean) =>
  Effect.promise(async () => {
    while (!done()) await new Promise((wake) => setTimeout(wake, 10))
  })

const versionOf = (endpoint: string) =>
  Effect.promise(async () => {
    const answer = await fetch(`${endpoint}/json/version`)
    return (await answer.json()) as { webSocketDebuggerUrl: string }
  })

it.live(
  "each client has a session of its own on a tab, and leaving detaches it",
  () => {
    const one = fakeTab(1)
    const { layer, file } = endpointOver([one.page])
    return Effect.gen(function* () {
      const { endpoint } = yield* Cdp
      // The file says the endpoint, to the Person alone.
      yield* until(() => existsSync(file))
      expect(JSON.parse(readFileSync(file, "utf8")).endpoint).toBe(endpoint)
      expect(statSync(file).mode & 0o777).toBe(0o600)

      const { webSocketDebuggerUrl } = yield* versionOf(endpoint)
      const [first, second] = yield* Effect.promise(() =>
        Promise.all([
          connect(webSocketDebuggerUrl),
          connect(webSocketDebuggerUrl),
        ])
      )
      const sessionOf = (client: typeof first) =>
        Effect.promise(async () => {
          await client.send("Target.setAutoAttach", {
            autoAttach: true,
            flatten: true,
            waitForDebuggerOnStart: true,
          })
          const attached = await client.hear(
            (message) => message.method === "Target.attachedToTarget"
          )
          return (attached.params as { sessionId: string }).sessionId
        })
      const mine = yield* sessionOf(first)
      const theirs = yield* sessionOf(second)
      expect(mine).not.toBe(theirs)
      expect(one.sessions).toEqual(new Set([mine, theirs]))

      const answer = yield* Effect.promise(() =>
        first.send("Runtime.evaluate", { expression: "1 + 1" }, mine)
      )
      expect(answer).toEqual({
        id: 2,
        result: { result: { value: `1 + 1 in ${mine}` } },
        sessionId: mine,
      })
      // The tab reloads itself: Electron's debugger lets go of a tab its
      // Page.reload reloads.
      yield* Effect.promise(() => first.send("Page.reload", {}, mine))
      yield* Effect.promise(() =>
        first.send("Page.reload", { ignoreCache: true }, mine)
      )
      expect(one.reloaded).toEqual(["reload", "ignoring cache"])
      expect(one.debuggee.isAttached()).toBe(true)
      // A client cannot speak in another's session.
      const refused = yield* Effect.promise(() =>
        first.send("Runtime.evaluate", { expression: "1" }, theirs)
      )
      expect(refused.error).toEqual({
        code: -32001,
        message: "Session with given id not found.",
      })
      // An event in a session goes to its client alone.
      one.emit("message", "Page.loadEventFired", { timestamp: 1 }, theirs)
      yield* Effect.promise(() =>
        second.hear((message) => message.method === "Page.loadEventFired")
      )
      expect(
        (yield* Effect.promise(() => first.send("Target.getTargets"))).result
      ).toEqual({
        targetInfos: [
          {
            targetId: "T1",
            type: "page",
            title: "Tab 1",
            url: "https://example.com/1",
            attached: true,
            canAccessOpener: false,
            browserContextId: "banda",
          },
        ],
      })

      // One leaves: its session goes, the tab stays debugged for the other.
      first.socket.close()
      yield* until(() => !one.sessions.has(mine))
      expect(one.debuggee.isAttached()).toBe(true)
      second.socket.close()
      yield* until(() => !one.debuggee.isAttached())
      expect(one.sessions.size).toBe(0)
    }).pipe(
      Effect.provide(layer),
      // The file goes with the endpoint.
      Effect.andThen(Effect.sync(() => expect(existsSync(file)).toBe(false)))
    )
  }
)

it.live(
  "a driven tab is marked and keeps drawing, until the Person stops it",
  () => {
    const one = fakeTab(1)
    const told: BrowserNews[] = []
    const { layer } = endpointOver([one.page], told)
    return Effect.gen(function* () {
      const cdp = yield* Cdp
      const { webSocketDebuggerUrl } = yield* versionOf(cdp.endpoint)
      const client = yield* Effect.promise(() => connect(webSocketDebuggerUrl))
      const answer = yield* Effect.promise(() =>
        client.send("Target.attachToTarget", { targetId: "T1", flatten: true })
      )
      const { sessionId } = answer.result as { sessionId: string }
      expect(told).toEqual([{ kind: "driven", from: 1, driven: true }])
      expect(one.throttled).toEqual([false])

      yield* cdp.stop(1)
      const detached = yield* Effect.promise(() =>
        client.hear((message) => message.method === "Target.detachedFromTarget")
      )
      expect(detached.params).toEqual({ sessionId, targetId: "T1" })
      expect(one.sessions.size).toBe(0)
      expect(told.at(-1)).toEqual({ kind: "driven", from: 1, driven: false })
      expect(one.throttled).toEqual([false, true])
      // The client stays, and may drive the tab again.
      const again = yield* Effect.promise(() =>
        client.send("Target.attachToTarget", { targetId: "T1", flatten: true })
      )
      expect(again.result).toMatchObject({ sessionId: expect.any(String) })
      client.socket.close()
    }).pipe(Effect.provide(layer))
  }
)

it.live("a method the browser does not have is refused, as Chrome does", () => {
  const { layer } = endpointOver([])
  return Effect.gen(function* () {
    const { endpoint } = yield* Cdp
    const { webSocketDebuggerUrl } = yield* versionOf(endpoint)
    const client = yield* Effect.promise(() => connect(webSocketDebuggerUrl))
    const unknown = yield* Effect.promise(() => client.send("Browser.crash"))
    expect(unknown.error).toEqual({
      code: -32601,
      message: "'Browser.crash' wasn't found",
    })
    const profile = yield* Effect.promise(() =>
      client.send("Target.createBrowserContext")
    )
    expect(profile.error).toEqual({
      code: -32000,
      message: "Banda's browser has one profile.",
    })
    const notFlat = yield* Effect.promise(() =>
      client.send("Target.setAutoAttach", { autoAttach: true })
    )
    expect(notFlat.error).toMatchObject({ code: -32000 })
    client.socket.close()
  }).pipe(Effect.provide(layer))
})
