/**
 * The sidebar's one door (the window's rule 1, `docs/window.md`): what the
 * rest of the page takes of it. Nothing outside this folder imports a file
 * inside it (`architecture.test.ts`), so what is not named here is the
 * sidebar's own to change.
 *
 *   draws   `Sidebar` and its `Edge`, at the Window's left; the Later's
 *           picker and the region it speaks in, which the Window mounts
 *           once; on the Bar, the counts (`countsWidget`), and beside the
 *           logo the small inbox with its count
 *   says    the one order of what calls, for Alt+U and the counts
 *           (`useOrderNow`, `byOrder`, `placeIn`); the logo's words
 *   takes   its keys' scope and list, which the Window registers; a tab
 *           to show; a width kept; a key of `sidebar.toml` to write
 *
 * What takes no part of the page comes first, then the counts, whose code
 * reaches neither the registry nor the Window's actions: both name these
 * as they load, and may load while the rest of this file still does.
 */
export { SIDEBAR, SIDEBAR_KEYS } from "./keys"
export { GROUP_WORDS, PRESET_WORDS, type Settings } from "./settings"
export { kept, WIDTH } from "./width"
export { askTab, isTab } from "./showing"
export { byOrder, placeIn, useOrderNow } from "./order"
export { countsWidget } from "./Counts"
export { logoName, logoWords } from "./count"
export { writeSidebar } from "./write-setting"
export { SmallInbox, useInboxCount } from "./SmallInbox"
export { LaterPicker, pickLater } from "./LaterPicker"
export { SaidRegion } from "./SaidRegion"
export { Edge } from "./Edge"
export { Sidebar } from "./Sidebar"
