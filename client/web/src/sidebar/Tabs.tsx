import { createContext, type KeyboardEvent, useContext } from "react"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import { STAND_WORDS } from "@banda/ui/status"
import { ArchiveIcon } from "lucide-react"
import { TABS, type Tab, type TabCount } from "./inbox"

/** How a part of the sidebar shows a tab, at one of its blocks by its key
 * when it names one: the Sidebar's, whose view keeps it; none outside
 * one. */
export const ShowTab = createContext<
  ((tab: Tab, block?: string) => void) | undefined
>(undefined)

/** Each tab's name: the Inbox's, then each place's as its heading names
 * it, so a tab and the part it shows say the same. */
export const TAB_WORDS: Readonly<Record<Tab, string>> = {
  inbox: "Inbox",
  working: STAND_WORDS.working,
  later: STAND_WORDS.later,
  archive: STAND_WORDS.archived,
}

/** The tab's element's id, and the panel's, which the tab controls. */
export const tabId = (tab: Tab) => `sb-tab-${tab}`
export const PANEL = "sb-panel"

/** What a tab is called aloud: its name, and how many it holds when it
 * holds any, the Archive's too, which shows none (ADR 0098, decision 2). */
export function tabName(tab: Tab, { count }: TabCount): string {
  return count > 0 ? `${TAB_WORDS[tab]}, ${count}` : TAB_WORDS[tab]
}

/** Where the arrows go along the tabs: the next or the one before, round
 * the ends, or the first or the last. */
const STEPS: Readonly<Record<string, (at: number) => number>> = {
  ArrowRight: (at) => (at + 1) % TABS.length,
  ArrowLeft: (at) => (at + TABS.length - 1) % TABS.length,
  Home: () => 0,
  End: () => TABS.length - 1,
}

/**
 * The tabs under the search (ADR 0098, decision 2): Inbox, Working and
 * Later, then the Archive as an icon at the right. A count is plain text;
 * the Inbox's is in the attention colour while something is the Person's
 * turn, and the Archive's is in its tooltip. A switch draws the tab as it
 * is, with no motion, and the focus goes with it (`show`). One of them is
 * a Tab stop, the arrows go along them, and their keys, `1`–`4`, show
 * them from anywhere in the sidebar (`keys.ts`). At the sidebar's own
 * width three counts fit with every word whole, so the tabs are tight and
 * a count takes only its digits; a narrower sidebar cuts the words short,
 * and the Archive's icon always shows whole.
 */
export function Tabs({
  tabs,
  tab,
}: {
  tabs: Readonly<Record<Tab, TabCount>>
  tab: Tab
}) {
  const show = useContext(ShowTab)
  const keyFor = useKeyLabel()
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key]
    if (!step) return
    event.preventDefault()
    show?.(TABS[step(TABS.indexOf(tab))]!)
  }
  return (
    <div
      role="tablist"
      aria-label="Threads by where they stand"
      className="flex items-center gap-0.5 px-1.5 pb-1.5"
      onKeyDown={onKeyDown}
    >
      {TABS.map((one) => {
        const { count, calls } = tabs[one]
        const archive = one === "archive"
        const words =
          archive && count > 0
            ? `${TAB_WORDS.archive} · ${count}`
            : TAB_WORDS[one]
        return (
          <button
            key={one}
            id={tabId(one)}
            type="button"
            role="tab"
            aria-selected={one === tab}
            aria-controls={PANEL}
            aria-label={tabName(one, tabs[one])}
            tabIndex={one === tab ? 0 : -1}
            title={keyFor(`sidebar.tab-${one}`, words)}
            onClick={() => show?.(one)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-control px-1.5 text-ui whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              archive ? "ml-auto shrink-0 px-1.5" : "min-w-0",
              one === tab
                ? "bg-foreground/8 text-foreground"
                : "text-muted-foreground/70 hover:text-foreground"
            )}
          >
            {archive ? (
              <ArchiveIcon className="size-3.5" />
            ) : (
              <span className="truncate">{TAB_WORDS[one]}</span>
            )}
            {!archive && count > 0 && (
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  calls
                    ? "font-semibold text-attention"
                    : "text-muted-foreground"
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
