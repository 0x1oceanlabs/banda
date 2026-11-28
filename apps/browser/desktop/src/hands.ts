/**
 * What only the window has of Banda's hands in a tab's page (ADR 0029):
 * the sites an Agent may use, the words the tab's Pane says of a step,
 * and the page's keyboard, which is Electron's. What the hands do in the
 * page itself is `@banda/browser-driver`'s, the driver's too (ADR 0132,
 * decision 3).
 */
import { comboOf, type Keyboard, type Modifier } from "@banda/browser-driver"
import { siteOf } from "@banda/browser-pane/desktop"
import type { Act, Navigate, WaitFor } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import type { KeyboardInputEvent, WebContents } from "electron"
import { getDomain } from "tldts-experimental"
import { isBandas, sendPress } from "./keys"

/** The site of a web page at `url`, which an Agent may use once the
 * Person says so (ADR 0029, decision 7, B): its domain, as a browser
 * takes a site to be, so github.com covers gist.github.com; and its host,
 * which a rule may name. None for this computer's own pages, which never
 * ask, nor for a page not of the web. */
export function siteAt(url: string): { host: string; site: string } | null {
  let address: URL
  try {
    address = new URL(url)
  } catch {
    return null
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") return null
  const host = address.hostname
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return null
  return { host, site: getDomain(host, { allowPrivateDomains: true }) ?? host }
}

/** Whether a page at `url` is on the web, at an http or https address,
 * or blank. */
export function onWeb(url: string): boolean {
  if (url === "about:blank") return true
  try {
    const { protocol } = new URL(url)
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/** The rule of `rules` for a page at `at`: its host's, or the nearest
 * domain's above it, up to its site's. */
export function ruleAt<R>(
  rules: Partial<Record<string, R>>,
  { host, site }: { host: string; site: string }
): R | undefined {
  for (let name = host; ; name = name.slice(name.indexOf(".") + 1)) {
    const rule = rules[name]
    if (rule !== undefined || name === site || !name.includes(".")) return rule
  }
}

/** How much of an element's name a step says. */
const NAMED = 40

/** The element of `ref` as the Person knows it: its name in quotes, as
 * its line in the tab's last snapshot, `tree`, has it; else its ref. */
const nameOf = (tree: string, ref: string) => {
  const line = tree.split("\n").find((line) => line.includes(`[ref=${ref}]`))
  const name = line && /- [\w-]+ "((?:[^"\\]|\\.)*)"/.exec(line)?.[1]
  if (!name) return ref
  return `"${name.length > NAMED ? `${name.slice(0, NAMED - 1)}…` : name}"`
}

// What the tab's Pane says a Thread does (ADR 0029, decision 4).

export const READING = "Reading the page"

export const opening = (url?: string) =>
  `Opening ${url ? siteOf(url) : "a new tab"}`

const GOING: Partial<Record<Navigate["to"], string>> = {
  back: "Going back",
  forward: "Going forward",
  reload: "Reloading",
}

export const goingTo = (to: Navigate["to"]) =>
  GOING[to] ?? `Going to ${siteOf(to)}`

/** What the tab's Pane says the Thread does with `what` (ADR 0029,
 * decision 4), naming elements as the tab's last snapshot, `tree`, does:
 * words for the Person, with no text it types. */
export function stepOf(tree: string, what: Act | WaitFor): string {
  const name = nameOf(tree, what.ref ?? "")
  if (!("action" in what)) {
    if (what.text !== undefined) return `Waiting for "${what.text}"`
    if (what.ref !== undefined) return `Waiting for ${name}`
    return `Waiting for ${what.url}`
  }
  switch (what.action) {
    case "dialog_accept":
      return "Accepting a page dialog"
    case "dialog_dismiss":
      return "Dismissing a page dialog"
    case "click":
      return `Clicking ${name}`
    case "double_click":
      return `Double-clicking ${name}`
    case "type":
    case "fill":
      return `Typing in ${name}`
    case "select":
      return `Choosing in ${name}`
    case "press":
      return `Pressing ${what.key}`
    case "hover":
      return `Pointing at ${name}`
    case "scroll":
      return what.ref
        ? `Scrolling to ${name}`
        : `Scrolling ${what.direction ?? "down"}`
    case "drag":
      return `Dragging ${name} to ${nameOf(tree, what.to ?? "")}`
  }
}

/** Keys as Playwright names them, where Electron's names differ. */
const KEYS: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
}
const MODIFIERS: Record<Modifier, "control" | "shift" | "alt" | "meta"> = {
  Control: "control",
  ControlOrMeta: process.platform === "darwin" ? "meta" : "control",
  Shift: "shift",
  Alt: "alt",
  Meta: "meta",
}

/** What Electron is sent for `combo`, as Playwright names it: its key's
 * press, and whether the key makes text. A modifier Playwright has not is
 * refused, never left out. */
export function pressOf(combo: string) {
  const { key, held } = comboOf(combo)
  const modifiers = held.map((modifier) => MODIFIERS[modifier])
  const down: KeyboardInputEvent = {
    type: "keyDown",
    keyCode: KEYS[key] ?? key,
    modifiers,
  }
  // A key that makes text, or Enter, which sends a form, says it too.
  const char =
    key === "Enter" ||
    ([...key].length === 1 && !modifiers.some((m) => m !== "shift"))
  return { down, char }
}

/** The refusal of `combo`, a press that is one of Banda's keys. */
const bandas = (combo: string) =>
  new Refused({
    code: "forbidden",
    message: `${combo} is one of Banda's keys, which only the Person presses.`,
  })

/**
 * The keyboard of the tab's own page. Playwright's keys go through CDP to
 * whatever has the focus in Banda's window, as the Person's Thread: a tab
 * is a webview in it. Electron sends these to the tab alone, and the
 * Person keeps the focus. Sent as the hands act in the tab, they reach
 * the page alone, never the window, and the Agent's press of one of
 * Banda's keys is refused (ADR 0083, decision 3; keys.ts).
 */
export const keyboard = (tab: WebContents): Keyboard => {
  /** Presses `combo`; one of Banda's keys in force is refused when
   * `refuse`. */
  const press = (combo: string, refuse: boolean) => {
    const { down, char } = pressOf(combo)
    if (!refuse) tab.sendInputEvent(down)
    else if (sendPress(tab, down)) throw bandas(combo)
    if (char) tab.sendInputEvent({ ...down, type: "char" })
    tab.sendInputEvent({ ...down, type: "keyUp" })
  }
  return {
    /** Refuses `combo` when it is one of Banda's keys in force, before
     * the hands do anything for it: the page hears nothing of it. */
    refuse: (combo) => {
      if (isBandas(tab, pressOf(combo).down)) throw bandas(combo)
    },
    /** The Agent's press of `combo`: one of Banda's keys is refused. */
    press: (combo) => press(combo, true),
    /** Deletes what is chosen, with the hands' own key. */
    erase: () => press("Delete", false),
    /** Types `text`, every key of it, Banda's too. */
    type: (text) => {
      for (const char of text) {
        // Only a plain key has a code: the rest is text alone.
        const plain = /^[ -~]$/.test(char)
        const keyCode = KEYS[char] ?? char
        if (plain) tab.sendInputEvent({ type: "keyDown", keyCode })
        tab.sendInputEvent({ type: "char", keyCode: char })
        if (plain) tab.sendInputEvent({ type: "keyUp", keyCode })
      }
    },
  }
}
