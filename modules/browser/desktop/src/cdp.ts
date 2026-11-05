/**
 * The browser's CDP endpoint (ADR 0013, decision 7; ADR 0020, decision 4).
 * Every Agent on the machine reaches the browser's tabs through it, with
 * any tool that speaks CDP: Playwright's `connectOverCDP`, Playwright
 * MCP's `--cdp-endpoint`, Chrome DevTools MCP's `--browser-url`.
 *
 * It serves on 127.0.0.1 with a random token in its path, and looks like a
 * whole browser whose targets are the tabs and nothing else: never Banda's
 * own page or another window. A tab's `webContents.debugger` is attached
 * while any client uses the tab, and each client's session on it is a
 * Chromium session of its own (`Target.attachToTarget`), so two clients
 * on a tab do not hear each other. A client is a scope, and each of its
 * sessions a scope in it: a client that leaves, by closing or by error,
 * detaches from every tab it used.
 *
 * Banda's own tools for Agents (ADR 0029) connect to it too, each to a
 * socket of one tab's (`tab`): a whole browser whose one target is that
 * tab, so they attach to the tabs a Thread acts on and to no other.
 *
 * The endpoint is written to `browser.json` beside the engine's
 * `engine.json`, readable by the Person alone, and goes when the window
 * closes. `banda browser` prints it.
 */
import { randomBytes } from "node:crypto"
import { rmSync } from "node:fs"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import type { Cause } from "effect"
import {
  Console,
  Context,
  Data,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Option,
  Queue,
  RcMap,
  Schema,
  Scope,
  Stream,
} from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import type { Debugger, WebContents } from "electron"
import { Engine, Refused, Window, writeWhole } from "@banda/desktop-kit"
import { Dialogs } from "./dialogs"
import { type Change, Tabs } from "./tabs"

/** The protocol's version, as Chromium names it. */
const PROTOCOL = "1.3"
/** The browser's one profile, as a browser context. */
const CONTEXT = "banda"
/** The browser's own target. */
const BROWSER = "banda"

/** What the endpoint uses of a tab's web contents. */
type Page = Pick<
  WebContents,
  | "id"
  | "getURL"
  | "getTitle"
  | "capturePage"
  | "executeJavaScriptInIsolatedWorld"
  | "isDestroyed"
  | "setBackgroundThrottling"
  | "reload"
  | "reloadIgnoringCache"
> & {
  readonly debugger: Pick<
    Debugger,
    "attach" | "detach" | "isAttached" | "sendCommand" | "on" | "removeListener"
  >
}

type Params = Record<string, unknown>

/** What a client sends: a command to the browser, or to a session. */
const Command = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Number,
    method: Schema.String,
    params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    sessionId: Schema.optional(Schema.String),
  })
)
const decode = Schema.decodeUnknownOption(Command)
const dialogAnswer = Schema.decodeUnknownOption(
  Schema.Struct({
    accept: Schema.Boolean,
    promptText: Schema.optional(Schema.String),
  })
)

/** What goes to a client: an answer, or an event. */
type Message = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
  sessionId?: string
}

/** A method the endpoint does not have. */
class Unknown extends Data.TaggedError("Unknown")<{
  readonly message: string
}> {}

/** A client of the endpoint, on a socket. */
type Client = {
  send(message: Message): void
  /** Ends the client once what it was sent is written. */
  leave(): void
  readonly scope: Scope.Scope
  /** Whether it hears of tabs as they come and go. */
  discover: boolean
  /** Whether it attaches to each tab as it comes. */
  autoAttach: boolean
  /** Its sessions on tabs, by ID. */
  readonly sessions: Set<string>
  /** The session a page's socket speaks to without naming one. */
  own?: string
  /** The one tab a tab's socket sees; every tab, if none. */
  readonly only?: Page
}

/** Where a session's messages go: a client's session on a tab, which
 * its frames' and workers' sessions share. `scope` holds it. */
type Route = {
  client: Client
  page: Page
  targetId: string
  /** The session's ID; a frame's or a worker's routes to it. */
  root: string
  scope: Scope.Closeable
}

