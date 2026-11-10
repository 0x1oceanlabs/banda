/**
 * How a Visual's frame and its Thread talk (ADR 0037, decisions 4 and 5):
 * where the window serves its page, the look the page wears, and what the
 * page says back. The words are MCP Apps', as T3 Code's are, so the same
 * frame can host MCP Apps later. Main's part of the agents module serves
 * the page with the script that speaks them; the Thread's Pane speaks the
 * other side. Pure, so plain tests cover it.
 */

import type { Fit } from "@banda/contract/agents"
import { type Look, RENAMED, shown } from "@banda/contract/look"

/** The host of `app://` that serves Visuals: an origin apart from
 * Banda's page. */
export const VISUALS = "visuals"

export const visualAddress = (project: string, visual: string): string =>
  `app://${VISUALS}/${project}/${visual}`

/** What a Visual's page may do: run its scripts and forms, and nothing
 * of its origin's, as both its frame and its response say. */
export const SANDBOX = "allow-scripts allow-forms"

/** The fragment that gives the page its first look, before it paints. */
export const LOOK_KEY = "banda-look"

export const SAID = {
  /** The window to the page: the look changed. */
  look: "ui/notifications/host-context-changed",
  /** The page to the window: its height now. */
  size: "ui/notifications/size-changed",
  /** The page to the window: open this address. */
  link: "ui/open-link",
  /** The page to the window: a key it left to the window. Banda's own
   * word, as MCP Apps has none. */
  key: "banda/key",
} as const

/** The keys a page leaves to the window, when it does not take them:
 * `Esc`, and Ctrl or ⌘ with + − 0, so a preview closes and zooms with
 * the keyboard in its page too. No other, so a page cannot press the
 * window's keys. */
export const PASSED = ["Escape", "Equal", "Minus", "Digit0"] as const

type PassedCode = (typeof PASSED)[number]

/** What each passed key types, as a US keyboard's does. */
const TYPES: Record<PassedCode, [string, string]> = {
  Escape: ["Escape", "Escape"],
  Equal: ["=", "+"],
  Minus: ["-", "_"],
  Digit0: ["0", ")"],
}

/** A key the page passed: its code and key, and what was held. */
export type Passed = {
  code: PassedCode
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** How tall a frame grows to fit its page, in pixels. */
const FITS = { least: 80, most: 20_000 } as const

const within = (height: number) =>
  Math.min(FITS.most, Math.max(FITS.least, Math.ceil(height)))

/** How tall a frame `width` wide is before its page says: the height the
 * window found at the widest width laid out that fits in it (the
 * narrowest, in a narrower frame), or else the Agent's. `fits` come
 * narrowest first, as the window lays them out. */
export function heightAt(
  fits: readonly Fit[],
  width: number,
  height: number
): number {
  const fit = fits.findLast((one) => one.width <= width) ?? fits[0]
  return within(fit?.height ?? height)
}

/** The zooms a Visual's preview steps through, as a browser's do,
 * from 50 to 200 % (ADR 0037, decision 6). */
export { ZOOMS } from "@banda/ui/lib/zoom"

export type Theme = "light" | "dark"

/** The look a Visual wears: T3 Code's variable names, Banda's colours. */
export type VisualLook = {
  theme: Theme
  variables: Record<string, string>
}

/** The variables a page may use, as T3 Code names them, that the look
 * has under the same names. */
const SAME = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--font-sans",
  "--font-mono",
]

/** The rest, each with the look's token nearest it. */
const NEAREST: Readonly<Record<string, string>> = {
  "--destructive-foreground": "--primary-foreground",
  "--warning": "--attention",
  "--warning-foreground": "--primary-foreground",
  "--success": "--added",
  "--success-foreground": "--primary-foreground",
  "--info": "--chart-2",
  "--info-foreground": "--primary-foreground",
  "--code-background": "--muted",
  "--code-foreground": "--foreground",
  "--chart-6": "--chart-1",
  // A renamed token under its old name (ADR 0100, decision 10): shadcn's
  // `--radius`, a control's corner now.
  ...Object.fromEntries(
    Object.entries(RENAMED).map(([old, now]) => [`--${old}`, `--${now}`])
  ),
}

