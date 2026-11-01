/**
 * The browser's Pane (ADR 0013): one row as Helium's compact layout, the
 * tabs on top in it or on the left beside the page, as `browser.toml`
 * says, and a slot that the shown tab's page, kept in the window's layer,
 * follows.
 */
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { newId } from "@banda/contract"
import { type Browser as Settings, DEFAULT_BROWSER } from "@banda/contract/look"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
} from "@banda/ui/components/empty"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { RingMeter } from "@banda/ui/components/ring-meter"
import { Spinner } from "@banda/ui/components/spinner"
import { TopLayer } from "@banda/ui/components/top-layer"
import { useLook } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import { definePane, HOLDS, type PaneProps } from "@banda/ui/pane"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  GlobeIcon,
  PanelLeftIcon,
  PanelTopIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"
import { addressOf, siteOf } from "./address"
import type { Download } from "./desktop"
import { browserHost, downloadsNow, watchDownloads } from "./host"
import { browserKey, type Does } from "./keys"
import {
  BLANK,
  drop,
  hold,
  type Page,
  type PageState,
  pageAt,
  pageOf,
  pagesVersion,
  watchPages,
} from "./pages"
import {
  type BrowserArgs,
  blankTab,
  keepClosed,
  lastClosed,
  NEW_BROWSER,
  showing,
  stepped,
  type Tab,
  withChanged,
  withoutTab,
  withTab,
} from "./tabs"

export const browserPane = definePane<BrowserArgs>({
  kind: "browser.browser",
  title: (args) => {
    const tab = args.tabs[args.shown]
    return tab ? titleOf(tab) : "Browser"
  },
  icon: GlobeIcon,
  start: NEW_BROWSER,
  header: false,
  closed: ({ args }) => {
    for (const tab of args.tabs) drop(tab.id)
  },
  Pane: BrowserPane,
})

/** A tab's words: its page's title, else its site. */
function titleOf(tab: Tab): string {
  return tab.title || (tab.url ? siteOf(tab.url) : "New Tab")
}

