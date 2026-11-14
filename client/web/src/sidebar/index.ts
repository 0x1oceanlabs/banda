/**
 * The sidebar's one door (the window's rule 1, `docs/window.md`): what the
 * rest of the page takes of it. Nothing outside this folder imports a file
 * inside it (`architecture.test.ts`), so what is not named here is the
 * sidebar's own to change.
 *
 *   draws   `Sidebar` and its `Edge`, at the Window's left; the Later's
 *           picker and the region it speaks in, which the Window mounts
 *           once; on the Bar, the counts (`countsWidget`), which open the
 *           small inbox
 *   says    the one order of what calls, for Alt+U and the counts
 *           (`useOrderNow`, `byOrder`, `placeIn`)
 *   takes   its keys' scope and list, which the Window registers; a tab
 *           to show; a width kept; a key of `sidebar.toml` to write
 *
 * What takes no part of the page comes first, then the counts, whose code
 * reaches neither the registry nor the Window's actions: both name these
 * as they load, and may load while the rest of this file still does.
 */
export { SIDEBAR, SIDEBAR_KEYS } from "./keys"
export { GROUP_WORDS, type Settings } from "./settings"
export { kept, WIDTH } from "./width"
export { askTab, isTab } from "./showing"
export { byOrder, placeIn, useOrderNow } from "./order"
export { countsWidget } from "./Counts"
export { writeSidebar } from "./write-setting"
export { LaterPicker, pickLater } from "./LaterPicker"
export { Edge } from "./Edge"
export { Sidebar } from "./Sidebar"
