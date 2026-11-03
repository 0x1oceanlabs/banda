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
import type { SpaceId } from "@banda/contract"
import { HELD_BY, paneLayer } from "@banda/ui/pane"
import { type BrowserNews, PARTITION } from "./desktop"
import { browserHost, hearNews } from "./host"

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
  /** The site's icon, as a data URL. */
  icon?: string
  /** An Agent drives it over CDP: the tab shows its mark. */
  driven: boolean
  /** The Thread that drives it with Banda's tools, by its Agent, and the
   * step it takes: the page glows, and a pill says so (ADR 0029,
   * decision 4). */
  driver: Driver | null
}

/** A Thread that drives a page, by its Agent: the step it takes, and
 * where its cursor is, once its hands went somewhere. */
export type Driver = { agent: string; step: string; at?: Point }
export type Point = { x: number; y: number }

/** A page not made yet. */
export const BLANK: PageState = {
  url: "",
  title: "",
  loading: false,
  back: false,
  forward: false,
  crashed: false,
  driven: false,
  driver: null,
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
  getWebContentsId(): number
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
  /** What Banda draws over the page and not in it, as a Thread's pill:
   * the page never sees it. */
  readonly over: HTMLDivElement
  private ready = false
  /** Its web contents' ID, by which the desktop names it; none until it
   * attached. */
  contents: number | null = null
  /** Who waits for it to attach. */
  private attaching: ((contents: number) => void)[] = []
  private slot: Slot | null = null
  /** What cuts the slot: its ancestors that clip, and the tile's corner. */
  private clips: HTMLElement[] = []
  private radius = 0
  private drawn = ""
  state: PageState

  /** The ID its tab keeps it under. */
  readonly id: string

  constructor(id: string, url: string, layer: HTMLElement) {
    this.id = id
    this.state = { ...BLANK, url, loading: true }
    this.box = document.createElement("div")
    this.box.style.cssText =
      "position:absolute;top:0;left:0;background:var(--background);transform-origin:0 0"
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
    this.over = document.createElement("div")
    this.over.style.cssText = "position:absolute;inset:0;pointer-events:none"
    this.listen()
    this.draw(null)
    this.box.append(this.view, this.over, this.veil)
    layer.append(this.box)
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

  /** Calls `then` with its web contents' ID once it attached. */
  attached(then: (contents: number) => void): void {
    if (this.contents === null) this.attaching.push(then)
    else then(this.contents)
  }

  destroy(): void {
    if (this.contents !== null) byContents.delete(this.contents)
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

  /** The site's icon, which the desktop fetched. */
  iconed(icon: string): void {
    this.set({ icon })
  }

  /** An Agent drives it now, or no longer does. */
  drive(driven: boolean): void {
    this.set({ driven })
  }

  /** A Thread's Agent drives it with Banda's tools now, at `step`; or
   * none does. */
  driveBy(agent: string | null, step: string): void {
    const was = this.state.driver
    if (was?.agent === agent && was?.step === step) return
    // The cursor stays where the Thread's hands went last.
    const at = was?.agent === agent ? was?.at : undefined
    this.set({ driver: agent ? { agent, step, ...(at && { at }) } : null })
  }

  /** The Thread's hands go to `at` in the page, its cursor with them. */
  point(at: Point): void {
    const was = this.state.driver
    if (was) this.set({ driver: { ...was, at } })
  }

  private set(change: Partial<PageState>): void {
    const now = this.state
    const same = (Object.keys(change) as (keyof PageState)[]).every(
      (key) => change[key] === now[key]
    )
    if (same) return
    this.state = { ...now, ...change }
    changed()
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
    // Its web contents' ID, once the webview has one: at `did-attach`
    // it may not yet, as when the page waited for its Pane, so again at
    // `dom-ready`.
    const attach = () => {
      if (this.contents !== null) return
      let contents: number
      try {
        contents = view.getWebContentsId()
      } catch {
        return
      }
      this.contents = contents
      byContents.set(contents, this)
      for (const then of this.attaching.splice(0)) then(contents)
      const heard = early.get(contents) ?? []
      early.delete(contents)
      heard.forEach(hear)
      changed()
    }
    view.addEventListener("did-attach", attach)
    view.addEventListener("dom-ready", () => {
      this.ready = true
      attach()
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
  changed()
  return page
}

/** The page of `id` when it was made: a tab not shown yet has none. */
export function pageAt(id: string): Page | undefined {
  return pages.get(id)
}

/** What a browser Pane does with its tabs when a page, an extension or
 * an Agent asks. */
export type Holder = {
  /** The Space of its Pane. */
  space: SpaceId
  /** Opens a tab at `url`, beside the tab `from` when a page of its tabs
   * opened it, and behind it when in the `background`; the tab's ID. */
  open: (url: string, from?: string, background?: boolean) => string
  show: (id: string) => void
  close: (id: string) => void
}

/** The tabs a browser Pane holds now, by their pages' IDs. */
const held = new Map<string, Holder>()

/**
 * Keeps the pages of `ids` while a Pane holds them, shown or not, and
 * hands it what they open; returns how to let go. The window lets a
 * Pane's old args go once it drew the new ones, so the pages of tabs it
 * still holds stay.
 */
export function hold(ids: readonly string[], holder: Holder): () => void {
  for (const id of ids) held.set(id, holder)
  return () => {
    for (const id of ids) if (held.get(id) === holder) held.delete(id)
  }
}

/** The browser Pane that holds the tab of `id`, if one does. */
export function holderOf(id: string): Holder | undefined {
  return held.get(id)
}

/** The browser Panes the Person was in, the last one last. */
let fronts: Holder[] = []

/** `holder`'s Pane has the focus. */
export function toFront(holder: Holder): void {
  const holding = new Set(held.values())
  fronts = [...fronts.filter((h) => h !== holder && holding.has(h)), holder]
}

/** The browser Pane of `space`, or of any Space, the Person was in last,
 * else the last that holds a tab; none without one. */
export function frontHolder(space?: SpaceId): Holder | undefined {
  const holding = new Set(held.values())
  const fits = (h: Holder) => holding.has(h) && (!space || h.space === space)
  return fronts.findLast(fits) ?? [...holding].findLast(fits)
}

/** Opens a tab at `url` for an extension, or for `agent`, where it goes;
 * the tab's ID. */
type Opener = (url: string, agent?: string) => string

/** Where a tab an extension or an Agent asks for opens: the module's
 * start sets it, as the window lets it find and open Panes. */
let opener: Opener | null = null

/** Sets where a tab an extension or an Agent asks for opens; returns how
 * to stop. */
export function openWith(open: Opener): () => void {
  opener = open
  return () => {
    if (opener === open) opener = null
  }
}

/** Makes the tab an extension or an Agent asked for, and tells the
 * desktop its page. */
function create(request: string, url: string, agent?: string): void {
  const id = opener?.(url, agent)
  const page = id ? pageOf(id, url) : null
  if (!page) browserHost()?.created(request, null)
  else page.attached((contents) => browserHost()?.created(request, contents))
}

/**
 * Lets go of the page of `id` unless a Pane holds it or a slot shows it.
 * The window calls a kind's `closed` when a Pane's args change too, as a
 * tab's address does; by then the Pane holds what it still has.
 */
export function drop(id: string): void {
  const page = pages.get(id)
  if (!page || page.shown || held.has(id)) return
  page.destroy()
  pages.delete(id)
  changed()
}

const watchers = new Set<() => void>()
let version = 0

/** Calls `listener` on any change of any page; returns how to stop. */
export function watchPages(listener: () => void): () => void {
  watchers.add(listener)
  return () => watchers.delete(listener)
}

/** The Agents whose Threads drive a page now. */
export function drivers(): Set<string> {
  return new Set(
    [...pages.values()].flatMap((page) => page.state.driver?.agent ?? [])
  )
}

/** A number that changes with any page, for `useSyncExternalStore`. */
export function pagesVersion(): number {
  return version
}

function changed(): void {
  version++
  for (const watcher of watchers) watcher()
}

/** The pages by their web contents' IDs, as the desktop names them. */
const byContents = new Map<number, Page>()

// A page's icon, the pages it opens, which its Pane makes tabs of, and
// the tabs extensions open, show and close.
hearNews((news) => {
  if (news.kind === "create") return create(news.request, news.url, news.agent)
  if (news.kind === "download") return
  hear(news)
})

type PageNews = Exclude<BrowserNews, { kind: "create" | "download" }>

/** News of a page the desktop knows before this window does: the page
 * hears it once it attached. */
const early = new Map<number, PageNews[]>()

function hear(news: PageNews): void {
  const page = byContents.get(news.from)
  if (!page) {
    early.set(news.from, [...(early.get(news.from) ?? []), news])
    return
  }
  const holder = held.get(page.id)
  if (news.kind === "icon") page.iconed(news.icon)
  else if (news.kind === "driven") page.drive(news.driven)
  else if (news.kind === "driver") page.driveBy(news.agent, news.step)
  else if (news.kind === "point") page.point({ x: news.x, y: news.y })
  else if (news.kind === "open") {
    holder?.open(news.url, page.id, news.background)
  } else if (news.kind === "select") holder?.show(page.id)
  else holder?.close(page.id)
}
