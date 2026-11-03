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
import { BROWSER_FILE, type Browser as Settings } from "@banda/contract/browser"
import { BandaMark } from "@banda/ui/components/banda-mark"
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
import { DrawnIn, TopLayer } from "@banda/ui/components/top-layer"
import { useFile } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import { definePane, HOLDS, type PaneProps } from "@banda/ui/pane"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  DownloadIcon,
  GlobeIcon,
  MousePointer2Icon,
  PanelLeftIcon,
  PanelTopIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import { addressOf, siteOf } from "./address"
import { Extensions, WEB_STORE } from "./Extensions"
import type { Download, Driver, Handed, Point } from "./desktop"
import { browserHost, downloadsNow, watchDownloads } from "./host"
import { browserKey, type Does, isTabKey } from "./keys"
import { handBack, threadOf, useThreadOf } from "./threads"
import {
  BLANK,
  drop,
  type Holder,
  hold,
  type Page,
  type PageState,
  pageAt,
  pageOf,
  pagesVersion,
  toFront,
  watchPages,
} from "./pages"
import {
  afterTabKey,
  type BrowserArgs,
  blankTab,
  type KeptArgs,
  keepClosed,
  NEW_BROWSER,
  readArgs,
  showing,
  type Tab,
  type TabKey,
  withChanged,
  withoutTab,
  withTab,
} from "./tabs"

export const browserPane = definePane<KeptArgs>({
  kind: "browser.browser",
  title: (kept) => {
    const args = readArgs(kept, "")
    const tab = args.tabs[args.shown]
    return tab ? titleOf(tab) : "Browser"
  },
  icon: GlobeIcon,
  start: NEW_BROWSER,
  letter: "B",
  header: false,
  closed: ({ args }) => {
    for (const tab of readArgs(args, "").tabs) drop(tab.id)
  },
  Pane: BrowserPane,
})

/** `args` without the tab at `at`, which Ctrl+Shift+T opens again. */
function closing(args: BrowserArgs, at: number): BrowserArgs | null {
  const gone = args.tabs[at]
  if (gone) keepClosed(gone)
  return withoutTab(args, at)
}

/** A tab's words: its page's title, else its site. */
function titleOf(tab: Tab): string {
  return tab.title || (tab.url ? siteOf(tab.url) : "New Tab")
}

