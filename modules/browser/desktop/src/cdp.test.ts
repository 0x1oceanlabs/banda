import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { WebContents } from "electron"
import { Dialogs } from "./dialogs"
import { Cdp } from "./cdp"
import { Window } from "@banda/desktop-kit"
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
  const captured: number[] = []
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
      if (method === "Page.captureScreenshot")
        return { data: Buffer.from("chromium capture").toString("base64") }
      if (method === "Runtime.evaluate" && sessionId && sessions.has(sessionId))
        return { result: { value: `${params.expression} in ${sessionId}` } }
      throw new Error(`'${method}' wasn't found`)
    },
  }
  const page = {
    id,
    getURL: () => `https://example.com/${id}`,
    getTitle: () => `Tab ${id}`,
    executeJavaScriptInIsolatedWorld: async () => undefined,
    capturePage: async () => {
      captured.push(id)
      return { toPNG: () => Buffer.from("native viewport") }
    },
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
    captured,
  }
}

/** The tabs' sockets over `pages`; what they tell the Panes goes to
 * `told`. */
function socketsOver(pages: WebContents[], told: BrowserNews[] = []) {
  const tabs = Layer.succeed(Tabs)({
    all: () => pages,
    changes: Stream.never,
    attached: () => {},
    profiled: () => {},
    whose: () => null,
    seen: () => pages,
    lend: () => Effect.void,
    lentTo: () => undefined,
    ended: () => {},
    lends: Stream.never,
    create: () => Effect.never,
    created: () => Effect.void,
    tell: (news) => void told.push(news),
  })
  return Cdp.layer(() => "Banda's browser").pipe(
    Layer.provide(
      Layer.mergeAll(
        Dialogs.layer.pipe(Layer.provideMerge(tabs)),
        Window.layer(() => null)
      )
    )
  )
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
  await new Promise((open, fail) => {
    socket.addEventListener("open", open)
    socket.addEventListener("error", fail)
  })
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

/** Whether a client can open a socket at `url`. */
const opens = (url: string) =>
  Effect.promise(() =>
    connect(url).then(
      ({ socket }) => {
        socket.close()
        return true
      },
      () => false
    )
  )

/** Waits until `done` is so. */
const until = (done: () => boolean) =>
  Effect.promise(async () => {
    while (!done()) await new Promise((wake) => setTimeout(wake, 10))
  })

/** A session of `client` on the tab of `targetId`. */
const sessionOn = (
  client: Awaited<ReturnType<typeof connect>>,
  targetId: string
) =>
  Effect.promise(async () => {
    const answer = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })
    return (answer.result as { sessionId: string }).sessionId
  })

it.live(
  "a tab's socket opens once and sees its tab alone; leaving detaches it",
  () => {
    const one = fakeTab(1)
    const two = fakeTab(2)
    return Effect.gen(function* () {
      const cdp = yield* Cdp
      const address = cdp.tab(1)!
      expect(address).toMatch(
        /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/tab\/[0-9a-f]{48}$/
      )
      // Each socket handed out has an address of its own.
      expect(cdp.tab(1)).not.toBe(address)
      // A tab there is not has none.
      expect(cdp.tab(3)).toBeUndefined()
      const [first, second] = yield* Effect.promise(() =>
        Promise.all([connect(address), connect(cdp.tab(1)!)])
      )
      // An address opens once.
      expect(yield* opens(address)).toBe(false)

      // Its one target is its tab.
      const targets = yield* Effect.promise(() =>
        first.send("Target.getTargets")
      )
      expect(targets.result).toEqual({
        targetInfos: [
          {
            targetId: "T1",
            type: "page",
            title: "Tab 1",
            url: "https://example.com/1",
            attached: false,
            canAccessOpener: false,
            browserContextId: "banda",
          },
        ],
      })
      // Another tab, known by its target, is not there to it.
      yield* Effect.promise(async () => {
        const two = await connect(cdp.tab(2)!)
        await two.send("Target.getTargets")
        two.socket.close()
      })
      const other = yield* Effect.promise(() =>
        first.send("Target.attachToTarget", { targetId: "T2", flatten: true })
      )
      expect(other.error).toEqual({
        code: -32000,
        message: "No target with given id found",
      })
      expect(two.sessions.size).toBe(0)

      // Two clients on the tab have a session each.
      const mine = yield* sessionOn(first, "T1")
      const theirs = yield* sessionOn(second, "T1")
      expect(mine).not.toBe(theirs)
      expect(one.sessions).toEqual(new Set([mine, theirs]))
      const answer = yield* Effect.promise(() =>
        first.send("Runtime.evaluate", { expression: "1 + 1" }, mine)
      )
      expect(answer.result).toEqual({ result: { value: `1 + 1 in ${mine}` } })
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

      // One leaves: its session goes, the tab stays debugged for the other.
      first.socket.close()
      yield* until(() => !one.sessions.has(mine))
      expect(one.debuggee.isAttached()).toBe(true)
      second.socket.close()
      yield* until(() => !one.debuggee.isAttached())
      expect(one.sessions.size).toBe(0)
    }).pipe(Effect.provide(socketsOver([one.page, two.page])))
  }
)

