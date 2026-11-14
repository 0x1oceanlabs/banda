import { vi } from "vitest"

/** Electron, as the page's server uses it: what handles a scheme, who
 * answers a permission, and the files fetched. */
const electron = vi.hoisted(() => {
  let ready = () => {}
  const whenReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  return {
    ready,
    whenReady,
    handlers: new Map<string, (request: Request) => Promise<Response>>(),
    permission: null as
      | null
      | ((
          contents: unknown,
          permission: string,
          answer: (granted: boolean) => void
        ) => void),
    fetched: [] as string[],
  }
})
vi.mock("electron", () => ({
  app: { isPackaged: true, whenReady: () => electron.whenReady },
  net: {
    fetch: async (url: string) => {
      electron.fetched.push(url)
      return new Response(`the bytes of ${url}`, {
        headers: { "Content-Type": "text/html" },
      })
    },
  },
  protocol: {
    handle: (
      scheme: string,
      handler: (request: Request) => Promise<Response>
    ) => electron.handlers.set(scheme, handler),
    unhandle: (scheme: string) => electron.handlers.delete(scheme),
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (handler: typeof electron.permission) => {
        electron.permission = handler
      },
    },
  },
}))
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, it } from "@effect/vitest"
import type { Look as LookValue } from "@banda/contract/look"
import { Engine, Look, type Served } from "@banda/desktop-kit"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Hosts } from "../hosts"
import { cspOf, fileOf, fromPage, PAGE, pageLayer, pictureOf } from "./page"

const FOLDER = join(sep, "app", "web", "dist")
const fileUrl = (path: string) => pathToFileURL(path).toString()

it("the page is the built page's folder, its index for the root, and nothing outside it", () => {
  expect(fileOf(FOLDER, "app://banda/")).toBe(join(FOLDER, "index.html"))
  expect(fileOf(FOLDER, "app://banda/index.html?x=1")).toBe(
    join(FOLDER, "index.html")
  )
  expect(fileOf(FOLDER, "app://banda/assets/a%20b.js")).toBe(
    join(FOLDER, "assets", "a b.js")
  )
  expect(fileOf(FOLDER, "app://banda/..%2F..%2Fetc/passwd")).toBeNull()
  expect(fileOf(FOLDER, "app://banda/%2e%2e%2fdist-other/x")).toBeNull()
  expect(fileOf(FOLDER, "app://other/index.html")).toBeNull()
})

it("the glass's picture is the look's wallpaper, its dark one when asked, and no other file", () => {
  const desk = {
    wallpaper: { path: "/pictures/day.jpg" },
    wallpaper_dark: { path: "/pictures/night.jpg" },
  } as LookValue["desk"]
  const at = (of?: string) =>
    `app://banda/desk/wallpaper${of ? `?of=${encodeURIComponent(of)}` : ""}`
  expect(pictureOf(desk, at())).toBe("/pictures/day.jpg")
  expect(pictureOf(desk, at("/pictures/night.jpg"))).toBe("/pictures/night.jpg")
  expect(pictureOf(desk, at("/etc/passwd"))).toBe("/pictures/day.jpg")
  expect(pictureOf({} as LookValue["desk"], at("/etc/passwd"))).toBeUndefined()
  expect(pictureOf(undefined, at())).toBeUndefined()
})

it("only Banda's own page is the page, and a packed app loads no other", () => {
  expect(PAGE).toBe("app://banda/index.html")
  expect(fromPage("app://banda")).toBe(true)
  expect(fromPage("app://banda/index.html#pane/p1")).toBe(true)
  expect(fromPage("app://banda.evil/index.html")).toBe(false)
  expect(fromPage("app://visuals/x")).toBe(false)
  expect(fromPage("https://example.com/")).toBe(false)
})

it("the page's policy frames the hosts it is given and no other", () => {
  const policy = cspOf(["app://visuals", "app://preview"])
  expect(policy).toContain("frame-src app://visuals app://preview;")
  expect(policy).toContain("default-src 'self'")
  expect(policy).toContain("frame-ancestors 'none'")
})