function BrowserPane({ args, focused, update, close }: PaneProps<BrowserArgs>) {
  const settings = useLook((look) => look.browser, DEFAULT_BROWSER)
  // Any page's change draws the tabs again: their titles, icons, loads.
  const version = useSyncExternalStore(watchPages, pagesVersion)
  const [first] = useState(newId)
  const now = useRef({ args, update })
  useEffect(() => {
    now.current = { args, update }
  })

  useEffect(() => {
    if (!args.tabs.length) update(withTab(args, blankTab(first)))
  })

  // The Pane holds its tabs' pages; a page opened from one is a tab
  // beside it, loading out of sight when it opened in the background.
  const ids = args.tabs.map((tab) => tab.id)
  useEffect(
    () =>
      hold(ids, {
        open: (from, url, background) => {
          const { args, update } = now.current
          const tab = { id: newId(), url, title: "" }
          if (background) pageOf(tab.id, url)
          const at = args.tabs.findIndex((each) => each.id === from) + 1
          update(withTab(args, tab, at || undefined, background))
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same tabs
    [ids.join(" ")]
  )

  // A tab keeps where its page went, so it comes back there; a title that
  // keeps changing, as an unread count, is kept once a load settles.
  const loading = useRef(new Map<string, boolean>())
  useEffect(() => {
    let next = args
    for (const tab of args.tabs) {
      const state = pageAt(tab.id)?.state
      if (!state) continue
      const ended = loading.current.get(tab.id) && !state.loading
      loading.current.set(tab.id, state.loading)
      if (state.loading) continue
      if (ended || state.url !== tab.url || (!tab.title && state.title)) {
        next = withChanged(next, {
          ...tab,
          url: state.url || tab.url,
          title: state.title,
        })
      }
    }
    if (next !== args) update(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a page's change
  }, [version])

  const tab = args.tabs[args.shown]
  if (!tab) return null
  const change = (next: BrowserArgs | null) => (next ? update(next) : close())
  const tabs: TabsProps = {
    args,
    onShow: (at) => change(showing(args, at)),
    onClose: (at) => {
      const gone = args.tabs[at]
      if (gone) keepClosed(gone)
      change(withoutTab(args, at))
    },
    onNew: () => change(withTab(args, blankTab(newId()))),
  }
  return (
    <Browser
      tab={tab}
      tabs={tabs}
      settings={settings}
      focused={focused}
      title={browserPane.title(args)}
      onOpen={(url) => update(withChanged(args, { ...tab, url }))}
      onTabKey={(does) => {
        if (does === "tab-new") tabs.onNew()
        else if (does === "tab-close") tabs.onClose(args.shown)
        else if (does === "tab-reopen") {
          const back = lastClosed()
          if (back) change(withTab(args, { ...back, id: newId() }))
        } else if (does === "tab-next") change(stepped(args, 1))
        else if (does === "tab-previous") change(stepped(args, -1))
        else {
          const place = Number(does.slice(4))
          change(showing(args, place === 9 ? args.tabs.length : place - 1))
        }
      }}
      close={close}
    />
  )
}

/** What the tabs show, and what they do. */
type TabsProps = {
  args: BrowserArgs
  onShow: (at: number) => void
  onClose: (at: number) => void
  onNew: () => void
}

type TabDoes = Extract<Does, `tab-${string}`>

function Browser({
  tab,
  tabs,
  settings,
  focused,
  title,
  onOpen,
  onTabKey,
  close,
}: {
  tab: Tab
  tabs: TabsProps
  settings: Settings
  focused: boolean
  title: string
  onOpen: (url: string) => void
  onTabKey: (does: TabDoes) => void
  close: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  // The page is made once its tab shows with an address to open.
  const page = tab.url ? pageOf(tab.id, tab.url) : null
  const state = useSyncExternalStore(
    page?.subscribe ?? noSubscribe,
    () => page?.state ?? BLANK
  )

  useEffect(() => {
    const element = slot.current
    if (!page || !element) return
    page.show(element, focused)
    return () => page.release(element)
  }, [page, focused])

  // A tile that takes the focus gives it to its page, or to the address;
  // so does a tab that comes to show.
  const shownBefore = useRef(tab.id)
  useEffect(() => {
    const switched = shownBefore.current !== tab.id
    shownBefore.current = tab.id
    if (!focused) return
    if (!switched && root.current?.contains(document.activeElement)) return
    if (page) page.focus()
    else address.current?.focus()
  }, [focused, page, tab.id])

  // The first address typed in a tab made its page: it takes the keys.
  const made = useRef({ tab: tab.id, page: page !== null })
  useEffect(() => {
    const before = made.current
    made.current = { tab: tab.id, page: page !== null }
    if (page && before.tab === tab.id && !before.page) page.focus()
  }, [page, tab.id])

  const open = (typed: string) => {
    const to = addressOf(typed, settings.search)
    if (page) page.load(to)
    else onOpen(to)
  }

  useEffect(() => {
    if (!focused) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      const does = browserKey(event)
      if (!does) return
      event.preventDefault()
      if (does === "address") address.current?.focus()
      else if (does.startsWith("tab-")) onTabKey(does as TabDoes)
      else if (page) ON_PAGE[does as PageDoes](page)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused, page, onTabKey])

  const left = settings.tabs === "left"
  return (
    <div ref={root} className="flex h-full flex-col">
      <PaneHeader title={title} onClose={close} className="gap-1 px-1.5">
        {!left && <TopTabs {...tabs} />}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back"
          title="Back (Ctrl+[)"
          disabled={!state.back}
          onClick={() => page?.back()}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Forward"
          title="Forward (Ctrl+])"
          disabled={!state.forward}
          onClick={() => page?.forward()}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reload"
          title="Reload (Ctrl+R)"
          disabled={!page}
          onClick={() => page?.reload()}
        >
          <RotateCwIcon
            className={state.loading ? "animate-spin" : undefined}
          />
        </Button>
        <Address
          ref={address}
          // Beside the tabs it gives way to them; alone it fills the row.
          className={left ? "min-w-32 flex-1" : "w-56 min-w-24 shrink-[4]"}
          url={state.url || tab.url}
          onOpen={open}
          onLeave={() => page?.focus()}
        />
        <Downloads />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={left ? "Tabs on top" : "Tabs on the left"}
          title={left ? "Tabs on top" : "Tabs on the left"}
          className="shrink-0"
          onClick={() => void browserHost()?.tabs(left ? "top" : "left")}
        >
          {left ? <PanelTopIcon /> : <PanelLeftIcon />}
        </Button>
      </PaneHeader>
      <div className="flex min-h-0 flex-1">
        {left && <LeftTabs {...tabs} />}
        <div
          ref={slot}
          {...{ [HOLDS]: tab.id }}
          className="relative min-w-0 flex-1 bg-background"
        >
          <Notice state={state} page={page} url={tab.url} />
        </div>
      </div>
    </div>
  )
}

/** The tabs as a row at the start of the Pane's row, as Helium's. */
function TopTabs({ args, onShow, onClose, onNew }: TabsProps) {
  return (
    <div className="flex min-w-0 flex-auto items-center gap-0.5">
      <div
        role="tablist"
        aria-label="Tabs"
        className="flex min-w-0 items-center gap-0.5 overflow-hidden"
      >
        {args.tabs.map((tab, at) => (
          <TabItem
            key={tab.id}
            tab={tab}
            shown={at === args.shown}
            onShow={() => onShow(at)}
            onClose={() => onClose(at)}
            className="h-7 w-44 min-w-9 shrink"
          />
        ))}
      </div>
      <NewTab onNew={onNew} />
    </div>
  )
}

/** How long the pointer rests on the rail before it opens to titles. */
const OPENING = 250

/**
 * The tabs as a narrow rail of icons beside the page, opening to titles
 * while the pointer rests on it. The titles lie over the page, which is
 * drawn over the workspace, so they open in the window's top layer.
 */
function LeftTabs(tabs: TabsProps) {
  const rail = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState<DOMRect | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const rest = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const box = rail.current?.getBoundingClientRect()
      if (box) setOver(box)
    }, OPENING)
  }
  const leave = () => {
    clearTimeout(timer.current)
    setOver(null)
  }
  return (
    <div
      ref={rail}
      onPointerEnter={rest}
      onPointerLeave={(event) => {
        // Into the open titles is still on the rail.
        if (!(
          event.relatedTarget instanceof Node && opened(event.relatedTarget)
        ))
          leave()
      }}
      className="flex w-10 shrink-0 flex-col border-r"
    >
      <TabList {...tabs} titles={false} />
      {over && (
        <TopLayer>
          <div
            data-browser-titles=""
            onPointerLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !rail.current?.contains(event.relatedTarget)
              )
                leave()
            }}
            style={{ top: over.top, left: over.left, height: over.height }}
            className="fixed z-40 flex w-60 flex-col border-r bg-background shadow-lg"
          >
            <TabList {...tabs} titles />
          </div>
        </TopLayer>
      )}
    </div>
  )
}

