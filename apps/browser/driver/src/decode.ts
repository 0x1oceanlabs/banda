/** What a request says, decoded: it comes from outside the driver, so
 * each field is checked before it is used, and one that is not as its
 * method needs is refused as invalid, by its name. */
import type { Act, WaitFor } from "@banda/contract/browser"
import { Refusal } from "./refusal"

export const invalid = (message: string) =>
  new Refusal({ code: "invalid", message })

export type Fields = Record<string, unknown>

/** `value` as a request's fields, when it is an object. */
export const fieldsOf = (value: unknown): Fields | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined

/** The text `name` of `from`, none when it may be left out. */
export function text(from: Fields, name: string): string
export function text(
  from: Fields,
  name: string,
  optional: true
): string | undefined
export function text(from: Fields, name: string, optional = false) {
  const value = from[name]
  if (typeof value === "string" && value) return value
  if (optional && value === undefined) return undefined
  throw invalid(`"${name}" is not a text.`)
}

/** The tab a request names. */
export function tabOf(from: Fields): number {
  const { tab } = from
  if (typeof tab === "number" && Number.isSafeInteger(tab)) return tab
  throw invalid('"tab" is not a tab\'s id.')
}

const ACTIONS: readonly Act["action"][] = [
  "click",
  "double_click",
  "type",
  "fill",
  "select",
  "press",
  "hover",
  "scroll",
  "drag",
  "dialog_accept",
  "dialog_dismiss",
]

/** An action of `browser_act`. What each action needs of the rest is the
 * engine's to check, and the hands refuse what is not on the page. */
export function actOf(from: Fields): Act {
  const action = ACTIONS.find((name) => name === from.action)
  if (!action) throw invalid('"action" is not an action of browser_act.')
  const { values, direction } = from
  if (
    values !== undefined &&
    !(Array.isArray(values) && values.every((v) => typeof v === "string"))
  )
    throw invalid('"values" is not a list of texts.')
  if (direction !== undefined && direction !== "up" && direction !== "down")
    throw invalid('"direction" is not up or down.')
  // The text a field is filled with may be empty: it then empties it.
  const typed = from.text
  if (typed !== undefined && typeof typed !== "string")
    throw invalid('"text" is not a text.')
  return {
    tab: tabOf(from),
    action,
    ref: text(from, "ref", true),
    dialog: text(from, "dialog", true),
    text: typed,
    values,
    key: text(from, "key", true),
    to: text(from, "to", true),
    direction,
  }
}

/** What `browser_wait_for` waits for: one of a text, a ref or a part of
 * an address, for 15 s unless it says. */
export function waitOf(from: Fields): WaitFor {
  const { seconds = 15 } = from
  if (typeof seconds !== "number" || !(seconds > 0 && seconds <= 60))
    throw invalid('"seconds" is not a time up to 60.')
  const wait = {
    tab: tabOf(from),
    text: text(from, "text", true),
    ref: text(from, "ref", true),
    url: text(from, "url", true),
    seconds,
  }
  if (wait.text === undefined && wait.ref === undefined && !wait.url)
    throw invalid("It waits for one of text, ref or url.")
  return wait
}

/** An address a tab opens at or goes to, refused when it is not of the
 * web: http or https. */
export function addressOf(url: string): string {
  try {
    const { protocol } = new URL(url)
    if (protocol === "http:" || protocol === "https:") return url
  } catch {
    // No address at all: refused as one of another kind is.
  }
  throw invalid(
    `"${url}" is not an address Banda opens: give one with http:// or https://.`
  )
}
