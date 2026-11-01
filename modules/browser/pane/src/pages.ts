/**
 * The pages, kept in the window's layer (ADR 0013, decision 1).
 *
 * Electron destroys a `<webview>` that moves in the DOM, and a Pane is
 * drawn again whenever it moves to another column or workspace. So every
 * page lives in the window's layer, which never moves, and follows the
 * slot its Pane draws: on every frame it takes the slot's place and size,
 * is cut to what the workspace shows of it, rounds the tile's corners and
 * darkens as the tile does. A page whose slot is gone waits out of sight
 * until its Pane comes back, or leaves every workspace.
 */
import { HELD_BY, paneLayer } from "@banda/ui/pane"
import { PARTITION } from "./desktop"

/** What the row shows of a page. */
export type PageState = {
  url: string
  title: string
  loading: boolean
  back: boolean
  forward: boolean
  /** Why it could not open; none when it did. */
  failed?: string
  /** Its renderer died: it shows nothing until it reloads. */
  crashed: boolean
}

/** A page not made yet. */
export const BLANK: PageState = {
  url: "",
  title: "",
  loading: false,
  back: false,
  forward: false,
  crashed: false,
}

/** The part of Electron's `<webview>` a page uses. */
type View = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  reloadIgnoringCache(): void
  loadURL(url: string): Promise<void>
  getZoomLevel(): number
  setZoomLevel(level: number): void
  isDevToolsOpened(): boolean
  openDevTools(): void
  closeDevTools(): void
}

/** Where a page shows: the Pane's slot, and whether its tile has the focus. */
type Slot = { element: HTMLElement; focused: boolean }

/** Where the page goes on this frame: none while it waits out of sight. */
type Place = {
  width: number
  height: number
  transform: string
  clip: string
  dim: boolean
} | null

/** Chromium's code for a load that was stopped, as by a new one. */
const ABORTED = -3

export class Page {
  private readonly box: HTMLDivElement
  private readonly view: View
  /** Darkens the page as the tile's own veil darkens the tile. */
  private readonly veil: HTMLDivElement
  private ready = false
  private slot: Slot | null = null
  /** What cuts the slot: its ancestors that clip, and the tile's corner. */
  private clips: HTMLElement[] = []
  private radius = 0
  private drawn = ""
  private listeners = new Set<() => void>()
  state: PageState

  constructor(id: string, url: string, layer: HTMLElement) {
    this.state = { ...BLANK, url, loading: true }
    this.box = document.createElement("div")
    this.box.style.cssText =
      "position:absolute;top:0;left:0;background:var(--background);transform-origin:0 0;pointer-events:auto"
    this.box.setAttribute(HELD_BY, id)
    this.view = document.createElement("webview") as View
    this.view.setAttribute("partition", PARTITION)
    // A page may open others; the desktop decides where (desktop/browser.ts).
    this.view.setAttribute("allowpopups", "true")
    this.view.style.cssText = "display:flex;width:100%;height:100%"
    this.view.setAttribute("src", url)
    this.veil = document.createElement("div")
    this.veil.style.cssText =
      "position:absolute;inset:0;background:black;pointer-events:none;opacity:0"
    this.listen()
    this.draw(null)
    this.box.append(this.view, this.veil)
    layer.append(this.box)
  }

  /** Calls `listener` on each change of `state`; returns how to stop. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Shows the page over `element`, until `release`. */
  show(element: HTMLElement, focused: boolean): void {
    if (this.slot?.element !== element) {
      this.clips = clipsOf(element, this.box.parentElement!)
      this.radius = cornerOf(element)
    }
    this.slot = { element, focused }
    follow()
  }

  /** The slot is gone: the page waits out of sight. */
  release(element: HTMLElement): void {
    if (this.slot?.element === element) this.slot = null
  }

  get shown(): boolean {
    return this.slot !== null
  }

  focus(): void {
    this.view.focus()
  }

  load(url: string): void {
    this.set({ url, failed: undefined, crashed: false })
    void this.view.loadURL(url).catch(() => undefined)
  }

  back(): void {
    if (this.ready && this.view.canGoBack()) this.view.goBack()
  }

  forward(): void {
    if (this.ready && this.view.canGoForward()) this.view.goForward()
  }

  reload(hard = false): void {
    if (!this.ready) return
    this.set({ failed: undefined, crashed: false })
    if (hard) this.view.reloadIgnoringCache()
    else this.view.reload()
  }

  zoom(by: 1 | -1 | 0): void {
    if (!this.ready) return
    this.view.setZoomLevel(by === 0 ? 0 : this.view.getZoomLevel() + by / 2)
  }

  devtools(): void {
    if (!this.ready) return
    if (this.view.isDevToolsOpened()) this.view.closeDevTools()
    else this.view.openDevTools()
  }

  destroy(): void {
    this.listeners.clear()
    this.box.remove()
  }