function BrowserPane({
  engine,
  space,
  args: kept,
  focused,
  open,
  update,
  close,
}: PaneProps<KeptArgs>) {
  const settings = useFile(BROWSER_FILE)
  // Any page's change draws the tabs again: their titles, icons, loads.
  const version = useSyncExternalStore(watchPages, pagesVersion)
  const [first] = useState(newId)
  const args = readArgs(kept, first)
  const now = useRef({ args, update, close })
  useEffect(() => {
    now.current = { args, update, close }
  })

  useEffect(() => {
    if (!args.tabs.length) update(withTab(args, blankTab(first)))
    else if (args !== kept) update(args)
  })

  // The Pane holds its tabs' pages; a page opened from one is a tab
  // beside it, loading out of sight when it opened in the background. An
  // extension opens, shows and closes tabs of the Pane in front.
  const [holder] = useState<Holder>(() => {
    const at = (id: string) =>
      now.current.args.tabs.findIndex((each) => each.id === id)
    const change = (next: BrowserArgs | null) =>
      next ? now.current.update(next) : now.current.close()
    return {
      space,
      open: (url, from, background = false) => {
        const tab = { ...blankTab(newId()), url }
        if (background) pageOf(tab.id, url)
        const after = from === undefined ? undefined : at(from) + 1 || undefined
        change(withTab(now.current.args, tab, after, background))
        return tab.id
      },
      show: (id) => {
        const i = at(id)
        if (i >= 0) change(showing(now.current.args, i))
      },
      close: (id) => {
        const i = at(id)
        if (i >= 0) change(closing(now.current.args, i))
      },
    }
  })
  const ids = args.tabs.map((tab) => tab.id)
  useEffect(
    () => hold(ids, holder),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same tabs
    [ids.join(" ")]
  )
  useEffect(() => {
    if (focused) toFront(holder)
  }, [focused, holder])

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
    onClose: (at) => change(closing(args, at)),
    onNew: () => change(afterTabKey(args, "tab-new", newId())),
  }
  return (
    <Browser
      tab={tab}
      tabs={tabs}
      settings={settings}
      focused={focused}
      title={browserPane.title(args)}
      onOpen={(url) => update(withChanged(args, { ...tab, url }))}
      onStore={() => holder.open(WEB_STORE)}
      onTabKey={(key) => change(afterTabKey(args, key, newId()))}
      onThread={(agent) => {
        const thread = threadOf(agent)
        if (thread) open(thread.listed.pane, undefined, thread.space)
      }}
      onHandBack={(contents, wait) => void handBack(engine, contents, wait)}
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

function Browser({
  tab,
  tabs,
  settings,
  focused,
  title,
  onOpen,
  onStore,
  onTabKey,
  onThread,
  onHandBack,
  close,
}: {
  tab: Tab
  tabs: TabsProps
  settings: Settings
  focused: boolean
  title: string
  onOpen: (url: string) => void
  onStore: () => void
  onTabKey: (key: TabKey) => void
  /** Goes to the Thread of the Agent that drives the page. */
  onThread: (agent: string) => void
  /** The Person is done with what the Thread handed them in the page. */
  onHandBack: (contents: number, wait: Handed) => void
  close: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  // The page is made once its tab shows with an address to open.
  const page = tab.url ? pageOf(tab.id, tab.url) : null
  // The Pane draws again on any page's change (`watchPages`).
  const state = page?.state ?? BLANK

  useEffect(() => {
    const element = slot.current
    if (!page || !element) return
    page.show(element, focused)
    return () => page.release(element)
  }, [page, focused])

  // The page the Person looks at is the extensions' active tab.
  const contents = page?.contents ?? null
  // One wait shows at a time: a handed-over tab is the Person's to use.
  const handed = state.waits.find(
    (wait): wait is Handed => wait.reason === "handoff"
  )
  const stopped = state.waits.find((wait) => wait.reason === "stopped")
  useEffect(() => {
    if (focused && contents !== null) browserHost()?.shown(contents)
  }, [focused, contents])

  // A tile that takes the focus gives it to its page, or to the address;
  // so does a tab that comes to show. The first address typed in a tab
  // made its page: it takes the keys.
  const before = useRef({ tab: tab.id, page: page !== null })
  useEffect(() => {
    const was = before.current
    before.current = { tab: tab.id, page: page !== null }
    const switched = was.tab !== tab.id
    if (page && !switched && !was.page) return page.focus()
    if (!focused) return
    if (!switched && root.current?.contains(document.activeElement)) return
    if (page) page.focus()
    else address.current?.focus()
  }, [focused, page, tab.id])

  const open = (typed: string) => {
    const to = addressOf(typed, settings.search)
    if (page) page.load(to)
    else onOpen(to)
  }

  const tabKey = useRef(onTabKey)
  useEffect(() => {
    tabKey.current = onTabKey
  })
  useEffect(() => {
    if (!focused) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      const does = browserKey(event)
      if (!does) return
      event.preventDefault()
      if (does === "address") address.current?.focus()
      else if (isTabKey(does)) tabKey.current(does)
      else if (page) ON_PAGE[does](page)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused, page])

  const left = settings.tabs === "left"
  return (
    <div ref={root} className="flex h-full flex-col">
      <PaneHeader
        title={title}
        onClose={close}
        className="gap-1 bg-tile px-1.5"
      >
        {!left && <TabStrip {...tabs} side="top" />}
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
        {browserHost() && (
          <Extensions
            tab={contents}
            pinned={settings.pinned}
            onStore={onStore}
          />
        )}
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
          className="relative min-w-0 flex-1"
        >
          <Notice state={state} page={page} url={tab.url} />
        </div>
        {page && state.driver && (
          <DrawnIn element={page.over}>
            <Driving
              driver={state.driver}
              onThread={onThread}
              onStop={() => stopIn(contents, true)}
            />
          </DrawnIn>
        )}
        {page && handed && contents != null && (
          <DrawnIn element={page.over}>
            <HandedOver
              wait={handed}
              onThread={onThread}
              onDone={() => onHandBack(contents, handed)}
            />
          </DrawnIn>
        )}
        {page && !state.driver && !handed && stopped && contents != null && (
          <DrawnIn element={page.over}>
            <Stopped
              agent={stopped.agent}
              onThread={onThread}
              onLet={() =>
                void browserHost()?.answered(contents, stopped.agent)
              }
            />
          </DrawnIn>
        )}
      </div>
    </div>
  )
}

/**
 * What Banda draws over a page a Thread drives (ADR 0029, decision 4), in
 * the page's own layer and not in it: a soft glow round it, and a glass
 * pill at its foot with the Thread, the step it takes, and Stop, which
 * stops that Thread there alone. A click on the title goes to the Thread.
 * Its cursor, labelled with the Thread, goes where its hands go before
 * they act.
 */
function Driving({
  driver,
  onThread,
  onStop,
}: {
  driver: Driver
  onThread: (agent: string) => void
  onStop: () => void
}) {
  const thread = useThreadOf(driver.agent)
  const title = thread?.title ?? "An Agent"
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 shadow-[inset_0_0_30px_color-mix(in_srgb,var(--primary)_40%,transparent)]"
      />
      {driver.at && <Cursor at={driver.at} title={title} />}
      <Pill label={`${title} drives this tab`} className="pl-2 ring-border">
        <BandaMark
          state={thread?.mark ?? "running"}
          variant="agent"
          playful={0}
          news={false}
          className="size-4"
        />
        <ThreadLink
          title={title}
          onClick={() => onThread(driver.agent)}
          className="min-w-0 truncate"
        />
        <span className="min-w-0 truncate opacity-70">· {driver.step}</span>
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0 rounded-full"
          aria-label={`Stop ${title} in this tab`}
          onClick={onStop}
        >
          Stop
        </Button>
      </Pill>
    </>
  )
}

/** A glass pill at the foot of a page, over it, which says what a Thread
 * does there. */
function Pill({
  label,
  className,
  children,
}: {
  label: string
  className: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-popover py-1 pr-1 text-xs whitespace-nowrap text-popover-foreground shadow-lg ring-1",
        className
      )}
    >
      {children}
    </div>
  )
}

