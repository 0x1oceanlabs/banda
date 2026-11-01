/**
 * A browser Pane's tabs (ADR 0013, decision 3), kept in its args so the
 * Pane comes back as it was: each tab's address and title, and which one
 * shows. Every change here is a new args; the pages follow them.
 */

/** One page of the browser, by the ID its page is kept under. */
export type Tab = { id: string; url: string; title: string }

/** A browser Pane's tabs, and which one it shows. */
export type BrowserArgs = { tabs: Tab[]; shown: number }

/** A browser with no tab yet: it opens one, and the Address waits. */
export const NEW_BROWSER: BrowserArgs = { tabs: [], shown: 0 }

/** A tab with nothing in it yet. */
export function blankTab(id: string): Tab {
  return { id, url: "", title: "" }
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
