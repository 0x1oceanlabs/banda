/**
 * What Banda's hands do in one tab's page, for `browser_act` and
 * `browser_wait_for` (ADR 0029, decision 3): Playwright on a ref of the
 * tab's last snapshot. A password or a card's fields are the Person's
 * (decision 7, E): the hands never type there, and a snapshot hides what
 * they hold. The keys are whoever holds the page's: Electron's in the
 * window, Playwright's in the driver (`Keyboard`).
 */
import type { Act, WaitFor } from "@banda/contract/browser"
import type { Locator, Page } from "playwright-core"
import { Refusal } from "./refusal"

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
  new Refusal({
    code: "forbidden",
    message: `${ref} is a password's or a card's field: it is the Person's to fill. Hand them the tab with browser_handoff.`,
  })

/** The element of `ref` in the tab's last snapshot; refused when no
 * element has it now. */
const elementOf = async (page: Page, ref: string) => {
  const locator = page.locator(`aria-ref=${ref}`)
  if ((await locator.count()) === 0)
    throw new Refusal({
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
  throw new Refusal({
    code: "invalid",
    message: `${ref} has no option ${missing.map((v) => `"${v}"`).join(", ")}. Its options: ${named.join(", ")}${more ? ` and ${more} more` : ""}.`,
  })
}

/** How many of a list's options a refusal names. */
const LISTED = 30

/** The modifiers a press may hold, as Playwright names them. */
const MODIFIERS = ["Control", "Shift", "Alt", "Meta", "ControlOrMeta"] as const
export type Modifier = (typeof MODIFIERS)[number]

/** `combo`, a press as Playwright names it, as its key and the modifiers
 * held with it. A modifier Playwright has not is refused, never left
 * out. */
export function comboOf(combo: string): { key: string; held: Modifier[] } {
  const parts = combo.split("+")
  let key = parts.pop()
  if (!key) {
    // The key "+" leaves an empty part before it too.
    if (parts.at(-1) === "") parts.pop()
    key = "+"
  }
  const held = parts.map((part) => {
    const modifier = MODIFIERS.find((name) => name === part)
    if (modifier) return modifier
    throw new Refusal({
      code: "invalid",
      message: `"${part}" is not a modifier: press knows Control, Shift, Alt, Meta and ControlOrMeta.`,
    })
  })
  return { key, held }
}

/** The keyboard of a tab's page, as the hands use it. Whoever holds the
 * page gives it: the window sends its keys through Electron, to the tab
 * alone; the driver through Playwright. */
export type Keyboard = {
  /** Refuses `combo` when the hands may not press it here, before they
   * do anything for it: the page hears nothing of it. */
  refuse(combo: string): void | Promise<void>
  /** The Agent's press of `combo`. */
  press(combo: string): void | Promise<void>
  /** Deletes what is chosen, with the hands' own key. */
  erase(): void | Promise<void>
  /** Types `text`, every key of it. */
  type(text: string): void | Promise<void>
}

/** Where the Thread's hands go in a page, in its CSS pixels from the
 * viewport's top left corner, before they act there: the Thread's cursor
 * goes there, and they wait for it (ADR 0029, decision 4). */
export type Pointing = (x: number, y: number) => Promise<void>

/** Does `act` in `page` with the page's `keys`, pointing at each element
 * before it acts on it, for a Thread's hands. */
export async function act(
  page: Page,
  keys: Keyboard,
  act: Act,
  point?: Pointing
): Promise<void> {
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
          if (!text) return await keys.erase()
        }
        return await keys.type(text)
      }
      case "select": {
        const list = await element()
        await chosen(list, ref, act.values ?? [])
        return void (await list.selectOption(act.values ?? [], ready))
      }
      case "press": {
        const key = act.key ?? ""
        // A key the hands may not press is refused before they touch
        // the page.
        await keys.refuse(key)
        // A key or shortcut may edit a field (Shift+A, paste, Delete,
        // numeric steppers). Secret fields belong to the Person.
        if (act.ref) await (await element(true)).focus(ready)
        else if (await focusedIsSecret(page)) throw theirs("The focused field")
        return await keys.press(key)
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
    throw new Refusal({
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
    throw new Refusal({
      message: `Tab ${wait.tab} did not show "${what}" within ${timeout / 1000} s.`,
    })
  }
}
