/**
 * What a module tells the Person, in plain data (ADR 0056, decision 2):
 * no code, so any module can say it by running `notifications.tell`, and
 * its buttons are actions by their id and args. Pure, so plain tests
 * cover it.
 */
import type { JsonValue } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { Chime } from "@banda/ui/sound"

/** One of its buttons: the action it runs, by its id, with its args. */
export type Button = { label: string; action: string; args?: Args }

export type Told = {
  /** One per thing: what it tells next replaces this. */
  key: string
  /** Its kind, which colours its edge and picks its Mark. */
  kind: Chime
  title: string
  /** A line in code type, before the words. */
  code?: string
  /** What it says. */
  body?: string
  /** What the desktop's notification says instead. */
  notice?: string
  /** Its buttons, the main one first: two at most. */
  buttons: readonly Button[]
  /** The button a click on the desktop's notification runs: the first
   * if none says. */
  click?: number
  /** It plays no sound. */
  silent?: boolean
}

const KINDS = new Set<string>(["done", "asking", "failed"])

const text = (value: JsonValue | undefined): value is string =>
  typeof value === "string"

/** What `notifications.tell` was given, if it is a `Told`. */
export function toldOf(args: Args | undefined): Told | null {
  if (!args) return null
  const { key, kind, title, code, body, notice, buttons, click, silent } = args
  if (!text(key) || !text(kind) || !KINDS.has(kind) || !text(title)) return null
  if (!Array.isArray(buttons)) return null
  const said = buttons.flatMap((button): Button[] => {
    if (!button || typeof button !== "object" || Array.isArray(button))
      return []
    const { label, action, args } = button
    if (!text(label) || !text(action)) return []
    const given =
      args && typeof args === "object" && !Array.isArray(args) ? { args } : {}
    return [{ label, action, ...given }]
  })
  return {
    key,
    kind: kind as Chime,
    title,
    ...(text(code) ? { code } : {}),
    ...(text(body) ? { body } : {}),
    ...(text(notice) ? { notice } : {}),
    buttons: said.slice(0, 2),
    ...(typeof click === "number" ? { click } : {}),
    ...(silent === true ? { silent } : {}),
  }
}

/** The button a click on its desktop notification runs. */
export function clicked(told: Told): Button | undefined {
  return told.buttons[told.click ?? 0]
}
