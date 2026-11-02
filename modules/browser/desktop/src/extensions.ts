/**
 * Chrome's extensions in the browser's profile (ADR 0013, decision 6; ADR
 * 0020). `electron-chrome-extensions` gives them Chrome's APIs, and
 * `electron-chrome-web-store` installs them from the Web Store's own page
 * and keeps them updated. They live in the browser's profile only: an
 * extension that filters requests in the default session breaks the main
 * process's `net.fetch`.
 *
 * The tabs are the Panes' pages: the desktop tells an extension of each
 * page as it attaches, and the Pane of the one the Person looks at. What an
 * extension asks of the tabs goes to the Panes as `BrowserNews`.
 */
import { type Box, PARTITION } from "@banda/browser-pane/desktop"
import { Context, Effect, FiberSet, Layer, Schema } from "effect"
import {
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItem,
  session,
  type WebContents,
} from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import {
  installChromeWebStore,
  uninstallExtension,
} from "electron-chrome-web-store"
import { confirm, Refused, Window } from "@banda/desktop-kit"
import { Popup } from "./popup"
import { pageOf, Tabs } from "./tabs"

/** Where a button is in the page, which its popup shows under. */
export const BoxArg = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
}) satisfies Schema.Decoder<Box>

export class Extensions extends Context.Service<
  Extensions,
  {
    /** A page of the browser attached: extensions see it as a tab. */
    attached(page: WebContents): void
    /** The page the Person looks at, by its ID: the extensions' active
     * tab. Another closes the popup, which spoke of the one before. */
    shown(page: number): Effect.Effect<void>
    /** The name of the extension `id`; refused when there is none. */
    named(id: string): Effect.Effect<string, Refused>
    /** What the extensions add to a page's menu. */
    menuItems(page: WebContents, params: ContextMenuParams): MenuItem[]
    /** Removes the extension `id`, once the Person says so; whether it
     * went. */
    remove(id: string): Effect.Effect<boolean, Refused>
    /** Shows the popup `url` of the extension `id` under `under`, or
     * closes it; a popup is a page of the extension's own. */
    popup(id: string, url: string, under: Box): Effect.Effect<void, Refused>
  }
>()("banda/Extensions") {
  static readonly layer = Layer.effect(Extensions)(
    Effect.gen(function* () {
      const window = yield* Window
      const tabs = yield* Tabs
      // What the library's callbacks run stops with the layer.
      const run = yield* FiberSet.makeRuntimePromise()
      const profile = session.fromPartition(PARTITION)
      const popup = new Popup(profile)
      yield* Effect.addFinalizer(() => Effect.sync(() => popup.close()))
      /** The active tab's web contents. */
      let active = -1

      /** The tab an extension asked for, in Banda's window. */
      const create = (url?: string) =>
        Effect.gen(function* () {
          const page = yield* tabs.create(url)
          const opened = window.now()
          if (!opened)
            return yield* new Refused({ message: "Banda's window is closed." })
          return [page, opened] as [WebContents, BrowserWindow]
        })
      const named = (id: string) =>
        Effect.suspend(() => {
          const found = profile.extensions.getExtension(id)
          return found
            ? Effect.succeed(found.name)
            : Effect.fail(
                new Refused({ message: `There is no extension ${id}.` })
              )
        })

      const extensions = new ElectronChromeExtensions({
        session: profile,
        createTab: (details) => run(create(details.url)),
        createWindow: async (details) => {
          const first = [details.url ?? []].flat()[0]
          const [, opened] = await run(create(first))
          return opened
        },
        selectTab: (page) => tabs.tell({ kind: "select", from: page.id }),
        removeTab: (page) => tabs.tell({ kind: "close", from: page.id }),
      })
      // `chrome.action.openPopup()` opens the library's popup, a window of
      // its own that Hyprland would tile: it closes, and the button's
      // opens in the row instead.
      extensions.on("browser-action-popup-created", (opened) =>
        opened.destroy()
      )
      // The row's buttons show the extensions' icons from crx:// URLs.
      ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
      void installChromeWebStore({
        session: profile,
        beforeInstall: async ({ localizedName, manifest }) => ({
          action: (await run(
            confirm(window.now(), {
              message: `Add “${localizedName}” to Banda's browser?`,
              detail: canDo(manifest),
              yes: "Add extension",
              no: "Cancel",
            })
          ))
            ? "allow"
            : "deny",
        }),
      }).catch((error: unknown) =>
        console.error("banda: the Chrome Web Store did not start:", error)
      )

      return {
        attached: (page) => {
          const shown = window.now()
          if (shown) extensions.addTab(page, shown)
        },
        shown: (id) =>
          Effect.sync(() => {
            const page = pageOf(id)
            if (!page || page.id === active) return
            active = page.id
            popup.close()
            extensions.selectTab(page)
          }),
        named,
        menuItems: (page, params) =>
          extensions.getContextMenuItems(page, params),
        remove: (id) =>
          Effect.gen(function* () {
            const name = yield* named(id)
            const yes = yield* confirm(window.now(), {
              message: `Remove “${name}” from Banda's browser?`,
              detail: "Its data in the browser goes too.",
              yes: "Remove",
              no: "Cancel",
            })
            if (yes)
              yield* Effect.promise(() =>
                uninstallExtension(id, { session: profile })
              )
            return yes
          }),
        popup: (id, url, under) =>
          Effect.gen(function* () {
            yield* named(id)
            if (!url.startsWith(`chrome-extension://${id}/`))
              return yield* new Refused({
                message: `${url} is not a page of the extension ${id}.`,
              })
            const shown = window.now()
            if (shown) popup.show(shown, id, url, under)
          }),
      }
    })
  )
}

/** What an extension may do, in a line, from its manifest. */
function canDo(manifest: chrome.runtime.Manifest): string {
  const hosts = [
    ...(manifest.host_permissions ?? []),
    ...(manifest.content_scripts ?? []).flatMap((each) => each.matches ?? []),
  ]
  const everywhere = hosts.some((host) =>
    /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/.test(host)
  )
  const sites = everywhere
    ? "It can read and change what you see on every site."
    : hosts.length
      ? `It can read and change what you see on ${[...new Set(hosts)].length} sites.`
      : "It cannot read the sites you visit."
  const asks = (manifest.permissions ?? []).filter((each) =>
    ["tabs", "cookies", "history", "downloads", "nativeMessaging"].includes(
      each
    )
  )
  return asks.length ? `${sites} It also asks for: ${asks.join(", ")}.` : sites
}
