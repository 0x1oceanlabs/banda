/**
 * An extension's popup, under its button in the browser's row (ADR 0013,
 * decision 6). It is a view in Banda's window, not a window of its own,
 * which Hyprland would tile; so it lies over everything in the window, as
 * Chrome's does, and is as large as its page asks. It closes as Chrome's
 * does: when it loses the focus, on Escape, when the page closes itself,
 * and when its button is clicked again.
 */
import { type BrowserWindow, type Session, WebContentsView } from "electron"
import type { Box } from "@banda/browser-pane/desktop"
import { keys } from "./keys"

/** Chrome's bounds on a popup's size. */
const SMALLEST = 25
const WIDEST = 800
const TALLEST = 600
/** The space between the button and its popup. */
const GAP = 4
/** A click on the button of an open popup closes it: the popup lost the
 * focus to the button a moment before. */
const TOGGLE = 300

/** What the popup's page takes, run in it once it loaded. */
const MEASURE = `(() => {
  const body = document.body.getBoundingClientRect()
  const style = getComputedStyle(document.body)
  const margins = parseFloat(style.marginLeft) + parseFloat(style.marginRight)
  return {
    width: Math.ceil(body.width + margins),
    height: Math.ceil(document.documentElement.scrollHeight),
  }
})()`

type Open = { extension: string; view: WebContentsView; window: BrowserWindow }

export class Popup {
  readonly #profile: Session
  #open: Open | null = null
  #closed = { extension: "", at: 0 }

  constructor(profile: Session) {
    this.#profile = profile
  }

  /** Shows `extension`'s popup at `url` under `under`, in `window`'s
   * page's pixels; or closes it when it shows. */
  show(
    window: BrowserWindow,
    extension: string,
    url: string,
    under: Box
  ): void {
    const recent = performance.now() - this.#closed.at < TOGGLE
    const was =
      this.#open?.extension ?? (recent ? this.#closed.extension : undefined)
    this.close()
    if (was === extension) {
      // That click closed it: the next opens it again.
      this.#closed = { extension: "", at: 0 }
      return
    }
    const view = new WebContentsView({
      webPreferences: {
        session: this.#profile,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        enablePreferredSizeMode: true,
      },
    })
    const open = { extension, view, window }
    this.#open = open
    const page = view.webContents
    const close = () => {
      if (this.#open === open) this.close()
    }
    keys(page, window.webContents)
    page.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape") return
      event.preventDefault()
      close()
    })
    page.on("blur", close)
    page.on("destroyed", close)
    // `window.close()` in the popup.
    ;(page as NodeJS.EventEmitter).on("close", close)
    page.setWindowOpenHandler(() => ({ action: "deny" }))
    const size = (size: Electron.Size) => {
      view.setBounds(placed(window, under, size))
      view.setVisible(true)
    }
    page.on("preferred-size-changed", (_event, asked) => size(asked))
    // Until it loaded, it lays out at the largest, out of sight, and shows
    // as large as its page then is: Chromium tells no preferred size in a
    // window drawn nowhere, as a test's.
    view.setVisible(false)
    view.setBounds(placed(window, under, { width: WIDEST, height: TALLEST }))
    window.contentView.addChildView(view)
    page.once("did-finish-load", async () => {
      const measured = await page
        .executeJavaScript(MEASURE)
        .catch(() => undefined)
      if (this.#open !== open) return
      if (!view.getVisible()) size(measured ?? { width: 0, height: 0 })
      page.focus()
    })
    void page.loadURL(url).catch(close)
  }

  close(): void {
    const open = this.#open
    if (!open) return
    this.#open = null
    this.#closed = { extension: open.extension, at: performance.now() }
    if (!open.window.isDestroyed()) {
      open.window.contentView.removeChildView(open.view)
    }
    if (!open.view.webContents.isDestroyed()) open.view.webContents.close()
  }
}

/** Where a popup of `size` goes: its right edge on its button's, under it,
 * inside the window. */
function placed(window: BrowserWindow, under: Box, size: Electron.Size): Box {
  const zoom = window.webContents.getZoomFactor()
  const width = within(size.width, SMALLEST, WIDEST)
  const height = within(size.height, SMALLEST, TALLEST)
  const [room = width] = window.getContentSize()
  const right = (under.x + under.width) * zoom
  return {
    x: Math.round(within(right - width, 0, room - width)),
    y: Math.round((under.y + under.height) * zoom + GAP),
    width,
    height,
  }
}

function within(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