/** A Thread's title, which goes to the Thread. */
function ThreadLink({
  title,
  onClick,
  className,
}: {
  title: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      title="Go to the Thread"
      onClick={onClick}
      className={cn("font-semibold hover:underline", className)}
    >
      {title}
    </button>
  )
}

/**
 * What Banda draws over a page where the Person stopped a Thread (ADR
 * 0029, decision 6): a pill with the Thread, ringed as what waits for the
 * Person, and the answer that lets it drive there again.
 */
function Stopped({
  agent,
  onThread,
  onLet,
}: {
  agent: string
  onThread: (agent: string) => void
  onLet: () => void
}) {
  const title = useThreadOf(agent)?.title ?? "An Agent"
  return (
    <Pill
      label={`${title} is stopped in this tab`}
      className="pl-3 ring-attention/60"
    >
      <span className="min-w-0 truncate">
        Stopped <ThreadLink title={title} onClick={() => onThread(agent)} />
      </span>
      <Button
        variant="outline"
        size="xs"
        className="shrink-0 rounded-full"
        onClick={onLet}
      >
        Let drive again
      </Button>
    </Pill>
  )
}

/**
 * What Banda draws over a page a Thread handed to the Person (ADR 0029,
 * decisions 6 and 7, E): a card at its top, ringed as what waits for the
 * Person, that says what is theirs to do there, and hands the tab back
 * once they are done.
 */
function HandedOver({
  wait,
  onThread,
  onDone,
}: {
  wait: Handed
  onThread: (agent: string) => void
  onDone: () => void
}) {
  const title = useThreadOf(wait.agent)?.title ?? "An Agent"
  return (
    <div
      role="status"
      aria-label={`${title} handed this tab to you`}
      className="pointer-events-auto absolute inset-x-3 top-3 flex items-center gap-2.5 rounded-lg bg-popover py-2 pr-2 pl-3 text-xs text-popover-foreground shadow-lg ring-1 ring-attention/60"
    >
      <p className="min-w-0 flex-1 leading-snug">
        <b className="text-attention">Your turn.</b> {wait.why}.{" "}
        <span className="opacity-70">
          <ThreadLink title={title} onClick={() => onThread(wait.agent)} />{" "}
          waits, and never sees what you type in a password field.
        </span>
      </p>
      <Button
        size="xs"
        className="shrink-0 bg-attention text-popover hover:bg-attention/90"
        onClick={onDone}
      >
        Done — hand back
      </Button>
    </div>
  )
}

/** The cursor of a Thread's hands at `at`, labelled with the Thread: it
 * glides there, as the hands wait for it to. */
function Cursor({ at, title }: { at: Point; title: string }) {
  return (
    <div
      aria-hidden
      data-cursor={title}
      className="absolute top-0 left-0 flex items-start transition-transform duration-300 ease-out motion-reduce:transition-none"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <MousePointer2Icon
        fill="var(--primary)"
        stroke="white"
        strokeWidth={1.6}
        className="-mt-[3px] -ml-[3px] size-[18px] drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.3)]"
      />
      <span className="mt-3 -ml-1 max-w-40 truncate rounded-md bg-primary px-1.5 py-px text-[10.5px] font-semibold text-primary-foreground">
        {title}
      </span>
    </div>
  )
}

