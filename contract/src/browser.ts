/**
 * The browser module's words for TypeScript: a tab as its tools for
 * Agents see it, name it, read it, open it and move it (ADR 0029), and its `browser.toml` as
 * the look resolves it (ADR 0013, ADR 0016).
 */
import type { Browser } from "./generated/browser/Browser"
import type { ModuleFile } from "./look"

export type { Browser } from "./generated/browser/Browser"
export type { Navigate } from "./generated/browser/Navigate"
export type { OneTab } from "./generated/browser/OneTab"
export type { Open } from "./generated/browser/Open"
export type { ReadTab } from "./generated/browser/ReadTab"
export type { SeenTab } from "./generated/browser/SeenTab"
export type { Shown } from "./generated/browser/Shown"
export type { Tabs } from "./generated/browser/Tabs"

/** Banda's browser, as `banda look` gives it with no `browser.toml`: for
 * before the first look and outside the desktop. */
export const DEFAULT_BROWSER: Browser = {
  tabs: "top",
  search: "https://duckduckgo.com/?q=%s",
  pinned: [],
  blocker: true,
}

/** The browser's `browser.toml`. */
export const BROWSER_FILE: ModuleFile<Browser> = {
  name: "browser.toml",
  before: DEFAULT_BROWSER,
}
