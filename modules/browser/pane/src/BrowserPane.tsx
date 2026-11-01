/**
 * The browser's Pane (ADR 0013): one row as Helium's compact layout, and
 * under it a slot that the page, kept in the window's layer, follows.
 */
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { newId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
} from "@banda/ui/components/empty"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { definePane, HOLDS, type PaneProps } from "@banda/ui/pane"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  RotateCwIcon,
} from "lucide-react"
import { addressOf, siteOf } from "./address"
import { browserKey, type Does } from "./keys"
import { BLANK, drop, type Page, type PageState, pageOf } from "./pages"

/** One page of the browser, by the ID its page is kept under. */
export type Tab = { id: string; url: string; title: string }

/** A browser Pane's tabs, and which one it shows; one tab, for now. */
export type BrowserArgs = { tabs: Tab[]; shown: number }

/** A browser with no tab yet: the Address waits for the Person. */
export const NEW_BROWSER: BrowserArgs = { tabs: [], shown: 0 }

export const browserPane = definePane<BrowserArgs>({
  kind: "browser.browser",
  title: (args) => {
    const tab = args.tabs[args.shown]
    return tab?.title || (tab?.url ? siteOf(tab.url) : "Browser")
  },
  icon: GlobeIcon,
  start: NEW_BROWSER,
  header: false,
  closed: ({ args }) => {
    for (const tab of args.tabs) drop(tab.id)
  },
  Pane: BrowserPane,
})

function BrowserPane({ args, focused, update, close }: PaneProps<BrowserArgs>) {
  const tab = args.tabs[args.shown]
  const [chosen] = useState(newId)
  useEffect(() => {
    if (!tab) update({ tabs: [{ id: chosen, url: "", title: "" }], shown: 0 })
  })
  if (!tab) return null
  return (
    <Browser
      key={tab.id}
      tab={tab}
      focused={focused}
      title={browserPane.title(args)}
      onTab={(next) =>
        update({
          ...args,
          tabs: args.tabs.map((t) => (t.id === next.id ? next : t)),
        })
      }
      close={close}
    />
  )
}

function Browser({
  tab,
  focused,
  title,
  onTab,
  close,
}: {
  tab: Tab
  focused: boolean
  title: string
  onTab: (tab: Tab) => void
  close: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  // The page is made once there is an address to open.
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

  // The tab keeps where its page went, so it comes back there; a title
  // that keeps changing, as an unread count, is kept once a load settles.
  const { url, loading } = state
  useEffect(() => {
    if (!page || loading) return
    if (url !== tab.url || state.title !== tab.title) {
      onTab({ ...tab, url: url || tab.url, title: state.title })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a settled load
  }, [page, url, loading])

  // A tile that takes the focus gives it to its page, or to the address.
  useEffect(() => {
    if (!focused || root.current?.contains(document.activeElement)) return
    if (page) page.focus()
    else address.current?.focus()
  }, [focused, page])

  // The first address typed made the page: it takes the keys.
  const made = useRef(page !== null)
  useEffect(() => {
    if (!page || made.current) return
    made.current = true
    page.focus()
  }, [page])

  const open = (typed: string) => {
    const to = addressOf(typed)
    if (page) page.load(to)
    else onTab({ ...tab, url: to })
  }

  useEffect(() => {
    if (!focused) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      const does = browserKey(event)
      if (!does) return
      event.preventDefault()
      if (does === "address") address.current?.focus()
      else if (page) ON_PAGE[does](page)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused, page])

  return (
    <div ref={root} className="flex h-full flex-col">
      <PaneHeader title={title} onClose={close} className="gap-1 px-1.5">
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
          url={state.url || tab.url}
          onOpen={open}
          onLeave={() => page?.focus()}
        />
      </PaneHeader>
      <div
        ref={slot}
        {...{ [HOLDS]: tab.id }}
        className="relative min-h-0 flex-1 bg-background"
      >
        <Notice state={state} page={page} url={tab.url} />
      </div>
    </div>
  )
}

/**
 * The address: the site while the Person reads, the whole address while
 * they edit it. Enter opens what they typed; Esc goes back to the page.
 */
function Address({
  ref,
  url,
  onOpen,
  onLeave,
}: {
  ref: React.Ref<HTMLInputElement>
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
      className="mx-1 h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-muted-foreground outline-none group-data-[focused=true]/tile:text-foreground placeholder:text-muted-foreground/70 hover:bg-muted focus:bg-muted focus:text-foreground"
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

/** What each of the browser's keys does to the page. */
const ON_PAGE: Record<Exclude<Does, "address">, (page: Page) => void> = {
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