/** A soft ground of a colour, for a box that says it. */
const SURFACES = ["--accent", "--destructive", "--warning"]

/** The look for a page, from `read`, which gives a token's value now. */
export function visualLook(
  read: (token: string) => string,
  dark: boolean
): VisualLook {
  const variables: Record<string, string> = {}
  const pairs = [
    ...SAME.map((name) => [name, name]),
    ...Object.entries(NEAREST),
  ]
  for (const [name, token] of pairs) {
    const value = read(token).trim()
    if (value) variables[name] = value
  }
  for (const name of SURFACES) {
    const colour = variables[name]
    if (colour)
      variables[`${name}-surface`] =
        `color-mix(in oklab, ${colour} 16%, transparent)`
  }
  return { theme: dark ? "dark" : "light", variables }
}

/** The look for a page from the look's own values, light or dark as
 * asked, as main lays a page out with no window to read it from: the
 * scheme the window would show (`shown`) over the look's vars, as the
 * window applies them. */
export function visualLookOf(look: Look | null, dark: boolean): VisualLook {
  if (!look) return visualLook(() => "", dark)
  const scheme = shown({ ...look, mode: dark ? "dark" : "light" }, dark)
  const tokens = { ...look.vars, ...scheme.colors }
  // The look names the font families under longer names than the page's,
  // as globals.css does.
  const families: Record<string, string> = {
    "--font-sans": tokens["--font-family-sans"] ?? "",
    "--font-mono": tokens["--font-family-mono"] ?? "",
  }
  return visualLook(
    (token) => tokens[token] ?? families[token] ?? "",
    scheme.dark
  )
}

/** The look as MCP Apps' host context says it, in the address's fragment
 * and in each message alike. */
const context = (look: VisualLook) => ({
  theme: look.theme,
  styles: { variables: look.variables },
})

/** The page's address with its first look. */
export function lookedAt(address: string, look: VisualLook): string {
  const first = encodeURIComponent(JSON.stringify(context(look)))
  return `${address}#${LOOK_KEY}=${first}`
}

/** What the window posts the page when the look changes. */
export function lookMessage(look: VisualLook): unknown {
  return { jsonrpc: "2.0", method: SAID.look, params: context(look) }
}

export type Heard =
  | { kind: "size"; height: number }
  | { kind: "link"; url: string }
  | { kind: "key"; key: Passed }

const held = (said: Record<string, unknown>, name: keyof Passed) =>
  said[name] === true

/** What a page said, if it is something the window takes. */
export function heard(data: unknown): Heard | null {
  if (typeof data !== "object" || data === null) return null
  const { method, params } = data as { method?: unknown; params?: unknown }
  const said = (params ?? {}) as Record<string, unknown>
  if (method === SAID.size && typeof said.height === "number") {
    if (!Number.isFinite(said.height)) return null
    return { kind: "size", height: within(said.height) }
  }
  if (method === SAID.link && typeof said.url === "string") {
    const url = URL.parse(said.url)
    return url && (url.protocol === "https:" || url.protocol === "http:")
      ? { kind: "link", url: url.href }
      : null
  }
  if (method === SAID.key) {
    const code = PASSED.find((one) => one === said.code)
    const ctrl = held(said, "ctrlKey") || held(said, "metaKey")
    // Esc on its own; the rest with Ctrl or ⌘.
    if (!code || (code === "Escape") === ctrl) return null
    return {
      kind: "key",
      key: {
        code,
        key: TYPES[code][held(said, "shiftKey") ? 1 : 0],
        ctrlKey: held(said, "ctrlKey"),
        metaKey: held(said, "metaKey"),
        shiftKey: held(said, "shiftKey"),
        altKey: held(said, "altKey"),
      },
    }
  }
  return null
}
