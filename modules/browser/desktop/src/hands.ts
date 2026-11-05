/**
 * What Banda's hands do in one tab's page, for `browser_act` and
 * `browser_wait_for` (ADR 0029, decision 3): Playwright on a ref of the
 * tab's last snapshot. A password or a card's fields are the Person's
 * (decision 7, E): the hands never type there, and a snapshot hides what
 * they hold.
 */
import { siteOf } from "@banda/browser-pane/desktop"
import type { Act, Navigate, WaitFor } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import type { WebContents } from "electron"
import type { Locator, Page } from "playwright-core"
import { getDomain } from "tldts-experimental"

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

/** How long an element has to be there and ready for an action. */
const READY = 5_000

export const timedOut = (error: unknown) =>
  error instanceof Error && error.name === "TimeoutError"

/** A field as the page says it: enough to tell a secret one. */
type Field = { type: string | null; autocomplete: string | null }

/** Whether a field is a password's or a card's, by its input type and
 * `autocomplete`. */
const isSecret = (field: Field | null) =>
  !!field &&
  ((field.type ?? "").toLowerCase() === "password" ||
    /\b(current-password|new-password|cc-number|cc-exp|cc-exp-month|cc-exp-year|cc-csc)\b/.test(
      (field.autocomplete ?? "").toLowerCase()
    ))

// These run in the page, which may forbid eval: they only read.
const fieldOf = (element: Element): Field => ({
  type: element.getAttribute("type"),
  autocomplete: element.getAttribute("autocomplete"),
})

/** What the page's secret fields hold now, to hide from a snapshot. */
export const secrets = async (page: Page): Promise<string[]> => {
  // `fieldOf` and each value, at once: a function given to the page
  // cannot call another.
  const inputs = (
    await Promise.all(
      page.frames().map((frame) =>
        frame
          .locator("input, textarea, [contenteditable][autocomplete]")
          .evaluateAll((inputs) =>
            inputs.map((input) => ({
              type: input.getAttribute("type"),
              autocomplete: input.getAttribute("autocomplete"),
              value:
                (input as HTMLInputElement).value ?? input.textContent ?? "",
            }))
          )
      )
    )
  ).flat()
  return [
    ...new Set(
      inputs
        .filter((input) => input.value && isSecret(input))
        .map((input) => input.value)
    ),
  ].sort((a, b) => b.length - a.length)
}

/** The value of an accessibility-tree line, after its role, name and
 * metadata. Masking a value must not change a role or a ref that happens
 * to contain the same characters, as a CVV of "2" and ref=e2. */
const VALUE =
  /^(\s*-\s+[\w/-]+(?:\s+"(?:[^"\\]|\\.)*")?(?:\s+\[[^\]]+\])*:\s*)(.*)$/

/** `tree` with secret field values hidden, for every role and frame. */
export const hidden = (tree: string, values: string[]) =>
  tree
    .split("\n")
    .map((line) =>
      line.replace(
        VALUE,
        (_, prefix: string, value: string) =>
          prefix +
          values.reduce(
            (text, secret) => text.replaceAll(secret, "••••"),
            value
          )
      )
    )
    .join("\n")

const secretOf = async (locator: Locator) =>
  isSecret(await locator.evaluate(fieldOf))

const focusedIsSecret = async (page: Page) => {
  let frame = page.mainFrame()
  for (;;) {
    const focused = await frame.evaluateHandle(() => {
      let element = document.activeElement
      while (element?.shadowRoot?.activeElement)
        element = element.shadowRoot.activeElement
      return element ?? document.body
    })
    try {
      if (isSecret(await focused.evaluate(fieldOf))) return true
      const child = await focused.asElement()?.contentFrame()
      if (!child) return false
      frame = child
    } finally {
      await focused.dispose()
    }
  }
}

const theirs = (ref: string) =>
  new Refused({
    code: "forbidden",
    message: `${ref} is a password's or a card's field: it is the Person's to fill. Hand them the tab with browser_handoff.`,
  })

/** The element of `ref` in the tab's last snapshot; refused when no
 * element has it now. */
const elementOf = async (page: Page, ref: string) => {
  const locator = page.locator(`aria-ref=${ref}`)
  if ((await locator.count()) === 0)
    throw new Refused({
      message: `${ref} is not on the page now: take a new snapshot.`,
    })
  return locator
}

/** Refuses `values` a list of `ref`, `list`, has no option for, by its
 * value or label, naming the options it has: else Playwright waits for
 * them till it times out, and says the list was not ready. */
const chosen = async (list: Locator, ref: string, values: string[]) => {
  const options = await list.evaluate((element) =>
    element instanceof HTMLSelectElement
      ? [...element.options].map((option) => [option.value, option.label])
      : null
  )
  if (!options) return
  const missing = values.filter((v) => !options.some((o) => o.includes(v)))
  if (!missing.length) return
  const named = options
    .slice(0, LISTED)
    .map(([value, label]) => `"${label || value}"`)
  const more = options.length - named.length
  throw new Refused({
    code: "invalid",
    message: `${ref} has no option ${missing.map((v) => `"${v}"`).join(", ")}. Its options: ${named.join(", ")}${more ? ` and ${more} more` : ""}.`,
  })
}

