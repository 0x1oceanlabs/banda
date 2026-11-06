/**
 * The browser module's words for TypeScript: a tab as its tools for
 * Agents see it, name it, read it, open it, move it and act in it (ADR
 * 0029), a tab the Person lent a Thread (ADR 0083), and its `browser.toml`
 * as the look resolves it (ADR 0013, ADR 0016).
 */
import type { Browser } from "./generated/browser/Browser"
import type { ModuleFile } from "./look"

export type { Browser } from "./generated/browser/Browser"
export type { Act } from "./generated/browser/Act"
export type { Action } from "./generated/browser/Action"
export type { Dialog } from "./generated/browser/Dialog"
export type { Handoff } from "./generated/browser/Handoff"
export type { Lending } from "./generated/browser/Lending"
export type { LentAsk } from "./generated/browser/LentAsk"
export type { Direction } from "./generated/browser/Direction"
export type { Navigate } from "./generated/browser/Navigate"
export type { OneTab } from "./generated/browser/OneTab"
export type { Open } from "./generated/browser/Open"
export type { ReadTab } from "./generated/browser/ReadTab"
export type { SeenTab } from "./generated/browser/SeenTab"
export type { Screenshot } from "./generated/browser/Screenshot"
export type { Shown } from "./generated/browser/Shown"
export type { SiteRule } from "./generated/browser/SiteRule"
export type { WaitFor } from "./generated/browser/WaitFor"
export type { Tabs } from "./generated/browser/Tabs"

/** Banda's browser, as `banda look` gives it with no `browser.toml`: for
 * before the first look and outside the desktop. */
export const DEFAULT_BROWSER: Browser = {
  tabs: "top",
  search: "https://duckduckgo.com/?q=%s",
  pinned: [],
  blocker: true,
  sites: {},
  tools: true,
  screenshots: false,
}

/** The key of `site` in `browser.toml`: `agents.sites."github.com"`. */
export const siteKey = (site: string) => `agents.sites.${JSON.stringify(site)}`

/** The browser's `browser.toml`. */
export const BROWSER_FILE: ModuleFile<Browser> = {
  name: "browser.toml",
  before: DEFAULT_BROWSER,
}
