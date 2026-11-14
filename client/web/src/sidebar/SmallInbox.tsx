import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Engine } from "@banda/contract"
import { type Here, useHere, useRun } from "@banda/core/react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { focusedTile } from "@banda/ui/pane"
import { Dismiss } from "./open"

/** The small inbox's list, the sidebar's own parts, which reach the
 * registry that lists the counts: it loads as the small inbox first
 * opens, so the counts load before the registry does. */
const SmallList = lazy(() =>
  import("./SmallList").then(({ SmallList }) => ({ default: SmallList }))
)

/** Whether the Sidebar shows: the small inbox never shows with it. */
const sidebarOf = (here: Here) => here.sidebar

/** The counts' look on the Bar, whichever way a click goes. */
const TRIGGER =
  "flex h-6 items-center gap-2.5 rounded-control px-2 text-meta font-semibold tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"

/** Where the focus is no popup of the small inbox's own takes it from:
 * a card's menu, the Later picker, a dialog, a toast, a cut title's tip. */
const OTHER_LAYERS =
  '[data-slot="popover-content"], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toaster], [data-slot="cut-tip"]'

/** Whether `node` stands in a popup other than the small inbox. */
function inOtherLayer(node: unknown, inbox: Element | null): boolean {
  if (!(node instanceof Element)) return false
  const layer = node.closest(OTHER_LAYERS)
  return layer !== null && layer !== inbox && !inbox?.contains(layer)
}

/**
 * The counts in the Bar's middle as a button, and the small inbox a click
 * opens (ADR 0098, decision 22, as amended): `children` is what the counts
 * draw, `label` what they say. The small inbox is a popover under them,
 * the sidebar's own list of Your turn in its cards with the same keys
 * (`SmallList`), and "7 at work ›" while `working` Agents work, which
 * shows the sidebar on Working with the focus in its list. Esc gives the
 * focus back where it was before it opened; a card opened, the Pane has
 * it. While the sidebar shows, its list is the one: a click takes the
 * focus there, on its Inbox.
 */
export function SmallInbox({
  engine,
  working,
  label,
  children,
}: {
  engine: Engine
  working: number
  label: string
  children: ReactNode
}) {
  const sidebar = useHere(sidebarOf)
  const run = useRun()
  if (sidebar)
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        className={TRIGGER}
        onClick={() => run("sidebar.show", { tab: "inbox" })}
      >
        {children}
      </button>
    )
  return (
    <Inbox engine={engine} working={working} label={label}>
      {children}
    </Inbox>
  )
}

/** The small inbox's popover and the counts that open it, while the
 * sidebar is hidden. */
function Inbox({
  engine,
  working,
  label,
  children,
}: {
  engine: Engine
  working: number
  label: string
  children: ReactNode
}) {
  const run = useRun()
  const [open, setOpen] = useState(false)
  // Where the focus was as it opened, which Esc gives it back to.
  const before = useRef<Element | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const giveBack = useCallback(() => {
    const to = before.current
    before.current = null
    if (to instanceof HTMLElement && to.isConnected && to !== document.body)
      to.focus({ preventScroll: true })
    else focusedTile()?.focus({ preventScroll: true })
  }, [])
  const close = (back: boolean) => {
    setOpen(false)
    if (back) giveBack()
    else before.current = null
  }
  // Never with the sidebar: shown, as by Alt+A, it takes the small inbox
  // away, and the focus goes back where it was, not to the page.
  useLayoutEffect(() => {
    const was = before
    return () => {
      if (was.current) giveBack()
    }
  }, [giveBack])
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          before.current ??= document.activeElement
          return setOpen(true)
        }
        const { reason, event } = details
        // Esc the list took, or one pressed in a popup of a card's, is
        // not the small inbox's.
        if (
          reason === "escape-key" &&
          (event.defaultPrevented ||
            !popup.current?.contains(event.target as Node))
        )
          return details.cancel()
        // A card's menu, the Later picker or a dialog over it keeps it.
        const at =
          reason === "focus-out"
            ? (event as FocusEvent).relatedTarget
            : event.target
        if (
          (reason === "focus-out" || reason === "outside-press") &&
          inOtherLayer(at, popup.current)
        )
          return details.cancel()
        close(reason === "escape-key")
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            onPointerDown={() => {
              if (!open) before.current = document.activeElement
            }}
            className={TRIGGER}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        ref={popup}
        aria-label="Inbox"
        data-small-inbox=""
        // The sidebar's list, where the window's keys work, as Alt+A.
        data-window-keys=""
        side="bottom"
        align="center"
        // The list takes the focus as it is drawn (`SmallList`); where it
        // goes back to is the small inbox's own (`close`).
        initialFocus={false}
        finalFocus={false}
        className="w-96 gap-0 p-1.5"
      >
        <Dismiss value={() => close(false)}>
          <Suspense>
            <SmallList
              engine={engine}
              working={working}
              onEsc={() => close(true)}
              onWorking={() => {
                close(false)
                run("sidebar.show", { tab: "working" })
              }}
            />
          </Suspense>
        </Dismiss>
      </PopoverContent>
    </Popover>
  )
}