it.effect("an address not opened within seconds is spent", () => {
  const one = fakeTab(1)
  return Effect.gen(function* () {
    const cdp = yield* Cdp
    const late = cdp.tab(1)!
    yield* TestClock.adjust("9 seconds")
    const soon = cdp.tab(1)!
    yield* TestClock.adjust("1 second")
    expect(yield* opens(late)).toBe(false)
    expect(yield* opens(soon)).toBe(true)
  }).pipe(Effect.provide(socketsOver([one.page])))
})

it.live("no endpoint answers for the whole browser", () => {
  const one = fakeTab(1)
  return Effect.gen(function* () {
    const cdp = yield* Cdp
    const address = cdp.tab(1)!
    const port = new URL(address).port
    const http = `http://127.0.0.1:${port}`
    const secret = address.slice(address.lastIndexOf("/") + 1)
    for (const path of [
      "/json/version",
      "/json/list",
      "/json",
      `/${secret}/json/version`,
      `/${secret}/json/list`,
      `/devtools/tab/1`,
      `/${secret}/devtools/tab/1`,
    ]) {
      const answer = yield* Effect.promise(() => fetch(`${http}${path}`))
      expect(answer.status, path).toBe(404)
    }
    for (const path of [
      `/devtools/browser/banda`,
      `/${secret}/devtools/browser/banda`,
      `/devtools/page/T1`,
      `/${secret}/devtools/page/T1`,
    ])
      expect(yield* opens(`ws://127.0.0.1:${port}${path}`), path).toBe(false)
    // A web page reaches 127.0.0.1 too: a socket answers programs alone.
    const fromPage = yield* Effect.promise(() =>
      fetch(address.replace("ws:", "http:"), {
        headers: { origin: "https://example.com" },
      })
    )
    expect(fromPage.status).toBe(403)
    // Nor does a socket open another tab, or another profile.
    const client = yield* Effect.promise(() => connect(cdp.tab(1)!))
    const made = yield* Effect.promise(() =>
      client.send("Target.createTarget", { url: "https://example.com/" })
    )
    expect(made.error).toEqual({
      code: -32000,
      message: "A tab's socket sees its tab alone.",
    })
    const profile = yield* Effect.promise(() =>
      client.send("Target.createBrowserContext")
    )
    expect(profile.error).toEqual({
      code: -32000,
      message: "A tab's socket makes no profile.",
    })
    client.socket.close()
  }).pipe(Effect.provide(socketsOver([one.page])))
})

it.live(
  "a driven tab is marked and keeps drawing, until the Person stops it",
  () => {
    const one = fakeTab(1)
    const told: BrowserNews[] = []
    return Effect.gen(function* () {
      const cdp = yield* Cdp
      const client = yield* Effect.promise(() => connect(cdp.tab(1)!))
      const sessionId = yield* sessionOn(client, "T1")
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
      const again = yield* sessionOn(client, "T1")
      expect(again).toEqual(expect.any(String))
      client.socket.close()
    }).pipe(Effect.provide(socketsOver([one.page], told)))
  }
)

it.live("a method the browser does not have is refused, as Chrome does", () => {
  const one = fakeTab(1)
  return Effect.gen(function* () {
    const cdp = yield* Cdp
    const client = yield* Effect.promise(() => connect(cdp.tab(1)!))
    const unknown = yield* Effect.promise(() => client.send("Browser.crash"))
    expect(unknown.error).toEqual({
      code: -32601,
      message: "'Browser.crash' wasn't found",
    })
    const notFlat = yield* Effect.promise(() =>
      client.send("Target.setAutoAttach", { autoAttach: true })
    )
    expect(notFlat.error).toMatchObject({ code: -32000 })
    client.socket.close()
  }).pipe(Effect.provide(socketsOver([one.page])))
})

it.live(
  "a viewport PNG uses Banda's native capture; other screenshots stay Chromium's",
  () => {
    const one = fakeTab(1)
    return Effect.gen(function* () {
      const cdp = yield* Cdp
      const client = yield* Effect.promise(() => connect(cdp.tab(1)!))
      const session = yield* sessionOn(client, "T1")
      const image = (params: object) =>
        Effect.promise(() =>
          client.send("Page.captureScreenshot", params, session)
        )
      expect(
        (yield* image({ format: "png", captureBeyondViewport: false })).result
      ).toEqual({ data: Buffer.from("native viewport").toString("base64") })
      for (const params of [
        { format: "png", captureBeyondViewport: true },
        { format: "jpeg" },
      ])
        expect((yield* image(params)).result).toEqual({
          data: Buffer.from("chromium capture").toString("base64"),
        })
      expect(one.captured).toEqual([1])
      client.socket.close()
    }).pipe(Effect.provide(socketsOver([one.page])))
  }
)