export class Cdp extends Context.Service<
  Cdp,
  {
    /** `http://127.0.0.1:<port>/<token>`, as a CDP client takes it. */
    readonly endpoint: string
    /** Ends every client's sessions on the tab: the Person stops the
     * Agents that drive it. */
    readonly stop: (page: number) => Effect.Effect<void>
    /** Whether an Agent drives the tab now. */
    readonly drives: (page: Page) => boolean
    /** The socket of a browser whose one target is the tab `page`, for
     * Banda's own tools; none for a tab there is not, or while the
     * endpoint is not up. */
    readonly tab: (page: number) => string | undefined
  }
>()("banda/Cdp") {
  /** `userAgent` is the browser's, as its pages send it. */
  static readonly layer = (userAgent: () => string) =>
    Layer.effect(Cdp)(
      Effect.gen(function* () {
        const tabs = yield* Tabs
        const dialogs = yield* Dialogs
        const engine = yield* Engine
        const window = yield* Window
        const token = randomBytes(24).toString("hex")
        /** Every session's route, by its ID. */
        const routes = new Map<string, Route>()
        /** Each tab's target ID, once its debugger said it, and back. */
        const ids = new WeakMap<Page, string>()
        const byTarget = new Map<string, Page>()
        // What Electron's callbacks run stops with the layer.
        const run = yield* FiberSet.makeRuntime()

        /** A message from a tab's debugger, to the client of its session.
         * The debugger's own session hears only when one of the clients'
         * ends. */
        const heard = (
          _event: unknown,
          method: string,
          params: Params,
          sessionId?: string
        ) => {
          const child = typeof params.sessionId === "string" && params.sessionId
          if (!sessionId) {
            if (method === "Target.detachedFromTarget" && child) run(end(child))
            return
          }
          const route = routes.get(sessionId)
          if (!route) return
          if (method === "Target.attachedToTarget" && child)
            routes.set(child, route)
          if (method === "Target.detachedFromTarget" && child)
            routes.delete(child)
          route.client.send({ method, params, sessionId })
        }

        const pageWith = (id: number): Page | undefined =>
          tabs.all().find((each) => each.id === id)
        /** A tab's debugger, attached while a session uses it. */
        const debuggees = yield* RcMap.make({
          lookup: (id: number) =>
            Effect.acquireRelease(
              Effect.tryPromise({
                try: async () => {
                  const page = pageWith(id)
                  if (!page) throw new Error(`There is no tab ${id}.`)
                  page.debugger.attach(PROTOCOL)
                  if (!ids.has(page))
                    try {
                      const { targetInfo } = (await page.debugger.sendCommand(
                        "Target.getTargetInfo"
                      )) as { targetInfo: { targetId: string } }
                      ids.set(page, targetInfo.targetId)
                      byTarget.set(targetInfo.targetId, page)
                    } catch (error) {
                      page.debugger.detach()
                      throw error
                    }
                  // DevTools opened on the tab, or its page crashed: its
                  // sessions end.
                  const gone = () => run(endOn(page))
                  page.debugger.on("message", heard)
                  page.debugger.on("detach", gone)
                  return { page, gone }
                },
                catch: (error) => new Refused({ message: messageOf(error) }),
              }),
              ({ page, gone }) =>
                Effect.sync(() => {
                  page.debugger.removeListener("message", heard)
                  page.debugger.removeListener("detach", gone)
                  if (!page.isDestroyed() && page.debugger.isAttached())
                    page.debugger.detach()
                })
            ),
        })

        /** The tab's target ID; its debugger is asked once. */
        const targetOf = (page: Page) =>
          Effect.suspend(() => {
            const known = ids.get(page)
            if (known) return Effect.succeed(known)
            return Effect.scoped(RcMap.get(debuggees, page.id)).pipe(
              Effect.map(() => ids.get(page)!)
            )
          })
        const infoOf = (page: Page, targetId: string) => ({
          targetId,
          type: "page",
          title: page.getTitle(),
          url: page.getURL(),
          attached: isUsed(page),
          canAccessOpener: false,
          browserContextId: CONTEXT,
        })
        const isUsed = (page: Page, client?: Client) => {
          for (const route of routes.values())
            if (route.page === page && (!client || route.client === client))
              return true
          return false
        }
        /** The tabs an Agent drives, as their Pane was last told. */
        const driven = new WeakSet<Page>()
        /** Tells the tab's Pane whether an Agent drives it, for its mark;
         * a driven tab keeps drawing while the Pane shows another. */
        const drive = (page: Page) => {
          const now = isUsed(page)
          if (page.isDestroyed() || now === driven.has(page)) return
          if (now) driven.add(page)
          else driven.delete(page)
          page.setBackgroundThrottling(!now)
          tabs.tell({ kind: "driven", from: page.id, driven: now })
        }
        /** The tabs `client` sees: every tab, or its socket's one. */
        const seen = (client?: Client): readonly Page[] =>
          client?.only ? [client.only] : tabs.all()
        /** The tabs `client` sees, as targets; one whose debugger refuses
         * is left out. */
        const targets = (client?: Client) =>
          Effect.suspend(() =>
            Effect.forEach(
              seen(client),
              (page) =>
                targetOf(page).pipe(
                  Effect.map((targetId) => ({ page, targetId })),
                  Effect.option
                ),
              { concurrency: "unbounded" }
            )
          ).pipe(Effect.map((found) => found.flatMap(Option.toArray)))
        /** A target `client` sees, by its ID. */
        const targetById = (targetId: unknown, client?: Client) =>
          Effect.gen(function* () {
            if (typeof targetId !== "string")
              return yield* new Refused({ message: "targetId is a string" })
            if (!byTarget.has(targetId)) yield* targets(client)
            const page = byTarget.get(targetId)
            if (page?.isDestroyed()) byTarget.delete(targetId)
            if (!page || page.isDestroyed() || !seen(client).includes(page))
              return yield* new Refused({
                message: "No target with given id found",
              })
            return { page, targetId }
          })

        /** A session of `client`'s on `page`, held in a scope of its own. */
        const attach = (client: Client, page: Page) =>
          Effect.gen(function* () {
            const scope = yield* Scope.fork(client.scope)
            return yield* Effect.gen(function* () {
              yield* RcMap.get(debuggees, page.id)
              const targetId = ids.get(page)!
              const { sessionId } = (yield* Effect.tryPromise({
                try: () =>
                  page.debugger.sendCommand("Target.attachToTarget", {
                    targetId,
                    flatten: true,
                  }),
                catch: (error) => new Refused({ message: messageOf(error) }),
              })) as { sessionId: string }
              const route = { client, page, targetId, root: sessionId, scope }
              routes.set(sessionId, route)
              client.sessions.add(sessionId)
              drive(page)
              yield* Scope.addFinalizer(
                scope,
                Effect.sync(() => {
                  for (const [id, each] of routes)
                    if (each === route) routes.delete(id)
                  client.sessions.delete(sessionId)
                  drive(page)
                  if (!page.isDestroyed() && page.debugger.isAttached())
                    page.debugger
                      .sendCommand("Target.detachFromTarget", { sessionId })
                      .catch(() => {})
                })
              )
              return { sessionId, targetId }
            }).pipe(
              Scope.provide(scope),
              Effect.onError(() => Scope.close(scope, Exit.void))
            )
          })
        /** Attaches `client` to `page`, and tells it so, as Chrome does. */
        const announce = (client: Client, page: Page) =>
          Effect.map(attach(client, page), ({ sessionId, targetId }) => {
            client.send({
              method: "Target.attachedToTarget",
              params: {
                sessionId,
                targetInfo: { ...infoOf(page, targetId), attached: true },
                waitingForDebugger: false,
              },
            })
            return sessionId
          })
        /** Ends a client's session, and tells it so; only `client`'s, if
         * named. */
        const end = (sessionId: string, client?: Client) =>
          Effect.gen(function* () {
            const route = routes.get(sessionId)
            if (!route || route.root !== sessionId) return
            if (client && route.client !== client) return
            yield* Scope.close(route.scope, Exit.void)
            route.client.send({
              method: "Target.detachedFromTarget",
              params: { sessionId, targetId: route.targetId },
            })
            if (route.client.own === sessionId) route.client.leave()
          })
        /** Ends the sessions on `page`; only `client`'s, if named. */
        const endOn = (page: Page, client?: Client) =>
          Effect.forEach(
            [...(client?.sessions ?? routes.keys())].filter(
              (id) => routes.get(id)?.page === page
            ),
            (id) => end(id, client),
            { discard: true }
          )
        const created = (client: Client, page: Page, targetId: string) =>
          client.send({
            method: "Target.targetCreated",
            params: { targetInfo: infoOf(page, targetId) },
          })

        /** What `client` hears as a tab comes or goes. */
        const changed = (client: Client, change: Change) =>
          Effect.gen(function* () {
            const page: Page = change.page
            if (change.kind === "gone") {
              yield* endOn(page, client)
              const targetId = ids.get(page)
              if (client.discover && targetId)
                client.send({
                  method: "Target.targetDestroyed",
                  params: { targetId },
                })
              return
            }
            // Its debugger is held from naming it to attaching to it.
            yield* RcMap.get(debuggees, page.id)
            if (client.discover) created(client, page, ids.get(page)!)
            if (client.autoAttach) yield* announce(client, page)
          }).pipe(Effect.scoped, Effect.ignore)

        const product = `Chrome/${process.versions.chrome}`

        /** A command to the browser itself. Banda keeps its own downloads
         * and the Person's answers to sites, so what would change them is
         * taken and ignored. */
        const browserCommand = (
          client: Client,
          method: string,
          params: Params
        ): Effect.Effect<unknown, Refused | Unknown> => {
          switch (method) {
            case "Browser.getVersion":
              return Effect.sync(() => ({
                protocolVersion: PROTOCOL,
                product,
                revision: "",
                userAgent: userAgent(),
                jsVersion: process.versions.v8,
              }))
            case "Browser.close":
              return Effect.sync(() => {
                client.leave()
                return {}
              })
            case "Browser.setDownloadBehavior":
            case "Browser.grantPermissions":
            case "Browser.resetPermissions":
            case "Target.setRemoteLocations":
              return Effect.succeed({})
            case "Browser.getWindowForTarget":
              return Effect.sync(() => {
                const bounds = window.now()?.getBounds()
                return {
                  windowId: 1,
                  bounds: {
                    left: bounds?.x ?? 0,
                    top: bounds?.y ?? 0,
                    width: bounds?.width ?? 0,
                    height: bounds?.height ?? 0,
                    windowState: "normal",
                  },
                }
              })
            case "Target.getBrowserContexts":
              return Effect.succeed({ browserContextIds: [] })
            case "Target.createBrowserContext":
            case "Target.disposeBrowserContext":
              return Effect.fail(
                new Refused({ message: "Banda's browser has one profile." })
              )
            case "Target.setDiscoverTargets":
              return Effect.gen(function* () {
                client.discover = params.discover === true
                if (!client.discover) return {}
                for (const { page, targetId } of yield* targets(client))
                  created(client, page, targetId)
                return {}
              })
            case "Target.setAutoAttach":
              return Effect.gen(function* () {
                yield* flat(params)
                client.autoAttach = params.autoAttach === true
                if (!client.autoAttach) return {}
                yield* Effect.forEach(
                  seen(client).filter((page) => !isUsed(page, client)),
                  (page) => Effect.ignore(announce(client, page)),
                  { concurrency: "unbounded", discard: true }
                )
                return {}
              })
            case "Target.getTargets":
              return Effect.map(targets(client), (found) => ({
                targetInfos: found.map(({ page, targetId }) =>
                  infoOf(page, targetId)
                ),
              }))
            case "Target.getTargetInfo":
              return params.targetId === undefined
                ? Effect.succeed({
                    targetInfo: {
                      targetId: BROWSER,
                      type: "browser",
                      title: "",
                      url: "",
                      attached: true,
                      canAccessOpener: false,
                    },
                  })
                : Effect.map(
                    targetById(params.targetId, client),
                    ({ page, targetId }) => ({
                      targetInfo: infoOf(page, targetId),
                    })
                  )
            case "Target.attachToTarget":
              return Effect.gen(function* () {
                yield* flat({ ...params, autoAttach: true })
                const { page } = yield* targetById(params.targetId, client)
                return { sessionId: yield* announce(client, page) }
              })
            case "Target.detachFromTarget":
              return Effect.as(end(String(params.sessionId), client), {})
            case "Target.createTarget":
              return Effect.gen(function* () {
                if (client.only)
                  return yield* new Refused({
                    message:
                      "This socket sees one tab: open one on the browser's.",
                  })
                const url = typeof params.url === "string" ? params.url : ""
                const page = yield* tabs.create(url || undefined)
                return { targetId: yield* targetOf(page) }
              })
            case "Target.closeTarget":
              return Effect.map(
                targetById(params.targetId, client),
                ({ page }) => {
                  tabs.tell({ kind: "close", from: page.id })
                  return { success: true }
                }
              )
            case "Target.activateTarget":
              return Effect.map(
                targetById(params.targetId, client),
                ({ page }) => {
                  tabs.tell({ kind: "select", from: page.id })
                  return {}
                }
              )
            default:
              return Effect.fail(
                new Unknown({ message: `'${method}' wasn't found` })
              )
          }
        }

        /** One message from `client`. A command to a session goes to its
         * tab's debugger as it came, so its order holds; one to the browser
         * runs beside the rest, as a tab it opens takes a while. */
        const handle = (client: Client, raw: string) =>
          Effect.suspend(() => {
            const command = Option.getOrUndefined(decode(raw))
            if (!command) {
              client.send({
                error: {
                  code: -32600,
                  message: "A command is {id, method, params, sessionId}.",
                },
              })
              return Effect.void
            }
            const { id, method, params = {} } = command
            const sessionId = command.sessionId ?? client.own
            const answer = (result: unknown) =>
              client.send({ id, result, sessionId })
            const refuse = (code: number, message: string) =>
              client.send({ id, error: { code, message }, sessionId })
            if (sessionId === undefined)
              return Effect.forkIn(
                browserCommand(client, method, params).pipe(
                  Effect.match({
                    onSuccess: answer,
                    onFailure: (error) =>
                      refuse(
                        error._tag === "Unknown" ? -32601 : -32000,
                        error.message
                      ),
                  })
                ),
                client.scope
              )
            const route = routes.get(sessionId)
            if (route?.client !== client) {
              refuse(-32001, "Session with given id not found.")
              return Effect.void
            }
            if (method === "Page.handleJavaScriptDialog") {
              const choice = Option.getOrUndefined(dialogAnswer(params))
              if (!choice) {
                refuse(
                  -32602,
                  "A dialog answer needs accept, a boolean, and optional promptText."
                )
                return Effect.void
              }
              const dialog = dialogs.current(route.page.id)
              if (dialog)
                return dialogs
                  .answer(
                    route.page.id,
                    dialog.id,
                    choice.accept,
                    choice.promptText
                  )
                  .pipe(
                    Effect.match({
                      onSuccess: () => answer({}),
                      onFailure: (error) => refuse(-32000, error.message),
                    })
                  )
            }
            // The tab is the Pane's: closing its page closes the tab.
            if (method === "Page.close") {
              tabs.tell({ kind: "close", from: route.page.id })
              answer({})
              return Effect.void
            }
            // Electron's debugger lets go of a tab its Page.reload
            // reloads: the tab reloads itself, as its Reload button does.
            if (method === "Page.reload") {
              if (params.ignoreCache) route.page.reloadIgnoringCache()
              else route.page.reload()
              answer({})
              return Effect.void
            }
            // Banda's viewport image already has Playwright's masks applied.
            // Electron's native capture keeps the whole visible guest at its
            // current zoom; Chromium's CDP clip mixes CSS and native pixels
            // when a webview is zoomed. Other clients and full-page captures
            // keep the protocol's normal behavior.
            if (
              client.only &&
              method === "Page.captureScreenshot" &&
              params.format === "png" &&
              params.captureBeyondViewport !== true
            ) {
              // A native copy may otherwise return the previous compositor
              // frame, before Playwright's masks were painted.
              // The page's scripts may replace Promise or animation-frame
              // globals; the fixed paint barrier runs in our isolated world
              // (0 is the page, 999 is Electron's preload world).
              route.page
                .executeJavaScriptInIsolatedWorld(1001, [
                  {
                    code: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))",
                  },
                ])
                .then(() => route.page.capturePage())
                .then(
                  (image) => answer({ data: image.toPNG().toString("base64") }),
                  (error: unknown) =>
                    refuse(
                      -32000,
                      `Unable to capture screenshot: ${messageOf(error)}`
                    )
                )
              return Effect.void
            }
            route.page.debugger
              .sendCommand(method, params, sessionId)
              .then(answer, (error: unknown) =>
                refuse(-32000, messageOf(error))
              )
            return Effect.void
          })

        /** Serves a client on `socket`: one of the browser's, of `page`'s
         * alone, or of a browser that sees `only`. */
        const serve = (
          socket: Socket.Socket,
          { page, only }: { page?: Page; only?: Page } = {}
        ) =>
          Effect.gen(function* () {
            const out = yield* Queue.unbounded<string, Cause.Done>()
            const client: Client = {
              send: (message) => {
                if (message.sessionId === client.own) delete message.sessionId
                Queue.offerUnsafe(out, JSON.stringify(message))
              },
              leave: () => Queue.endUnsafe(out),
              scope: yield* Effect.scope,
              discover: false,
              autoAttach: false,
              sessions: new Set(),
              ...(only && { only }),
            }
            // Electron replaces prompt() in the renderer. Its sandboxed shim
            // emits the same protocol events as a native dialog.
            yield* Effect.forkScoped(
              Stream.runForEach(dialogs.changes, (change) =>
                Effect.sync(() => {
                  if (!change.synthetic) return
                  for (const sessionId of client.sessions) {
                    const route = routes.get(sessionId)
                    if (route?.page.id !== change.tab) continue
                    client.send({
                      sessionId,
                      method:
                        change.accepted === undefined
                          ? "Page.javascriptDialogOpening"
                          : "Page.javascriptDialogClosed",
                      params:
                        change.accepted === undefined
                          ? {
                              type: "prompt",
                              message: change.dialog.message,
                              defaultPrompt: change.dialog.default_prompt,
                              url: change.dialog.url,
                              hasBrowserHandler: true,
                            }
                          : {
                              result: change.accepted,
                              userInput: change.text ?? "",
                            },
                    })
                  }
                })
              )
            )
            // A tab's socket hears of its tab alone.
            const changes = only
              ? Stream.filter(tabs.changes, (change) => change.page === only)
              : tabs.changes
            yield* Effect.forkScoped(
              Stream.runForEach(changes, (change) => changed(client, change))
            )
            if (page) client.own = (yield* attach(client, page)).sessionId
            const { write } = yield* socket.writer
            const read = yield* Socket.readerString(socket)
            const reading = Effect.forever(
              Effect.flatMap(read, (messages) =>
                Effect.forEach(messages, (raw) => handle(client, raw), {
                  discard: true,
                })
              )
            )
            const writing = Queue.take(out).pipe(
              Effect.flatMap(write),
              Effect.forever,
              Effect.catch(() => Effect.ignore(write(new Socket.CloseEvent())))
            )
            yield* Effect.raceFirst(reading, writing)
          }).pipe(Effect.scoped, Effect.ignore)

        // The window works without it: a port it could not take is said.
        const listening = yield* NodeHttpServer.make(() => createServer(), {
          port: 0,
          host: "127.0.0.1",
        }).pipe(
          Effect.tapError((error) =>
            Console.error(
              `banda: the browser's CDP endpoint did not start: ${error.message}`
            )
          ),
          Effect.option
        )
        const stop = (id: number) =>
          Effect.suspend(() => {
            const page = pageWith(id)
            return page ? endOn(page) : Effect.void
          })
        const drives = (page: Page) => driven.has(page)
        if (Option.isNone(listening))
          return { endpoint: "", stop, drives, tab: () => undefined }
        const server = listening.value
        const port = "port" in server.address ? server.address.port : 0
        const endpoint = `http://127.0.0.1:${port}/${token}`
        const sockets = endpoint.replace("http:", "ws:")
        const browserSocket = `${sockets}/devtools/browser/${BROWSER}`
        const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]

        yield* server.serve(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            // A web page reaches 127.0.0.1 too, and sends its origin: as
            // Chrome, the endpoint answers programs alone.
            if (
              request.headers.origin !== undefined ||
              !hosts.includes(request.headers.host ?? "")
            )
              return HttpServerResponse.text(
                "Banda's browser answers programs on this machine.",
                {
                  status: 403,
                }
              )
            const path = new URL(request.url, endpoint).pathname
            const prefix = `/${token}/`
            if (!path.startsWith(prefix))
              return HttpServerResponse.empty({ status: 404 })
            const asked = path.slice(prefix.length).replace(/\/$/, "")
            if (asked === "json/version")
              return HttpServerResponse.jsonUnsafe({
                Browser: product,
                "Protocol-Version": PROTOCOL,
                "User-Agent": userAgent(),
                "V8-Version": process.versions.v8,
                "WebKit-Version": "537.36",
                webSocketDebuggerUrl: browserSocket,
              })
            if (asked === "json" || asked === "json/list")
              return HttpServerResponse.jsonUnsafe(
                (yield* targets()).map(({ page, targetId }) => ({
                  description: "",
                  devtoolsFrontendUrl: "",
                  id: targetId,
                  title: page.getTitle(),
                  type: "page",
                  url: page.getURL(),
                  webSocketDebuggerUrl: `${sockets}/devtools/page/${targetId}`,
                }))
              )
            let page: Page | undefined
            let only: Page | undefined
            if (asked.startsWith("devtools/tab/")) {
              only = pageWith(Number(asked.slice("devtools/tab/".length)))
              if (!only) return HttpServerResponse.empty({ status: 404 })
            } else if (asked.startsWith("devtools/page/")) {
              const found = yield* Effect.option(
                targetById(asked.slice("devtools/page/".length))
              )
              if (Option.isNone(found))
                return HttpServerResponse.empty({ status: 404 })
              page = found.value.page
            } else if (!asked.startsWith("devtools/browser/"))
              return HttpServerResponse.empty({ status: 404 })
            yield* serve(yield* request.upgrade, { page, only })
            return HttpServerResponse.empty()
          }).pipe(
            Effect.catch(() =>
              Effect.succeed(HttpServerResponse.empty({ status: 400 }))
            )
          )
        )

        // `banda browser` reads it, from where the engine says; it goes
        // with the window.
        yield* Effect.forkScoped(
          Effect.flatMap(engine.browser, (file) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const said = { endpoint, webSocket: browserSocket, port }
                writeWhole(file, `${JSON.stringify(said)}\n`, 0o600)
              }),
              () => Effect.sync(() => rmSync(file, { force: true }))
            ).pipe(Effect.andThen(Effect.never), Effect.scoped)
          )
        )
        const tab = (page: number) =>
          pageWith(page) ? `${sockets}/devtools/tab/${page}` : undefined
        return { endpoint, stop, drives, tab }
      })
    )
}

/** Refuses a session that is not flat: each message names its session. */
function flat(params: Params): Effect.Effect<void, Refused> {
  return params.autoAttach === true && params.flatten !== true
    ? Effect.fail(
        new Refused({
          message: "Banda's browser speaks flat sessions only: set flatten.",
        })
      )
    : Effect.void
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