/** Whether `node` is in the rail's open titles. */
function opened(node: Node): boolean {
  return (
    node instanceof Element && node.closest("[data-browser-titles]") !== null
  )
}

/** The rail's tabs, as icons or with their titles, and the new-tab button. */
function TabList({
  args,
  onShow,
  onClose,
  onNew,
  titles,
}: TabsProps & { titles: boolean }) {
  return (
    <>
      <div
        role="tablist"
        aria-label="Tabs"
        aria-orientation="vertical"
        className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1"
      >
        {args.tabs.map((tab, at) => (
          <TabItem
            key={tab.id}
            tab={tab}
            shown={at === args.shown}
            onShow={() => onShow(at)}
            onClose={() => onClose(at)}
            iconOnly={!titles}
            className="h-8 w-full shrink-0"
          />
        ))}
      </div>
      <div className={cn("mt-auto p-1", !titles && "flex justify-center")}>
        <NewTab onNew={onNew} />
      </div>
    </>
  )
}

/** One tab: its site's icon, its title, and its close button on hover. */
function TabItem({
  tab,
  shown,
  onShow,
  onClose,
  iconOnly = false,
  className,
}: {
  tab: Tab
  shown: boolean
  onShow: () => void
  onClose: () => void
  iconOnly?: boolean
  className?: string
}) {
  const state = pageAt(tab.id)?.state
  const words = state?.title || titleOf(tab)
  return (
    <div
      role="tab"
      aria-selected={shown}
      aria-label={words}
      title={words}
      tabIndex={shown ? 0 : -1}
      onClick={onShow}
      // The middle button closes a tab, as in every browser.
      onAuxClick={(event) => {
        if (event.button === 1) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onShow()
      }}
      className={cn(
        "group/tab flex min-w-0 cursor-default items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-muted-foreground select-none hover:bg-muted",
        shown && "bg-muted text-foreground",
        iconOnly && "justify-center px-0",
        className
      )}
    >
      <TabIcon state={state} />
      {!iconOnly && <span className="min-w-0 flex-1 truncate">{words}</span>}
      {!iconOnly && (
        <button
          type="button"
          aria-label={`Close ${words}`}
          title="Close tab (Ctrl+W)"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className={cn(
            "-mr-1 flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/tab:opacity-100 hover:bg-foreground/10 [&_svg]:size-3.5",
            shown && "opacity-100"
          )}
        >
          <XIcon />
        </button>
      )}
    </div>
  )
}

function TabIcon({ state }: { state: PageState | undefined }) {
  if (state?.loading) return <Spinner className="size-4 shrink-0" />
  if (state?.icon) {
    return <img src={state.icon} alt="" className="size-4 shrink-0" />
  }
  return <GlobeIcon className="size-4 shrink-0" />
}

