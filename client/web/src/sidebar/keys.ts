/**
 * The sidebar's keys (ADR 0098, decision 13; spec §2.7), each an action of
 * its scope, `sidebar`, the whole sidebar (ADR 0071, decision 1): the
 * window matches them, `keys.toml` moves them in `[binds.sidebar]`, and
 * the key sheet lists them. They hold no mod, so they work only while the
 * focus is in the sidebar, and a field there types them; Undo holds Ctrl,
 * or ⌘ on a Mac, as a field's own does, and so does Delete's second key,
 * Ctrl+Backspace, ⌘⌫ on a Mac. The acts on the pick
 * work while the focus is in the list; Undo, `/`, which opens the Banda
 * menu, the one search (Roma, 2026-11-12), and the tabs' digits anywhere
 * in the sidebar. The arrows, Home, End, the pages and Esc are the list's
 * own, as a list's are. Pure, so plain tests cover it.
 */
import type { Key } from "@banda/ui/lib/keys"
import { TABS, type Tab } from "./inbox"

/** The sidebar's scope: the aside. */
export const SIDEBAR = "sidebar"

/** What a key of the sidebar does. */
export type Does =
  | "open"
  | "beside"
  | "archive"
  | "later"
  | "unread"
  | "undo"
  | "rename"
  | "suggest"
  | "menu"
  | "delete"
  | "search"
  | `tab-${Tab}`

/** What a tab's key is called, in the tabs' order. */
const TAB_TITLES: Readonly<Record<Tab, string>> = {
  inbox: "Show the Inbox",
  working: "Show Working",
  later: "Show Later",
  archive: "Show the Archive",
}

/** Each key's action: what it does, its id for `keys.toml`, its title in
 * the key sheet, and Banda's keys for it. */
export const SIDEBAR_KEYS: readonly {
  does: Does
  id: string
  title: string
  keys: readonly Key[]
}[] = [
  {
    does: "open",
    id: "sidebar.open-picked",
    title: "Open the card picked, or go to where its unseen begins",
    keys: [{ code: "Enter" }],
  },
  {
    does: "beside",
    id: "sidebar.open-picked-beside",
    title: "Open the card picked beside the Pane in focus",
    keys: [{ code: "Enter", shift: true }],
  },
  {
    does: "archive",
    id: "sidebar.archive-picked",
    title: "Archive the card picked, or bring it back",
    keys: [{ code: "KeyS" }],
  },
  {
    does: "later",
    id: "sidebar.later-picked",
    title: "Put the card picked off till later",
    keys: [{ code: "KeyZ" }],
  },
  {
    does: "unread",
    id: "sidebar.unread-picked",
    title: "Mark the card picked as unread, or as read",
    keys: [{ code: "KeyU" }],
  },
  {
    does: "undo",
    id: "sidebar.undo",
    title: "Undo the last act on a card",
    keys: [{ code: "KeyZ", primary: true }],
  },
  {
    does: "rename",
    id: "sidebar.rename-picked",
    title: "Rename the card picked",
    keys: [{ code: "F2" }],
  },
  {
    does: "suggest",
    id: "sidebar.suggest-title-picked",
    title: "Suggest a title for the card picked",
    keys: [{ code: "F2", shift: true }],
  },
  {
    does: "menu",
    id: "sidebar.menu-picked",
    title: "Open the menu of the card picked",
    keys: [{ code: "F10", shift: true }, { code: "ContextMenu" }],
  },
  {
    does: "delete",
    id: "sidebar.delete-picked",
    title: "Delete the card picked in the Archive, after a confirmation",
    keys: [{ code: "Delete" }, { code: "Backspace", primary: true }],
  },
  {
    does: "search",
    id: "sidebar.search",
    title: "Search",
    keys: [{ code: "Slash" }],
  },
  ...TABS.map((tab, at) => ({
    does: `tab-${tab}` as const,
    id: `sidebar.tab-${tab}`,
    title: TAB_TITLES[tab],
    keys: [{ code: `Digit${at + 1}` }],
  })),
]

/** The acts on a card that a key held down does not do again: a held `S`
 * must not empty the inbox. */
export const ONCE: ReadonlySet<Does> = new Set([
  "archive",
  "later",
  "unread",
  "rename",
  "suggest",
  "delete",
])

/** The tab a key of the sidebar shows, if it shows one. */
export function tabOf(does: Does): Tab | undefined {
  return TABS.find((tab) => does === `tab-${tab}`)
}

/** The id of the action that does `does`. */
export function keyId(does: Does): string {
  return SIDEBAR_KEYS.find((key) => key.does === does)!.id
}

/** What the hint names, in its order (spec §2.8). */
const HINTED: readonly (readonly [Does, string])[] = [
  ["archive", "archives"],
  ["later", "puts off"],
  ["unread", "marks unread"],
]

/** The hint the list is described by (spec §2.8), with the keys in force
 * as `label` reads them: "S archives, Z puts off, U marks unread.
 * Shift+F10 for more."; none where none is bound. */
export function hintOf(
  label: (action: string) => string | undefined
): string | undefined {
  const said = HINTED.flatMap(([does, words]) => {
    const key = label(keyId(does))
    return key ? [`${key} ${words}`] : []
  })
  const menu = label(keyId("menu"))
  return (
    [said.length > 0 && `${said.join(", ")}.`, menu && `${menu} for more.`]
      .filter(Boolean)
      .join(" ") || undefined
  )
}