/** A look with `wallpaper`, and no engine or other machine to ask. */
const services = (wallpaper: string | null) =>
  Layer.mergeAll(
    Layer.succeed(Look)({
      current: Effect.succeed(
        wallpaper === null
          ? null
          : ({ desk: { wallpaper: { path: wallpaper } } } as LookValue)
      ),
      changes: Stream.empty,
    }),
    Layer.succeed(Engine)({} as Engine["Service"]),
    Layer.succeed(Hosts)({} as Hosts["Service"])
  )

/** A module's host, which says what it was asked. */
const modules: Served<never> = {
  visuals: (request) =>
    Effect.succeed(new Response(`a visual: ${request.url}`)),
}

const ask = (url: string) => {
  const handler = electron.handlers.get("app")
  if (!handler) throw new Error("nothing answers app://")
  return Effect.promise(() => handler(new Request(url)))
}

it.live(
  "app:// is answered once the app is ready, and until main's runtime is disposed",
  () =>
    Effect.gen(function* () {
      const layer = pageLayer(FOLDER, modules).pipe(
        Layer.provide(services("/pictures/day.jpg"))
      )
      const built = yield* Effect.forkChild(
        Effect.gen(function* () {
          // The page, under its policy, never sniffed.
          const page = yield* ask("app://banda/index.html")
          expect(yield* Effect.promise(() => page.text())).toBe(
            `the bytes of ${fileUrl(join(FOLDER, "index.html"))}`
          )
          expect(page.headers.get("X-Content-Type-Options")).toBe("nosniff")
          expect(page.headers.get("Content-Security-Policy")).toContain(
            "frame-src app://visuals app://preview;"
          )
          // Nothing outside its folder.
          const outside = yield* ask("app://banda/..%2F..%2Fetc/passwd")
          expect(outside.status).toBe(404)
          // The wallpaper, with no policy of the page's.
          const picture = yield* ask(
            "app://banda/desk/wallpaper?of=%2Fetc%2Fpasswd"
          )
          expect(yield* Effect.promise(() => picture.text())).toBe(
            `the bytes of ${fileUrl("/pictures/day.jpg")}`
          )
          expect(picture.headers.get("X-Content-Type-Options")).toBe("nosniff")
          expect(picture.headers.get("Content-Security-Policy")).toBeNull()
          // A module's host answers for itself.
          const visual = yield* ask("app://visuals/v1/index.html")
          expect(yield* Effect.promise(() => visual.text())).toBe(
            "a visual: app://visuals/v1/index.html"
          )
          // The page may write to the clipboard, and nothing else.
          const granted = (permission: string) => {
            let said: boolean | undefined
            electron.permission?.(null, permission, (yes) => {
              said = yes
            })
            return said
          }
          expect(granted("clipboard-sanitized-write")).toBe(true)
          expect(granted("clipboard-read")).toBe(false)
          expect(granted("notifications")).toBe(false)
          expect(granted("media")).toBe(false)
        }).pipe(Effect.provide(layer))
      )
      // Electron takes a handler only once the app is ready.
      yield* Effect.sleep("20 millis")
      expect(electron.handlers.has("app")).toBe(false)
      expect(electron.permission).toBeNull()
      electron.ready()
      yield* Fiber.join(built)
      expect(electron.handlers.has("app")).toBe(false)
      expect(electron.permission).toBeNull()
      expect(electron.fetched).toEqual([
        fileUrl(join(FOLDER, "index.html")),
        fileUrl("/pictures/day.jpg"),
      ])
    })
)

it.live("before the first look there is no wallpaper", () =>
  Effect.gen(function* () {
    const picture = yield* ask("app://banda/desk/wallpaper")
    expect(picture.status).toBe(404)
  }).pipe(
    Effect.provide(
      pageLayer(FOLDER, modules).pipe(Layer.provide(services(null)))
    )
  )
)