/** How long the pointer rests on the rail before it opens to titles. */
const OPENING = 250

/**
 * The tabs as a narrow rail of icons beside the page, opening to titles
 * while the pointer rests on it. The titles lie over the page, which is
 * drawn over the workspace, so they open in the window's top layer; the
 * pointer in them is still on the rail, as React sees it.
 */
function LeftTabs(tabs: TabsProps) {
  const rail = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState<DOMRect | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div
      ref={rail}
      onPointerEnter={() => {
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          const box = rail.current?.getBoundingClientRect()
          if (box) setOver(box)
        }, OPENING)
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current)
        setOver(null)
      }}
      className="flex w-10 shrink-0 flex-col border-r bg-tile"
    >
      <TabStrip {...tabs} side="left" />
      {over && (
        <TopLayer>
          <div
            data-browser-titles=""
            style={{ top: over.top, left: over.left, height: over.height }}
            className="fixed z-50 flex w-60 flex-col border-r bg-popover shadow-lg"
          >
            <TabStrip {...tabs} side="titles" />
          </div>
        </TopLayer>
      )}
    </div>
  )
}

/**
 * The tabs and the new-tab button: a row at the start of the Pane's row,
 * as Helium's, or a column of icons on the rail, or of titles over it.
 */
function TabStrip({
  args,
  onShow,
  onClose,
  onNew,
  side,
}: TabsProps & { side: "top" | "left" | "titles" }) {
  const top = side === "top"
  return (
    <div
      className={cn(
        "flex min-w-0 gap-0.5",
        top ? "flex-auto items-center" : "min-h-0 flex-1 flex-col"
      )}
    >
      <div
        role="tablist"
        aria-label="Tabs"
        aria-orientation={top ? undefined : "vertical"}
        className={cn(
          "flex min-w-0 gap-0.5",
          top ? "items-center overflow-hidden" : "flex-col overflow-y-auto p-1"
        )}
      >
        {args.tabs.map((tab, at) => (
          <TabItem
            key={tab.id}
            tab={tab}
            shown={at === args.shown}
            onShow={() => onShow(at)}
            onClose={() => onClose(at)}
            iconOnly={side === "left"}
            className={top ? "h-7 w-44 min-w-9 shrink" : "h-8 w-full shrink-0"}
          />
        ))}
      </div>
      <div
        className={cn(
          !top && "mt-auto p-1",
          side === "left" && "flex justify-center"
        )}
      >
        <NewTab onNew={onNew} />
      </div>
    </div>
  )
}

/** One tab: its site's icon, its title, and its close button on hover;
 * the Agent's mark while one drives it. */
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
  const page = pageAt(tab.id)
  const state = page?.state
  const words = state?.title || titleOf(tab)
  const mark = (state?.driven || state?.driver) && (
    <Driven
      contents={page?.contents}
      words={words}
      thread={state.driver !== null}
    />
  )
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
      {(iconOnly && mark) || <TabIcon state={state} />}
      {!iconOnly && <span className="min-w-0 flex-1 truncate">{words}</span>}
      {!iconOnly && mark}
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

/** Stops what drives the page of `contents`: a Thread there alone, else
 * every session on it (ADR 0013, decision 7). */
function stopIn(contents: number | null | undefined, thread: boolean) {
  if (contents == null) return
  if (thread) browserHost()?.release(contents)
  else browserHost()?.stop(contents)
}

/** The mark of an Agent that drives the tab, a stop under the pointer.
 * A click stops it: a Thread there alone (ADR 0029, decision 4), else
 * every session on the tab ends (ADR 0013, decision 7). */
function Driven({
  contents,
  words,
  thread,
}: {
  contents: number | null | undefined
  words: string
  /** A Thread drives it with Banda's tools. */
  thread: boolean
}) {
  return (
    <button
      type="button"
      aria-label={`Stop the Agent in ${words}`}
      title="An Agent drives this tab: click to stop it"
      onClick={(event) => {
        event.stopPropagation()
        stopIn(contents, thread)
      }}
      className="group/stop flex size-5 shrink-0 items-center justify-center rounded text-primary hover:bg-foreground/10 [&_svg]:size-3.5"
    >
      <BotIcon className="group-hover/stop:hidden" />
      <SquareIcon className="hidden fill-current group-hover/stop:block" />
    </button>
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
    <Empty className="h-full bg-tile">
      <EmptyDescription>{children}</EmptyDescription>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

type PageDoes = Exclude<Does, "address" | TabKey>

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
