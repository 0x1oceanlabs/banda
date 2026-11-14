/**
 * The page's server: what answers `app://` in the window's own session.
 * Banda's page comes from `app://banda`, the built page's folder and
 * nothing outside it, under a policy that lets it reach the engine, its
 * own files and the frames named here; the picture Banda's glass is made
 * of comes from there too (ADR 0023, ADR 0030). Beside it are the hosts a
 * Pane shows: a file's bytes and the pages among them that run scripts,
 * sandboxed (ADR 0073, decision 5), both relayed to the engine that gave
 * their tokens, this machine's or another's (bytes.ts; ADR 0106, decision
 * 6), and the modules' own, which may ask those two for a page of theirs
 * (`Relayed`), as a Visual another machine's engine keeps. The page is
 * granted one permission: to write to the clipboard.
 *
 * A part of the device's window (ADR 0089, decision 9): nothing asks it
 * anything, so it is a layer with no service, as the system's is
 * (system.ts).
 */
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { type Look as LookValue, WALLPAPER_URL } from "@banda/contract/look"
import {
  type Engine,
  Look,
  type Relayed,
  type Served,
} from "@banda/desktop-kit"
import { Effect, FiberSet, Layer } from "effect"
import { app, net, protocol, session } from "electron"
import { relayed, relayedAs } from "../bytes"
import type { Hosts } from "../hosts"

/** The page's origin; the engine lets it in (kernel/src/api.rs, APP_ORIGIN). */
const ORIGIN = "app://banda"
/**
 * In development, the Vite server's address; the page is served from it.
 * A packaged app ignores it: no other page ever gets the engine.
 */
export const DEV_PAGE = app.isPackaged ? undefined : process.env.BANDA_PAGE
/** Where the windows load the page from. */
export const PAGE = DEV_PAGE ?? `${ORIGIN}/index.html`

/** Whether `url` is of Banda's own page: only it is answered on the
 * bridge, and only its warnings are logged. */
export function fromPage(url: string): boolean {
  if (DEV_PAGE) return url.startsWith(DEV_PAGE)
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`)
}

/** Names `app:` to Chromium as a scheme with origins, before the app is
 * ready, as Electron asks. The page reads the byte host's ranges across
 * origins, as its CORS allows (`corsEnabled`). */
export function appScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/** The page's policy, which lets it show `framed` in a frame. */
export const cspOf = (framed: readonly string[]) =>
  [
    "default-src 'self'",
    // Ghostty draws terminals from WebAssembly that ships with the page.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // An extension's button shows its icon from crx:// (the browser's
    // extensions, @banda/browser-desktop).
    "img-src 'self' data: crx: app://files",
    "media-src 'self' app://files",
    "font-src 'self' data:",
    // The engine; the page's own files, as Ghostty fetches its WebAssembly;
    // and the byte host's ranges, as a PDF is read (ADR 0073, decision 5).
    "connect-src 'self' ws://127.0.0.1:* app://files",
    // The modules' pages a Pane shows in a frame, each on an origin of its
    // own, as a Thread's Visuals (ADR 0037), and a file's page, sandboxed.
    `frame-src ${framed.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ")

/** The file of the built page in `folder` that `address` asks for, its
 * index for the root; none for another host, or a path outside the
 * folder. */
export function fileOf(folder: string, address: string): string | null {
  const url = new URL(address)
  const path = resolve(folder, `.${decodeURIComponent(url.pathname)}`)
  const file = path === folder ? join(folder, "index.html") : path
  return url.host === "banda" && file.startsWith(folder + sep) ? file : null
}

/**
 * The picture Banda's glass is made of: the look's wallpaper, or its dark
 * one when `address` asks for it, and no other file, whatever the address
 * asks (ADR 0023, ADR 0030); none before the first look, or for a look
 * with no picture.
 */
export function pictureOf(
  desk: LookValue["desk"] | undefined,
  address: string
): string | undefined {
  const asked = new URL(address).searchParams.get("of")
  const pictures = [desk?.wallpaper, desk?.wallpaper_dark].flatMap((one) =>
    one ? [one.path] : []
  )
  return pictures.find((path) => path === asked) ?? pictures[0]
}

const missing = () => new Response("Not found", { status: 404 })

/** A file of the machine's, as a page may take it: never sniffed. */
async function served(
  file: string | null | undefined,
  more: Record<string, string> = {}
): Promise<Response> {
  if (!file) return missing()
  const found = await net.fetch(pathToFileURL(file).toString())
  const headers = new Headers(found.headers)
  headers.set("X-Content-Type-Options", "nosniff")
  for (const [name, value] of Object.entries(more)) headers.set(name, value)
  return new Response(found.body, { status: found.status, headers })
}

/**
 * Answers `app://` from the app's start to the end of the layer's scope:
 * the built page in `folder`, the look's wallpaper, the byte host and the
 * sandbox host, and the modules' hosts in `modules`. Electron takes a
 * handler only once the app is ready, so the layer waits for that; it is
 * built before main's first effect has run, so before the first window
 * loads its page (main.ts, `ready`).
 */
export const pageLayer = <R>(folder: string, modules: Served<R>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const look = yield* Look
      const run = yield* FiberSet.makeRuntimePromise<R | Engine | Hosts>()
      /** The byte host and the sandbox host, which ask main for no page. */
      const own: (
        request: Request,
        asks: Relayed
      ) => ReturnType<typeof relayed> = (request) => relayed(request)
      const hosts = new Map(
        Object.entries({ ...modules, files: own, preview: own })
      )
      // The hosts a frame shows: the modules' and the sandbox host. The
      // byte host serves any file, so no frame shows one.
      const csp = cspOf(
        [...Object.keys(modules), "preview"].map((host) => `app://${host}`)
      )
      const answer = (request: Request) => {
        const host = hosts.get(new URL(request.url).host)
        if (host)
          return host(request, (url) =>
            Effect.promise(() => run(relayedAs(request, url)))
          )
        if (request.url.split("?")[0] === WALLPAPER_URL)
          return Effect.flatMap(look.current, (now) =>
            Effect.promise(() => served(pictureOf(now?.desk, request.url)))
          )
        return Effect.promise(() =>
          served(fileOf(folder, request.url), {
            "Content-Security-Policy": csp,
          })
        )
      }
      yield* Effect.promise(() => app.whenReady())
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          protocol.handle("app", (request) => run(answer(request)))
          // The page asks for nothing but to write to the clipboard, as
          // "Copy path" and a terminal's copy do: no camera, no
          // notifications, no location, no reading the clipboard. Its
          // system notifications go through the desktop (the notifications
          // module, `@banda/notifications-desktop`).
          session.defaultSession.setPermissionRequestHandler(
            (_contents, permission, answer) =>
              answer(permission === "clipboard-sanitized-write")
          )
        }),
        () =>
          Effect.sync(() => {
            protocol.unhandle("app")
            session.defaultSession.setPermissionRequestHandler(null)
          })
      )
    })
  )