  /**
   * Where the slot is, cut as the workspace shows it. It only reads the
   * layout, so every page measures before any draws, and the frame lays
   * out once.
   */
  measure(): Place {
    const slot = this.slot
    const element = slot?.element
    const width = element?.offsetWidth ?? 0
    const height = element?.offsetHeight ?? 0
    if (!slot || !element?.isConnected || !width || !height) return null
    if (this.state.crashed || this.state.failed) return null
    const rect = element.getBoundingClientRect()
    const layer = this.box.parentElement!.getBoundingClientRect()
    let { top, left, right, bottom } = rect
    for (const clip of this.clips) {
      const cut = clip.getBoundingClientRect()
      top = Math.max(top, cut.top)
      left = Math.max(left, cut.left)
      right = Math.min(right, cut.right)
      bottom = Math.min(bottom, cut.bottom)
    }
    if (right <= left || bottom <= top) return null
    // A slot drawn smaller than its size, as in a zoom, shows the page
    // shrunk, laid out at its own size.
    const scale = rect.width / width
    const r = this.radius
    return {
      width,
      height,
      transform: `translate(${rect.left - layer.left}px, ${rect.top - layer.top}px) scale(${scale})`,
      clip: `inset(${(top - rect.top) / scale}px ${(rect.right - right) / scale}px ${(rect.bottom - bottom) / scale}px ${(left - rect.left) / scale}px round 0 0 ${r}px ${r}px)`,
      dim: !slot.focused,
    }
  }

  /** Writes the box's style when it changed: most frames change nothing. */
  draw(place: Place): void {
    const as = JSON.stringify(place)
    if (as === this.drawn) return
    this.drawn = as
    const style = this.box.style
    if (!place) {
      style.transform = "translate(-100000px, 0)"
      return
    }
    style.width = `${place.width}px`
    style.height = `${place.height}px`
    style.transform = place.transform
    style.clipPath = place.clip
    this.veil.style.opacity = place.dim ? "var(--tile-dim)" : "0"
  }

  private set(change: Partial<PageState>): void {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  /** Reads where the page can go: each read asks the desktop. */
  private moves(): Partial<PageState> {
    return this.ready
      ? { back: this.view.canGoBack(), forward: this.view.canGoForward() }
      : {}
  }

  private listen(): void {
    const view = this.view
    type Navigated = Event & { url: string; isMainFrame?: boolean }
    view.addEventListener("dom-ready", () => {
      this.ready = true
    })
    view.addEventListener("did-start-loading", () =>
      this.set({ loading: true, failed: undefined })
    )
    // A load that ends says where it can go from there.
    view.addEventListener("did-stop-loading", () =>
      this.set({ loading: false, ...this.moves() })
    )
    view.addEventListener("did-navigate", (event) =>
      this.set({ url: (event as Navigated).url })
    )
    view.addEventListener("did-navigate-in-page", (event) => {
      const { url, isMainFrame } = event as Navigated
      if (isMainFrame) this.set({ url, ...this.moves() })
    })
    view.addEventListener("page-title-updated", (event) =>
      this.set({ title: (event as Event & { title: string }).title })
    )
    view.addEventListener("did-fail-load", (event) => {
      const failed = event as Event & {
        errorCode: number
        errorDescription: string
        isMainFrame: boolean
      }
      if (failed.isMainFrame && failed.errorCode !== ABORTED) {
        this.set({ failed: failed.errorDescription || "It did not load." })
      }
    })
    view.addEventListener("render-process-gone", () =>
      this.set({ crashed: true, loading: false })
    )
  }
}

/** The ancestors of `slot` that clip it, up to the one that holds `layer`. */
function clipsOf(slot: HTMLElement, layer: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = []
  for (let at = slot.parentElement; at; at = at.parentElement) {
    if (at.contains(layer)) break
    const style = getComputedStyle(at)
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      clips.push(at)
    }
  }
  return clips
}

/** The rounding of the tile's inner corner at the slot's bottom. */
function cornerOf(slot: HTMLElement): number {
  for (let at = slot.parentElement; at; at = at.parentElement) {
    const style = getComputedStyle(at)
    const radius = parseFloat(style.borderBottomLeftRadius)
    if (radius > 0) {
      return Math.max(0, radius - parseFloat(style.borderBottomWidth || "0"))
    }
  }
  return 0
}

const pages = new Map<string, Page>()
let frame = 0

/**
 * Every page follows its slot on each frame, while some page shows: a
 * Pane that shows one starts it again.
 */
function follow(): void {
  if (frame) return
  const step = () => {
    const all = [...pages.values()]
    const places = all.map((page) => page.measure())
    all.forEach((page, i) => page.draw(places[i]))
    frame = all.some((page) => page.shown) ? requestAnimationFrame(step) : 0
  }
  frame = requestAnimationFrame(step)
}

/**
 * The page of `id`, made at `url` the first time; none outside Banda's
 * desktop window, which alone can show one.
 */
export function pageOf(id: string, url: string): Page | null {
  const found = pages.get(id)
  if (found) return found
  const layer = paneLayer()
  if (!layer || !("banda" in window)) return null
  const page = new Page(id, url, layer)
  pages.set(id, page)
  return page
}

/**
 * Lets go of the page of `id` unless a slot shows it. The window calls a
 * kind's `closed` when a Pane's args change too, as a page's address
 * does; by then the slot of a Pane still drawn shows it again, since React
 * lets every effect go before it runs the new ones.
 */
export function drop(id: string): void {
  const page = pages.get(id)
  if (!page || page.shown) return
  page.destroy()
  pages.delete(id)
}