/** How many of a list's options a refusal names. */
const LISTED = 30

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
const MODIFIERS: Record<string, "control" | "shift" | "alt" | "meta"> = {
  Control: "control",
  ControlOrMeta: process.platform === "darwin" ? "meta" : "control",
  Shift: "shift",
  Alt: "alt",
  Meta: "meta",
}

/**
 * The keyboard of the tab's own page. Playwright's keys go through CDP to
 * whatever has the focus in Banda's window, as the Person's Thread: a tab
 * is a webview in it. Electron sends these to the tab alone, and the
 * Person keeps the focus.
 */
const keyboard = (tab: WebContents) => ({
  type: (text: string) => {
    for (const char of text) {
      // Only a plain key has a code: the rest is text alone.
      const plain = /^[ -~]$/.test(char)
      const keyCode = KEYS[char] ?? char
      if (plain) tab.sendInputEvent({ type: "keyDown", keyCode })
      tab.sendInputEvent({ type: "char", keyCode: char })
      if (plain) tab.sendInputEvent({ type: "keyUp", keyCode })
    }
  },
  press: (combo: string) => {
    const parts = combo.split("+")
    const key = parts.pop() || "+"
    const modifiers = parts.flatMap((part) => MODIFIERS[part] ?? [])
    const keyCode = KEYS[key] ?? key
    tab.sendInputEvent({ type: "keyDown", keyCode, modifiers })
    // A key that makes text, or Enter, which sends a form, says it too.
    if (
      key === "Enter" ||
      ([...key].length === 1 && !modifiers.some((m) => m !== "shift"))
    )
      tab.sendInputEvent({ type: "char", keyCode, modifiers })
    tab.sendInputEvent({ type: "keyUp", keyCode, modifiers })
  },
})

/** Where the Thread's hands go in a page, in its CSS pixels from the
 * viewport's top left corner, before they act there: the Thread's cursor
 * goes there, and they wait for it (ADR 0029, decision 4). */
export type Pointing = (x: number, y: number) => Promise<void>

/** Does `act` in `page`, whose web contents are `tab`, pointing at each
 * element before it acts on it, for a Thread's hands. */
export async function act(
  page: Page,
  tab: WebContents,
  act: Act,
  point?: Pointing
): Promise<void> {
  const keys = keyboard(tab)
  const ready = { timeout: READY }
  const ref = act.ref ?? ""
  /** `element`, in view, once the hands pointed at it. */
  const aimed = async (element: Locator) => {
    if (!point) return element
    await element.scrollIntoViewIfNeeded(ready)
    const box = await element.boundingBox()
    if (box) await point(box.x + box.width / 2, box.y + box.height / 2)
    return element
  }
  /** The element of `ref`, refused first when `guarded` and it is a
   * secret field, then aimed at. */
  const element = async (guarded = false) => {
    const found = await elementOf(page, ref)
    if (guarded && (await secretOf(found))) throw theirs(ref)
    return aimed(found)
  }
  try {
    switch (act.action) {
      case "click":
        return await (await element()).click(ready)
      case "double_click":
        return await (await element()).dblclick(ready)
      case "type":
      case "fill": {
        const field = await element(true)
        const text = act.text ?? ""
        if (act.action === "type") await field.focus(ready)
        else {
          // What it had goes: typed over once chosen, or deleted.
          await field.selectText(ready)
          if (!text) return keys.press("Delete")
        }
        return keys.type(text)
      }
      case "select": {
        const list = await element()
        await chosen(list, ref, act.values ?? [])
        return void (await list.selectOption(act.values ?? [], ready))
      }
      case "press": {
        const key = act.key ?? ""
        // A key or shortcut may edit a field (Shift+A, paste, Delete,
        // numeric steppers). Secret fields belong to the Person.
        if (act.ref) await (await element(true)).focus(ready)
        else if (await focusedIsSecret(page)) throw theirs("The focused field")
        return keys.press(key)
      }
      case "hover":
        return await (await element()).hover(ready)
      case "scroll": {
        if (act.ref) return void (await element())
        const height = page.viewportSize()?.height ?? 600
        const step = Math.round(height * 0.8)
        return await page.mouse.wheel(0, act.direction === "up" ? -step : step)
      }
      case "drag": {
        const from = await element()
        const to = await aimed(await elementOf(page, act.to ?? ""))
        return await from.dragTo(to, ready)
      }
    }
  } catch (error) {
    if (!timedOut(error)) throw error
    throw new Refused({
      message: `${ref} was not ready within ${READY / 1000} s: it may be hidden, covered or disabled. Take a new snapshot.`,
    })
  }
}

/** Waits until `page` shows what `wait` says. */
export async function waitFor(page: Page, wait: WaitFor): Promise<void> {
  // The engine says how long, 15 s unless the Agent said.
  const timeout = wait.seconds! * 1000
  try {
    if (wait.text !== undefined)
      await page.getByText(wait.text).first().waitFor({ timeout })
    else if (wait.ref !== undefined)
      await page.locator(`aria-ref=${wait.ref}`).waitFor({ timeout })
    else if (wait.url !== undefined) {
      const part = wait.url
      await page.waitForURL((url) => url.href.includes(part), {
        timeout,
        waitUntil: "commit",
      })
    }
  } catch (error) {
    if (!timedOut(error)) throw error
    const what = wait.text ?? wait.ref ?? `an address with ${wait.url}`
    throw new Refused({
      message: `Tab ${wait.tab} did not show "${what}" within ${timeout / 1000} s.`,
    })
  }
}