function NewTab({ onNew }: { onNew: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="New tab"
      title="New tab (Ctrl+T)"
      className="shrink-0"
      onClick={onNew}
    >
      <PlusIcon />
    </Button>
  )
}

/** This run's downloads: a ring while any runs, and the list under it. */
function Downloads() {
  const downloads = useSyncExternalStore(watchDownloads, downloadsNow)
  if (!downloads.length) return null
  const running = downloads.filter((each) => each.state === "running")
  const received = running.reduce((sum, each) => sum + each.received, 0)
  const total = running.reduce((sum, each) => sum + each.total, 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              running.length ? `Downloading ${running.length}` : "Downloads"
            }
            title="Downloads"
            className="shrink-0"
          />
        }
      >
        {running.length && total ? (
          <RingMeter value={(received / total) * 100} aria-label="Downloaded" />
        ) : (
          <DownloadIcon />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {[...downloads].reverse().map((each) => (
          <DropdownMenuItem
            key={each.id}
            disabled={each.state !== "done"}
            onClick={() => browserHost()?.reveal(each.path)}
          >
            <DownloadIcon />
            <span className="min-w-0 flex-1 truncate">{each.name}</span>
            <span className="text-xs text-muted-foreground">
              {downloadState(each)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function downloadState(download: Download): string {
  if (download.state === "failed") return "Failed"
  if (download.state === "done") return "Show in folder"
  if (!download.total) return "…"
  return `${Math.floor((download.received / download.total) * 100)}%`
}

/**
 * The address: the site while the Person reads, the whole address while
 * they edit it. Enter opens what they typed; Esc goes back to the page.
 */
function Address({
  ref,
  className,
  url,
  onOpen,
  onLeave,
}: {
  ref: React.Ref<HTMLInputElement>
  className: string
  url: string
  onOpen: (typed: string) => void
  onLeave: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const leaving = event.key === "Escape"
    if (!leaving && !(event.key === "Enter" && editing?.trim())) return
    event.preventDefault()
    if (!leaving) onOpen(editing!)
    setEditing(null)
    onLeave()
  }
  return (
    <input
      ref={ref}
      aria-label="Address"
      placeholder="Search or type an address"
      spellCheck={false}
      value={editing ?? (url ? siteOf(url) : "")}
      onFocus={(event) => {
        setEditing(url)
        const input = event.currentTarget
        // Selected once React wrote the whole address in; select() takes
        // the focus too, so only while the address still has it.
        requestAnimationFrame(() => {
          if (document.activeElement === input) input.select()
        })
      }}
      onBlur={() => setEditing(null)}
      onChange={(event) => setEditing(event.target.value)}
      onKeyDown={onKey}
      className={cn(
        "mx-1 h-7 rounded-md bg-transparent px-2 text-sm text-muted-foreground outline-none group-data-[focused=true]/tile:text-foreground placeholder:text-muted-foreground/70 hover:bg-muted focus:bg-muted focus:text-foreground",
        className
      )}
    />
  )
}

/** What the slot says when no page shows in it. */
function Notice({
  state,
  page,
  url,
}: {
  state: PageState
  page: Page | null
  url: string
}) {
  if (!("banda" in window)) {
    return (
      <Words>The browser shows pages in Banda's desktop window only.</Words>
    )
  }
  if (!url) return <Words>Search or type an address above.</Words>
  if (!state.crashed && !state.failed) return null
  return (
    <Words
      action={
        <Button variant="outline" size="sm" onClick={() => page?.reload()}>
          Reload
        </Button>
      }
    >
      {state.crashed
        ? "This page crashed."
        : `Could not open ${siteOf(state.url)}: ${state.failed}`}
    </Words>
  )
}

/** Words in the empty slot, and what to do under them. */
function Words({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Empty className="h-full">
      <EmptyDescription>{children}</EmptyDescription>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

type PageDoes = Exclude<Does, "address" | TabDoes>

/** What each of the browser's keys does to the page. */
const ON_PAGE: Record<PageDoes, (page: Page) => void> = {
  reload: (page) => page.reload(),
  "reload-hard": (page) => page.reload(true),
  back: (page) => page.back(),
  forward: (page) => page.forward(),
  "zoom-in": (page) => page.zoom(1),
  "zoom-out": (page) => page.zoom(-1),
  "zoom-reset": (page) => page.zoom(0),
  devtools: (page) => page.devtools(),
}

const noSubscribe = () => () => undefined
