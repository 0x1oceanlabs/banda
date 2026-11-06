/**
 * A browser Pane's tabs (ADR 0013, decision 3), kept in its args so the
 * Pane comes back as it was: each tab's address and title, whose profile
 * it loads in, and which one shows. Every change here is a new args; the
 * pages follow them.
 */
import { newId, type ProjectId } from "@banda/contract"

/**
 * One page of the browser, by the ID its page is kept under. A tab of a
 * Project's Agents names that Project, `agents`, and loads in their
 * profile, apart from the Person's; it keeps it for as long as it lives,
 * a restart too (ADR 0083, decision 4). The Person's names none.
 */
export type Tab = { id: string; url: string; title: string; agents?: ProjectId }

/** A browser Pane's tabs, and which one it shows. */
export type BrowserArgs = { tabs: Tab[]; shown: number }

/** A browser with no tab yet: it opens one, and the Address waits. */
export const NEW_BROWSER: BrowserArgs = { tabs: [], shown: 0 }

/** A tab with nothing in it yet: the Person's, or one of `agents`'. */
export function blankTab(id: string, agents?: ProjectId): Tab {
  return { id, url: "", title: "", ...(agents ? { agents } : {}) }
}

/**
 * `args` with `tab` at `at`, or last; it shows unless `background`, and
 * the tab that showed still does then.
 */
export function withTab(
  args: BrowserArgs,
  tab: Tab,
  at = args.tabs.length,
  background = false
): BrowserArgs {
  const tabs = [...args.tabs]
  tabs.splice(at, 0, tab)
  const before = args.tabs[args.shown]
  const shown = background && before ? tabs.indexOf(before) : at
  return { tabs, shown }
}

/**
 * `args` without the tab at `at`; none when it was the last. The tab to
 * its right shows when it showed, else the one to its left.
 */
export function withoutTab(args: BrowserArgs, at: number): BrowserArgs | null {
  const tabs = args.tabs.filter((_, i) => i !== at)
  if (!tabs.length) return null
  const shown =
    at < args.shown || (at === args.shown && at === tabs.length)
      ? args.shown - 1
      : args.shown
  return { tabs, shown }
}

/** `args` showing the tab `by` places from the shown one, round the ends. */
export function stepped(args: BrowserArgs, by: number): BrowserArgs {
  const count = args.tabs.length
  if (!count) return args
  return { ...args, shown: (((args.shown + by) % count) + count) % count }
}

/** `args` showing the tab at `at`; Chrome's Ctrl+9 is always the last. */
export function showing(args: BrowserArgs, at: number): BrowserArgs {
  if (!args.tabs.length) return args
  return { ...args, shown: Math.min(Math.max(at, 0), args.tabs.length - 1) }
}

/** `args` with the tab of `next.id` as `next`; the same args when equal. */
export function withChanged(args: BrowserArgs, next: Tab): BrowserArgs {
  const at = args.tabs.findIndex((tab) => tab.id === next.id)
  const now = args.tabs[at]
  if (!now || (now.url === next.url && now.title === next.title)) return args
  return { ...args, tabs: args.tabs.with(at, next) }
}

/** The tabs closed lately, for Ctrl+Shift+T: the browser's, not a Pane's. */
const closed: Tab[] = []
const KEPT_CLOSED = 25

/** Keeps a closed tab to open again. */
export function keepClosed(tab: Tab): void {
  if (!tab.url) return
  closed.push(tab)
  if (closed.length > KEPT_CLOSED) closed.shift()
}

/** The tab closed last, once; none when none was. */
export function lastClosed(): Tab | undefined {
  return closed.pop()
}

/** What a tab key asks of the tabs: Chrome's, with Ctrl. */
export type TabKey =
  | "tab-new"
  | "tab-close"
  | "tab-reopen"
  | "tab-next"
  | "tab-previous"
  /** The tab at this place; Chrome's Ctrl+9 is always the last. */
  | `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

/**
 * `args` after the tab key `key`; none when it closed the last tab. A new
 * tab, or one opened again, takes the ID `id`.
 */
export function afterTabKey(
  args: BrowserArgs,
  key: TabKey,
  id: string
): BrowserArgs | null {
  switch (key) {
    case "tab-new":
      return withTab(args, blankTab(id))
    case "tab-close": {
      const gone = args.tabs[args.shown]
      if (gone) keepClosed(gone)
      return withoutTab(args, args.shown)
    }
    case "tab-reopen": {
      const back = lastClosed()
      return back ? withTab(args, { ...back, id }) : args
    }
    case "tab-next":
      return stepped(args, 1)
    case "tab-previous":
      return stepped(args, -1)
    default: {
      const place = Number(key.slice(4))
      return showing(args, place === 9 ? args.tabs.length : place - 1)
    }
  }
}

/**
 * A browser Pane's args as the window keeps them: its own, or a web
 * address alone, as an Agent opens a browser with `open_pane` (ADR 0032).
 */
export type KeptArgs = BrowserArgs | { url: string }

/**
 * `kept` as the Pane's own args: an address alone is a browser at it,
 * whose one tab is `id`; args with no tabs, a browser with none yet. An
 * address alone is how an Agent opens a browser, so its tab is the
 * Agents' of the Pane's Project, `project` (ADR 0083, decision 4).
 */
export function readArgs(
  kept: KeptArgs,
  id: string,
  project?: ProjectId
): BrowserArgs {
  if ("tabs" in kept && Array.isArray(kept.tabs)) return kept
  const url = "url" in kept && typeof kept.url === "string" ? kept.url : ""
  return url ? browserAt(url, id, project) : NEW_BROWSER
}

/** A browser that opens `url` in its one tab, `id`: the Person's, or one
 * of `agents`'. */
export function browserAt(
  url: string,
  id = newId(),
  agents?: ProjectId
): BrowserArgs {
  return { tabs: [{ ...blankTab(id, agents), url }], shown: 0 }
}
