/**
 * Chrome's extensions in the browser's profile (ADR 0013, decision 6).
 * `electron-chrome-extensions` gives them Chrome's APIs, and
 * `electron-chrome-web-store` installs them from the Web Store's own page
 * and keeps them updated. They live in the browser's profile only: an
 * extension that filters requests in the default session breaks the main
 * process's `net.fetch`.
 *
 * The tabs are the Panes' pages: the desktop tells an extension of each
 * page as it attaches, and the Pane of the one the Person looks at. What an
 * extension asks of the tabs goes to the Panes as `BrowserNews`.
 */
import { randomUUID } from "node:crypto"
import {
  type BrowserWindow,
  type Session,
  session,
  type WebContents,
  webContents,
} from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import {
  installChromeWebStore,
  uninstallExtension,
} from "electron-chrome-web-store"
import {
  type Box,
  type BrowserNews,
  PARTITION,
} from "@banda/browser-pane/desktop"
import { confirm } from "./browser"
import { Popup } from "./popup"

/** How long a Pane has to make a tab an extension asked for. */
const CREATING = 10_000

export class Extensions {
  readonly #window: () => BrowserWindow | null
  readonly #profile: Session
  readonly #extensions: ElectronChromeExtensions
  /** Tabs an extension asked for, until a Pane made their pages. */
  readonly #creating = new Map<string, (contents: unknown) => void>()
  readonly #popup: Popup
  /** The active tab's web contents. */
  #shown = -1

  constructor(window: () => BrowserWindow | null) {
    this.#window = window
    const profile = session.fromPartition(PARTITION)
    this.#profile = profile
    this.#popup = new Popup(profile)
    this.#extensions = new ElectronChromeExtensions({
      session: profile,
      createTab: (details) => this.#create(details.url),
      createWindow: async (details) => {
        const first = [details.url ?? []].flat()[0]
        await this.#create(first)
        return this.#owner()
      },
      selectTab: (page) => this.#tell({ kind: "select", from: page.id }),
      removeTab: (page) => this.#tell({ kind: "close", from: page.id }),
    })
    // `chrome.action.openPopup()` opens the library's popup, a window of
    // its own that Hyprland would tile: it closes, and the button's opens
    // in the row instead.
    this.#extensions.on("browser-action-popup-created", (popup) =>
      popup.destroy()
    )
    // The row's buttons show the extensions' icons from crx:// URLs.
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
    void installChromeWebStore({
      session: profile,
      beforeInstall: async ({ localizedName, manifest }) => ({
        action: (await confirm(this.#window(), {
          message: `Add “${localizedName}” to Banda's browser?`,
          detail: canDo(manifest),
          yes: "Add extension",
          no: "Cancel",
        }))
          ? "allow"
          : "deny",
      }),
    }).catch((error: unknown) =>
      console.error("banda: the Chrome Web Store did not start:", error)
    )
  }

  /** A page of the browser attached: extensions see it as a tab. */
  attached(page: WebContents): void {
    const window = this.#window()
    if (window) this.#extensions.addTab(page, window)
  }

  /** The page the Person looks at: the extensions' active tab. Another
   * closes the popup, which spoke of the one before. */
  shown(contents: unknown): void {
    const page = pageOf(contents)
    if (!page || page.id === this.#shown) return
    this.#shown = page.id
    this.#popup.close()
    this.#extensions.selectTab(page)
  }

  /** A Pane made the page for a tab an extension asked for. */
  created(request: unknown, contents: unknown): void {
    if (typeof request === "string") this.#creating.get(request)?.(contents)
  }

  /** What the extensions add to a page's menu. */
  menuItems(
    page: WebContents,
    params: Electron.ContextMenuParams
  ): Electron.MenuItem[] {
    return this.#extensions.getContextMenuItems(page, params)
  }

  /** Removes the extension `id`, once the Person says so; whether it
   * went. */
  async remove(id: unknown): Promise<boolean> {
    if (!this.has(id)) throw new Error(`There is no extension ${String(id)}.`)
    const { name } = this.#profile.extensions.getExtension(id)!
    const yes = await confirm(this.#window(), {
      message: `Remove “${name}” from Banda's browser?`,
      detail: "Its data in the browser goes too.",
      yes: "Remove",
      no: "Cancel",
    })
    if (yes) await uninstallExtension(id, { session: this.#profile })
    return yes
  }

  /** Shows the popup `url` of the extension `id` under `under`, or closes
   * it; a popup is a page of the extension's own. */
  popup(id: unknown, url: unknown, under: unknown): void {
    const window = this.#window()
    if (!window || !this.has(id) || !isBox(under)) return
    if (typeof url !== "string") return
    if (!url.startsWith(`chrome-extension://${id}/`)) return
    this.#popup.show(window, id, url, under)
  }

  /** Whether `id` is an extension in the browser's profile. */
  has(id: unknown): id is string {
    return typeof id === "string" && !!this.#profile.extensions.getExtension(id)
  }

  /** Asks the Pane in front for a tab at `url`; its page, once made. */
  #create(url = "about:blank"): Promise<[WebContents, BrowserWindow]> {
    const request = randomUUID()
    return new Promise((done, fail) => {
      const late = setTimeout(() => answer(null), CREATING)
      const answer = (contents: unknown) => {
        clearTimeout(late)
        this.#creating.delete(request)
        const page = pageOf(contents)
        const window = this.#window()
        if (page && window) done([page, window])
        else fail(new Error("No browser in Banda could open the tab."))
      }
      this.#creating.set(request, answer)
      this.#tell({ kind: "create", request, url })
    })
  }

  #owner(): BrowserWindow {
    const window = this.#window()
    if (!window) throw new Error("Banda's window is closed.")
    return window
  }

  #tell(news: BrowserNews): void {
    this.#window()?.webContents.send("browser:news", news)
  }
}

function pageOf(contents: unknown): WebContents | undefined {
  if (typeof contents !== "number") return undefined
  const page = webContents.fromId(contents)
  return page && !page.isDestroyed() && page.getType() === "webview"
    ? page
    : undefined
}

function isBox(value: unknown): value is Box {
  if (typeof value !== "object" || value === null) return false
  const box = value as Record<string, unknown>
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(box[key]))
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
